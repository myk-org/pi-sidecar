import { randomUUID } from "node:crypto";
import { accessSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  type AgentSession,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";

import { logger } from "./logger.js";
import { createHttpToolExecutor, normalizeHttpToolConfig } from "./http-tool-executor.js";

const require = createRequire(import.meta.url);

/** Strip bracket suffixes from model IDs for display or comparison (e.g. "cursor:default[]" → "cursor:default"). */
function baseModelId(id: string): string {
  const idx = id.indexOf("[");
  return idx >= 0 ? id.substring(0, idx) : id;
}

const DISCOVERY_TIMEOUT_MS = 30_000;

/**
 * Discover models from an acpx agent using the acpx/runtime library.
 * Creates a temporary runtime, queries available models via getStatus(),
 * then cleans up. Based on the extension's discoverAcpxModels but inlined
 * here to avoid importing the extension module (which has incompatible
 * top-level imports outside Pi's extension loader).
 */
async function discoverAcpxModels(agent: string): Promise<Array<{ id: string; name: string; provider: string }>> {
  logger.debug(`[sidecar] Discovery starting: agent=${agent}`);
  if (!/^[a-z0-9_-]+$/i.test(agent)) {
    throw new Error(`Invalid agent name: ${agent}`);
  }

  const { createAcpRuntime, createFileSessionStore, createAgentRegistry } = await import("acpx/runtime");

  const uid = randomUUID().slice(0, 8);
  const stateDir = join(homedir(), ".acpx", `discover-${process.pid}-${uid}`);
  const runtime = createAcpRuntime({
    cwd: process.cwd(),
    sessionStore: createFileSessionStore({ stateDir }),
    agentRegistry: createAgentRegistry(),
    permissionMode: "deny-all",
  });

  let handle: Awaited<ReturnType<typeof runtime.ensureSession>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const discovery = (async () => {
      handle = await runtime.ensureSession({
        sessionKey: `discover-${agent}-${uid}`,
        agent,
        mode: "oneshot",
        cwd: process.cwd(),
      });

      const status = await runtime.getStatus({ handle });
      const modelIds: string[] = status.models?.availableModelIds || [];

      return modelIds.map((modelId: string) => ({
        id: `${agent}:${modelId}`,
        name: `${baseModelId(modelId).replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())} (${agent})`,
        provider: `acpx-${agent}`,
      }));
    })();

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`acpx discovery for ${agent} timed out after ${DISCOVERY_TIMEOUT_MS / 1000}s`));
      }, DISCOVERY_TIMEOUT_MS);
    });

    const result = await Promise.race([discovery, timeout]);
    clearTimeout(timer!);
    return result;
  } catch (err) {
    logger.warn(`[sidecar] Discovery failed: agent=${agent}`, err);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
    // Wait briefly for handle assignment if timed out — ensureSession may still be completing
    if (timedOut && !handle) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (handle) {
      await runtime.close({ handle, reason: "discovery complete" }).catch((err: any) => {
        logger.debug(`[sidecar] Discovery close failed: agent=${agent}`, err);
      });
    }
    await rm(stateDir, { recursive: true, force: true }).catch((err: any) => {
      logger.debug(`[sidecar] Discovery cleanup failed: agent=${agent}, stateDir=${stateDir}`, err);
    });
  }
}

function resolveExtensionPath(envVar: string, packageName: string, entryFile: string): string {
  const envPath = process.env[envVar];
  if (envPath) return envPath;
  try {
    // resolve() finds the package wherever npm installed it (hoisted or nested)
    const pkgJson = require.resolve(`${packageName}/package.json`);
    return join(dirname(pkgJson), entryFile);
  } catch (err) {
    logger.debug(`[sidecar] Could not resolve ${packageName}:`, err);
    return "";
  }
}

const ACPX_EXTENSION = resolveExtensionPath("SIDECAR_ACPX_EXTENSION_PATH", "pi-orchestrator-config", "extensions/acpx-provider/index.ts");
const VERTEX_EXTENSION = resolveExtensionPath("SIDECAR_VERTEX_EXTENSION_PATH", "pi-vertex-claude", "index.ts");

export const DEFAULT_TOOLS = ["read", "grep", "find", "ls", "bash"] as const;

interface SessionEntry {
  session: AgentSession;
  lastActivity: number;
  inFlight: boolean;
}

/**
 * Wire-format shape for custom tool configs received via the HTTP API.
 * Non-HTTP tools are passed through to the Pi SDK as-is and must already
 * conform to the SDK's ToolDefinition interface (including the SDK-style
 * `execute(toolCallId, params, signal, onUpdate, ctx)` signature).
 * HTTP-backed tools are automatically wrapped with the correct SDK signature.
 */
export interface CustomToolConfig {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
  /** When present, the tool's execute function is backed by an HTTP request. */
  http?: Record<string, any>;
  /** Additional properties passed through to the Pi SDK ToolDefinition. */
  [key: string]: any;
}

export interface CreateSessionOptions {
  provider: string;
  model: string;
  systemPrompt: string;
  cwd: string;
  agentDir?: string;
  tools?: string[];
  customTools?: CustomToolConfig[];
}

export class SessionStore {
  private sessions = new Map<string, SessionEntry>();
  private authStorage = AuthStorage.create();
  private modelRegistry = ModelRegistry.create(this.authStorage);
  private _ready = false;
  private _discoveryError: string | null = null;
  private acpxModels: Array<{ id: string; name: string; provider: string }> = [];

  get ready(): boolean {
    return this._ready;
  }

  get discoveryError(): string | null {
    return this._discoveryError;
  }

  count(): number {
    return this.sessions.size;
  }

  getModels(): Array<{ id: string; name: string; provider: string }> {
    // Providers that require browser OAuth and cannot work in a headless container
    const HEADLESS_EXCLUDED_PROVIDERS = new Set(["github-copilot"]);

    const builtinModels = this.modelRegistry.getAvailable()
      .filter((m) => !HEADLESS_EXCLUDED_PROVIDERS.has(m.provider))
      .map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
      }));

    // Deduplicate: acpx models take priority over builtin placeholders.
    // Compare by stripping bracket suffixes (e.g. "cursor:default[]" base is "cursor:default").
    const acpxBaseIds = new Set(this.acpxModels.map((m) => baseModelId(m.id)));
    const dedupedBuiltins = builtinModels.filter((m) => !acpxBaseIds.has(baseModelId(m.id)));
    const dedupedCount = builtinModels.length - dedupedBuiltins.length;
    if (dedupedCount > 0) {
      logger.debug(`[sidecar] Models deduped: builtin=${builtinModels.length}, acpx=${this.acpxModels.length}, removed=${dedupedCount}, total=${dedupedBuiltins.length + this.acpxModels.length}`);
    }

    return [...dedupedBuiltins, ...this.acpxModels];
  }

  /**
   * Discover models from all configured providers. Blocks until complete.
   * Called on startup — /health returns ok only after this finishes.
   */
  async refreshModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    logger.debug(`[sidecar] Starting model discovery...`);
    try {
      // Create a bootstrap session to trigger extension loading.
      // Extensions like vertex-claude register models synchronously on load.
      // The session is kept alive (disposed at cleanup) to maintain extension state.
      const bootstrapId = await this.create({
        provider: "google",
        model: "gemini-2.5-flash",
        systemPrompt: "bootstrap",
        cwd: "/tmp",
      });
      logger.log(`[sidecar] Bootstrap session created for extension loading`);

      // Discover acpx models using the extension's library-based discovery
      const agents = (process.env.ACPX_AGENTS || "")
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.length > 0);

      if (agents.length > 0) {
        logger.log(`[sidecar] Discovering models for ACPX agents: ${agents.join(", ")}`);
        const results = await Promise.allSettled(
          agents.map((agent) => discoverAcpxModels(agent)),
        );

        const discoveredModels: Array<{ id: string; name: string; provider: string }> = [];
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const agent = agents[i];
          if (result.status === "fulfilled" && result.value.length > 0) {
            discoveredModels.push(...result.value);
            logger.log(`[sidecar] acpx-${agent}: ${result.value.length} models discovered`);
          } else if (result.status === "rejected") {
            logger.error(`[sidecar] acpx-${agent}: discovery failed:`, result.reason);
          } else {
            logger.warn(`[sidecar] acpx-${agent}: no models discovered`);
          }
        }
        this.acpxModels = discoveredModels;
      }

      // Clean up bootstrap session
      this.delete(bootstrapId);

      this._ready = true;
      this._discoveryError = null;
      logger.log(`[sidecar] Model discovery complete: ${this.getModels().length} models available`);
      return this.getModels();
    } catch (err: any) {
      this._discoveryError = err?.message || "Unknown discovery error";
      this._ready = true;  // Mark as ready but with error — don't block health forever
      logger.error(`[sidecar] Model discovery failed:`, err);
      throw err;  // Rethrow so callers can handle (startup catches, POST /models/refresh returns 500)
    }
  }

  async create(options: CreateSessionOptions): Promise<string> {
    const id = randomUUID();

    if (!options.model) {
      throw new Error(`Model is required. Use GET /models to list available models.`);
    }

    // Find the model
    let model = this.modelRegistry.find(options.provider, options.model) || undefined;
    if (!model) {
      // Try built-in models
      model = getModel(options.provider as any, options.model) || undefined;
    }

    if (!model) {
      // Check acpx models (discovered at runtime via extension API)
      const isAcpxModel = this.acpxModels.some((m) => m.id === options.model);
      if (!isAcpxModel) {
        throw new Error(`Model '${options.model}' not found for provider '${options.provider}'. Use GET /models to list available models.`);
      }
      // acpx model found — proceed without a registry model object
      // (createAgentSession will resolve it via the acpx extension)
    }

    const isAcpx = !model && this.acpxModels.some((m) => m.id === options.model);
    logger.debug(`[sidecar] Model resolved: provider=${options.provider}, model=${options.model}, registryMatch=${!!model}, acpxMatch=${isAcpx}`);

    // Build extension paths (only include existing files)
    const extensionPaths: string[] = [];
    if (ACPX_EXTENSION) {
      try {
        accessSync(ACPX_EXTENSION);
        extensionPaths.push(ACPX_EXTENSION);
        logger.log(`[sidecar] Extension found: ${ACPX_EXTENSION}`);
      } catch (err) {
        logger.warn(`[sidecar] ACPX extension not found at ${ACPX_EXTENSION}:`, err);
      }
    }
    if (VERTEX_EXTENSION) {
      try {
        accessSync(VERTEX_EXTENSION);
        extensionPaths.push(VERTEX_EXTENSION);
        logger.log(`[sidecar] Extension found: ${VERTEX_EXTENSION}`);
      } catch (err) {
        logger.warn(`[sidecar] Vertex extension not found at ${VERTEX_EXTENSION}:`, err);
      }
    }
    logger.log(`[sidecar] Loading ${extensionPaths.length} extensions`);

    // Build custom tools from config — result is cast to any[] for Pi SDK ToolDefinition compatibility
    const customTools: any[] = (options.customTools || []).map((tool) => {
      if (!tool.name || typeof tool.name !== "string") {
        logger.error(`[sidecar] Custom tool missing required 'name' field, skipping`);
        return null;
      }
      if (tool.http) {
        const httpConfig = normalizeHttpToolConfig(tool.http);
        const httpExecutor = createHttpToolExecutor(httpConfig);
        logger.debug(`[sidecar] Creating HTTP executor for custom tool: name=${tool.name}, method=${httpConfig.method}, url=${httpConfig.url}`);
        const { http: _http, execute: _exec, ...rest } = tool;
        return {
          ...rest,
          label: tool.name,
          description: tool.description || "",
          parameters: tool.parameters || {},
          execute: async (
            _toolCallId: string,
            params: Record<string, any>,
            signal: AbortSignal | undefined,
          ) => {
            const text = await httpExecutor(params, signal);
            return {
              content: [{ type: "text" as const, text }],
              details: {},
            };
          },
        };
      }
      return tool;
    }).filter((t): t is NonNullable<typeof t> => t != null);

    const tools = options.tools ?? [...DEFAULT_TOOLS];
    // Include custom tool names in the allowed tools list so the SDK
    // doesn't filter them out via allowedToolNames.
    const customToolNames = customTools.map((t: any) => t.name as string);
    const allToolNames = [...tools, ...customToolNames];
    logger.debug(`[sidecar] Tools configured: builtin=${JSON.stringify(tools)}, custom=${customTools.length} (${customToolNames.join(",")}), allAllowed=${JSON.stringify(allToolNames)}`);

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
    });

    // The Pi SDK's DefaultResourceLoader automatically discovers project-level resources
    // from {cwd}/.pi/ — including skills, prompts, extensions, and themes.
    // It also loads AGENTS.md from {cwd}/ root as project agent instructions.
    // Callers control resource loading by setting `cwd` to a directory containing these files.
    // The agentDir controls global resources (user-level skills, extensions, auth, models).
    const agentDir = options.agentDir ?? "/tmp/pi-sidecar-agent";
    const loader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir,
      settingsManager,
      additionalExtensionPaths: extensionPaths,
      systemPromptOverride: () => options.systemPrompt,
    });
    await loader.reload();
    logger.debug(`[sidecar] Session setup: id=${id}, extensions=${extensionPaths.length}, tools=${customTools.length} custom, cwd=${options.cwd}`);

    const { session } = await createAgentSession({
      cwd: options.cwd,
      model,
      thinkingLevel: "off",
      tools: allToolNames as string[],
      customTools,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
    });

    this.sessions.set(id, { session, lastActivity: Date.now(), inFlight: false });
    logger.log(`[sidecar] Session created: ${id} (provider=${options.provider}, model=${options.model}, cwd=${options.cwd}, tools=${tools.join(",")}, customTools=${customTools.length})`);
    return id;
  }

  async prompt(id: string, message: string): Promise<{ text: string; usage: any; error?: string }> {
    const entry = this.sessions.get(id);
    if (!entry) throw new Error(`Session ${id} not found`);

    if (entry.inFlight) {
      throw new Error(`Session ${id} is busy — concurrent prompts are not supported`);
    }

    entry.lastActivity = Date.now();
    entry.inFlight = true;

    logger.log(`[sidecar] Prompt started: session=${id}, message_length=${message.length}`);

    const errors: string[] = [];
    let errorsDropped = 0;
    let responseText = "";
    let textDeltaCount = 0;
    let assistantMessageCount = 0;
    let messageBoundaries: number[] = [];
    const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: null as number | null, duration_ms: 0 };
    const startTime = Date.now();

    const unsubscribe = entry.session.subscribe((event) => {
      // Pi SDK event types don't export the error variant — cast is necessary
      if ((event as any).type === "error") {
        const errPayload = (event as any).error;
        let errorMsg: string;
        if (typeof errPayload === "string") {
          errorMsg = errPayload;
        } else if (errPayload?.message) {
          errorMsg = errPayload.message;
        } else {
          try {
            errorMsg = JSON.stringify(errPayload);
          } catch {
            errorMsg = "[unstringifiable error]";
          }
        }
        if (errors.length < 10) {
          errors.push(errorMsg);
        } else {
          errorsDropped++;
        }
        logger.error(`[sidecar] Prompt error event: session=${id}, error=${errorMsg}`);
      }
      // Track assistant message boundaries via message_start events.
      // Using message_start instead of object reference comparison because some
      // providers (e.g., Vertex Claude) create new message objects per streaming chunk.
      if (event.type === "message_start" && (event as any).message?.role === "assistant") {
        assistantMessageCount++;
        if (assistantMessageCount > 1 && responseText.length > 0) {
          // Deduplicate: skip if same offset as last boundary (tool-only messages produce no text)
          const lastBoundary = messageBoundaries.length > 0 ? messageBoundaries[messageBoundaries.length - 1] : -1;
          if (responseText.length !== lastBoundary) {
            messageBoundaries.push(responseText.length);
            logger.debug(`[sidecar] MSG_BOUNDARY: session=${id}, deltas=${textDeltaCount}`);
          }
        }
      }
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        responseText += event.assistantMessageEvent.delta;
        textDeltaCount++;
      }
      if (event.type === "agent_end" && event.messages) {
        for (const msg of event.messages) {
          if (msg.role === "assistant" && msg.usage) {
            usage.input_tokens += msg.usage.input || 0;
            usage.output_tokens += msg.usage.output || 0;
            usage.cache_read_tokens += msg.usage.cacheRead || 0;
            usage.cache_write_tokens += msg.usage.cacheWrite || 0;
            if (msg.usage.cost?.total != null) {
              usage.cost_usd = (usage.cost_usd ?? 0) + msg.usage.cost.total;
            }
          }
        }

        // Fallback: if no text_delta was captured, extract from final assistant message
        if (!responseText) {
          const msgSummary = event.messages.map((m: any) => {
            const contentTypes = Array.isArray(m.content)
              ? m.content.map((c: any) => c.type).join(",")
              : typeof m.content;
            return `${m.role}(${contentTypes})`;
          }).join(" → ");
          logger.warn(`[sidecar] No text_delta events captured (${textDeltaCount} deltas). Messages: ${msgSummary}. Extracting from agent_end messages`);
          for (const msg of [...event.messages].reverse()) {
            if (msg.role === "assistant" && msg.content) {
              const textContent = Array.isArray(msg.content)
                ? msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
                : typeof msg.content === "string" ? msg.content : "";
              if (textContent) {
                responseText = textContent;
                break;
              }
            }
          }
        }
      }
    });

    try {
      await entry.session.prompt(message);
    } catch (err: any) {
      logger.error(`[sidecar] Prompt failed: session=${id}, error=${err?.message}`, err);
      // If we captured partial text or error events before the rejection,
      // return structured data instead of throwing — preserves partial state for callers
      if (responseText || errors.length > 0) {
        const rejectionError = err?.message || "Prompt rejected";
        if (errors.length < 10) {
          errors.push(rejectionError);
        } else {
          errorsDropped++;
        }
        // fall through to structured return below
      } else {
        throw err;
      }
    } finally {
      unsubscribe();
      entry.inFlight = false;
      entry.lastActivity = Date.now();
    }

    // Insert \n\n at message boundaries for text responses only.
    // JSON responses must not be modified — the separator would corrupt structured data.
    if (messageBoundaries.length > 0 && responseText.length > 0) {
      // Cheap pre-check: only attempt JSON.parse if response looks like JSON
      const trimmed = responseText.trim();
      const looksLikeJson = (trimmed.charCodeAt(0) === 123 /* { */ && trimmed.charCodeAt(trimmed.length - 1) === 125 /* } */) ||
                            (trimmed.charCodeAt(0) === 91  /* [ */ && trimmed.charCodeAt(trimmed.length - 1) === 93  /* ] */);
      let isJson = false;
      if (looksLikeJson) {
        try {
          JSON.parse(responseText);
          isJson = true;
        } catch {
          // Looks like JSON but isn't — treat as text
        }
      }
      if (!isJson) {
        // Find JSON regions by scanning forward once. Only check openers at top level
        // (not inside strings) and validate balanced regions with JSON.parse.
        const jsonRegions: Array<[number, number]> = [];
        let inStr = false;
        let esc = false;
        for (let si = 0; si < responseText.length; si++) {
          const c = responseText.charCodeAt(si);
          if (esc) { esc = false; continue; }
          if (c === 92 /* \\ */) { esc = true; continue; }
          if (c === 34 /* \" */) { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === 123 /* { */ || c === 91 /* [ */) {
            const close = c === 123 ? 125 : 93;
            let depth = 1;
            let s2 = false, e2 = false;
            let ei = si + 1;
            for (; ei < responseText.length && depth > 0; ei++) {
              const ch = responseText.charCodeAt(ei);
              if (e2) { e2 = false; continue; }
              if (ch === 92) { e2 = true; continue; }
              if (ch === 34) { s2 = !s2; continue; }
              if (s2) continue;
              if (ch === c) depth++;
              else if (ch === close) depth--;
            }
            if (depth === 0) {
              // Only protect if a boundary actually falls inside this region
              const hasRelevantBoundary = messageBoundaries.some(b => b > si && b < ei);
              if (hasRelevantBoundary) {
                try {
                  JSON.parse(responseText.slice(si, ei));
                  jsonRegions.push([si, ei]);
                  si = ei - 1; // skip past valid JSON region only
                } catch {
                  // Balanced but not valid JSON — don't skip, inner regions may be valid
                }
              } else {
                si = ei - 1; // no boundaries inside, safe to skip
              }
            }
          }
        }

        // Insert \n\n at boundaries that don't fall inside JSON regions
        const parts: string[] = [];
        let prev = 0;
        let applied = 0;
        for (const pos of messageBoundaries) {
          const insideJson = jsonRegions.some(([start, end]) => pos > start && pos < end);
          if (!insideJson) {
            parts.push(responseText.slice(prev, pos));
            prev = pos;
            applied++;
          }
        }
        parts.push(responseText.slice(prev));
        responseText = parts.join("\n\n");
        logger.debug(`[sidecar] MSG_BOUNDARIES_APPLIED: session=${id}, applied=${applied}, skipped=${messageBoundaries.length - applied}`);
      } else {
        logger.debug(`[sidecar] MSG_BOUNDARIES_SKIPPED: session=${id}, count=${messageBoundaries.length}, reason=json_response`);
      }
    }

    usage.duration_ms = Date.now() - startTime;
    logger.log(`[sidecar] PROMPT_COMPLETED: session=${id}, text_length=${responseText.length}, deltas=${textDeltaCount}, tokens_in=${usage.input_tokens}, tokens_out=${usage.output_tokens}, duration_ms=${usage.duration_ms}`);

    // If we got errors from the AI, surface them
    if (errors.length > 0) {
      const errorText = errors.join("; ") + (errorsDropped > 0 ? ` [+${errorsDropped} more]` : "");
      logger.error(`[sidecar] Prompt completed with errors: session=${id}, errors=${errorText}`);
      return { text: responseText, usage, error: errorText };
    }

    // Empty text is valid for tool-only responses — warn but don't error
    if (!responseText) {
      logger.warn(`[sidecar] AI returned empty text: session=${id}, tokens_in=${usage.input_tokens}, tokens_out=${usage.output_tokens}`);
    }

    return { text: responseText, usage };
  }

  async abort(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (!entry) throw new Error(`Session ${id} not found`);
    logger.debug(`[sidecar] Aborting session: ${id}, inFlight=${entry.inFlight}`);
    await entry.session.abort();
    logger.info(`[sidecar] Session aborted: ${id}`);
  }

  delete(id: string): boolean {
    const entry = this.sessions.get(id);
    if (!entry) {
      logger.debug(`[sidecar] SESSION_DELETE: result=no-op, session=${id}, reason=not_found`);
      return false;
    }
    entry.session.dispose();
    this.sessions.delete(id);
    logger.log(`[sidecar] SESSION_DELETE: result=disposed, session=${id}`);
    return true;
  }

  disposeAll(): void {
    let count = 0;
    for (const [id, entry] of this.sessions) {
      logger.log(`[sidecar] Disposing session: ${id}`);
      entry.session.dispose();
      count++;
    }
    this.sessions.clear();
    logger.info(`[sidecar] All sessions disposed (${count} total)`);
  }

  cleanupStale(maxAge: number): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, entry] of this.sessions) {
      if (entry.inFlight) continue;
      if (now - entry.lastActivity > maxAge) {
        logger.log(`[sidecar] Cleaning up stale session: ${id}`);
        entry.session.dispose();
        this.sessions.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info(`[sidecar] Stale session cleanup: removed ${cleaned} session(s), ${this.sessions.size} remaining`);
    } else {
      logger.debug(`[sidecar] Stale session cleanup: none stale, ${this.sessions.size} active`);
    }
    return cleaned;
  }
}

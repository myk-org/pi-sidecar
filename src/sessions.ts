import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync } from "node:fs";
import { createRequire } from "node:module";
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
const require = createRequire(import.meta.url);

function resolveExtensionPath(envVar: string, packageName: string, entryFile: string): string {
  const envPath = process.env[envVar];
  if (envPath) return envPath;
  try {
    // resolve() finds the package wherever npm installed it (hoisted or nested)
    const pkgJson = require.resolve(`${packageName}/package.json`);
    return join(dirname(pkgJson), entryFile);
  } catch (err) {
    console.debug(`[sidecar] Could not resolve ${packageName}:`, err);
    return "";
  }
}

const ACPX_EXTENSION = resolveExtensionPath("SIDECAR_ACPX_EXTENSION_PATH", "pi-orchestrator-config", "extensions/acpx-provider/index.ts");
const VERTEX_EXTENSION = resolveExtensionPath("SIDECAR_VERTEX_EXTENSION_PATH", "pi-vertex-claude", "index.ts");

interface SessionEntry {
  session: AgentSession;
  lastActivity: number;
  inFlight: boolean;
}

export interface CreateSessionOptions {
  provider: string;
  model: string;
  systemPrompt: string;
  cwd: string;
  customTools?: any[];
}

export class SessionStore {
  private sessions = new Map<string, SessionEntry>();
  private authStorage = AuthStorage.create();
  private modelRegistry = ModelRegistry.create(this.authStorage);
  private _ready = false;
  private acpxModels: Array<{ id: string; name: string; provider: string }> = [];

  get ready(): boolean {
    return this._ready;
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

    return [...builtinModels, ...this.acpxModels];
  }

  /**
   * Discover models from all configured providers. Blocks until complete.
   * Called on startup — /health returns ok only after this finishes.
   */
  async refreshModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    console.debug(`[sidecar] Starting model discovery...`);
    // Create a bootstrap session to trigger extension loading.
    // Extensions like vertex-claude register models synchronously on load.
    // The session is kept alive (disposed at cleanup) to maintain extension state.
    const bootstrapId = await this.create({
      provider: "google",
      model: "gemini-2.5-flash",
      systemPrompt: "bootstrap",
      cwd: "/tmp",
    });
    console.log(`[sidecar] Bootstrap session created for extension loading`);

    // Discover acpx models for each agent in parallel (blocks until all complete)
    const agents = (process.env.ACPX_AGENTS || "")
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);

    if (agents.length > 0) {
      console.log(`[sidecar] Discovering models for ACPX agents: ${agents.join(", ")}`);
      const results = await Promise.allSettled(
        agents.map((agent) => discoverAcpxModels(agent))
      );

      this.acpxModels = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const agent = agents[i];
        if (result.status === "fulfilled" && result.value.length > 0) {
          this.acpxModels.push(...result.value);
          console.log(`[sidecar] acpx-${agent}: ${result.value.length} models discovered`);
        } else if (result.status === "rejected") {
          console.error(`[sidecar] acpx-${agent}: discovery failed:`, result.reason);
        } else {
          console.warn(`[sidecar] acpx-${agent}: no models discovered`);
        }
      }
    }

    // Clean up bootstrap session
    this.delete(bootstrapId);

    this._ready = true;
    console.log(`[sidecar] Model discovery complete: ${this.getModels().length} models available`);
    return this.getModels();
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
      // Check acpx models (discovered at runtime, not in the Pi SDK registry)
      const isAcpxModel = this.acpxModels.some(m => m.id === options.model);
      if (!isAcpxModel) {
        throw new Error(`Model '${options.model}' not found for provider '${options.provider}'. Use GET /models to list available models.`);
      }
      // acpx model found — proceed without a registry model object
      // (createAgentSession will resolve it via the acpx extension)
    }

    const isAcpx = !model && this.acpxModels.some(m => m.id === options.model);
    console.debug(`[sidecar] Model resolved: provider=${options.provider}, model=${options.model}, registryMatch=${!!model}, acpxMatch=${isAcpx}`);

    // Build extension paths (only include existing files)
    const extensionPaths: string[] = [];
    if (ACPX_EXTENSION) {
      try {
        accessSync(ACPX_EXTENSION);
        extensionPaths.push(ACPX_EXTENSION);
        console.log(`[sidecar] Extension found: ${ACPX_EXTENSION}`);
      } catch (err) {
        console.warn(`[sidecar] ACPX extension not found at ${ACPX_EXTENSION}:`, err);
      }
    }
    if (VERTEX_EXTENSION) {
      try {
        accessSync(VERTEX_EXTENSION);
        extensionPaths.push(VERTEX_EXTENSION);
        console.log(`[sidecar] Extension found: ${VERTEX_EXTENSION}`);
      } catch (err) {
        console.warn(`[sidecar] Vertex extension not found at ${VERTEX_EXTENSION}:`, err);
      }
    }
    console.log(`[sidecar] Loading ${extensionPaths.length} extensions`);

    // Build custom tools from config
    const customTools = options.customTools || [];

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
    });

    const loader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: "/tmp/pi-sidecar-agent",
      settingsManager,
      additionalExtensionPaths: extensionPaths,
      systemPromptOverride: () => options.systemPrompt,
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: options.cwd,
      model,
      thinkingLevel: "off",
      tools: ["read", "grep", "find", "ls", "bash"],
      customTools,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
    });

    this.sessions.set(id, { session, lastActivity: Date.now(), inFlight: false });
    console.log(`[sidecar] Session created: ${id} (provider=${options.provider}, model=${options.model}, cwd=${options.cwd}, tools=${options.customTools?.length ?? 0} custom)`);
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

    console.log(`[sidecar] Prompt started: session=${id}, message_length=${message.length}`);

    const errors: string[] = [];
    let responseText = "";
    let textDeltaCount = 0;
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
        }
        console.error(`[sidecar] Prompt error event: session=${id}, error=${errorMsg}`);
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
          console.warn(`[sidecar] No text_delta events captured (${textDeltaCount} deltas). Messages: ${msgSummary}. Extracting from agent_end messages`);
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
      console.error(`[sidecar] Prompt failed: session=${id}, error=${err?.message}`);
      throw err;
    } finally {
      unsubscribe();
      entry.inFlight = false;
      entry.lastActivity = Date.now();
    }

    usage.duration_ms = Date.now() - startTime;
    console.log(`[sidecar] Prompt completed: session=${id}, text_length=${responseText.length}, deltas=${textDeltaCount}, tokens_in=${usage.input_tokens}, tokens_out=${usage.output_tokens}, duration=${usage.duration_ms}ms`);

    // If we got errors from the AI, surface them
    if (errors.length > 0) {
      const errorText = errors.join("; ");
      console.error(`[sidecar] Prompt completed with errors: session=${id}, errors=${errorText}`);
      return { text: responseText, usage, error: errorText };
    }

    // Empty text is valid for tool-only responses — warn but don't error
    if (!responseText) {
      console.warn(`[sidecar] AI returned empty text: session=${id}, tokens_in=${usage.input_tokens}, tokens_out=${usage.output_tokens}`);
    }

    return { text: responseText, usage };
  }

  async abort(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (!entry) throw new Error(`Session ${id} not found`);
    console.debug(`[sidecar] Aborting session: ${id}, inFlight=${entry.inFlight}`);
    await entry.session.abort();
    console.info(`[sidecar] Session aborted: ${id}`);
  }

  delete(id: string): void {
    const entry = this.sessions.get(id);
    if (entry) {
      entry.session.dispose();
      this.sessions.delete(id);
      console.log(`[sidecar] Session deleted: ${id}`);
    }
  }

  disposeAll(): void {
    let count = 0;
    for (const [id, entry] of this.sessions) {
      console.log(`[sidecar] Disposing session: ${id}`);
      entry.session.dispose();
      count++;
    }
    this.sessions.clear();
    console.info(`[sidecar] All sessions disposed (${count} total)`);
  }

  cleanupStale(maxAge: number): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, entry] of this.sessions) {
      if (entry.inFlight) continue;
      if (now - entry.lastActivity > maxAge) {
        console.log(`[sidecar] Cleaning up stale session: ${id}`);
        entry.session.dispose();
        this.sessions.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.info(`[sidecar] Stale session cleanup: removed ${cleaned} session(s), ${this.sessions.size} remaining`);
    }
    return cleaned;
  }
}

/**
 * Discover models from an acpx agent by spawning `acpx --model __list__ <agent> exec x`.
 * Blocks until the subprocess completes or times out (30s).
 */
function discoverAcpxModels(agent: string): Promise<Array<{ id: string; name: string; provider: string }>> {
  return new Promise((resolve, reject) => {
    const models: Array<{ id: string; name: string; provider: string }> = [];
    let output = "";
    let resolved = false;

    const proc = spawn("acpx", ["--model", "__list__", agent, "exec", "x"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn(`[sidecar] acpx discovery for ${agent} timed out after 30s`);
        proc.kill("SIGTERM");
        resolve(models);
      }
    }, 30000);

    proc.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    proc.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });

    proc.on("close", () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      // Parse "Available models: modelId[opts], modelId2[opts], ..."
      const match = output.match(/Available models:\s*(.+)/);
      if (match) {
        const modelList = match[1].trim().replace(/\.$/, "");
        // Bracket-aware split: commas inside [] are part of the model ID
        const entries: string[] = [];
        let current = "";
        let depth = 0;
        for (const ch of modelList) {
          if (ch === "[") depth++;
          else if (ch === "]") depth = Math.max(0, depth - 1);
          if (ch === "," && depth === 0) {
            entries.push(current.trim());
            current = "";
          } else {
            current += ch;
          }
        }
        if (current.trim()) entries.push(current.trim());

        for (const entry of entries) {
          if (!entry) continue;
          const bracketIdx = entry.indexOf("[");
          const baseName = bracketIdx >= 0 ? entry.substring(0, bracketIdx) : entry;
          if (baseName) {
            const name = baseName
              .replace(/-/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase());
            models.push({
              id: `${agent}:${entry}`,
              name: `${name} (${agent})`,
              provider: `acpx-${agent}`,
            });
          }
        }
      }

      resolve(models);
    });

    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

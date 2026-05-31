export { SessionStore, type CreateSessionOptions, type CustomToolConfig, DEFAULT_TOOLS } from "./sessions.js";
export { startWatchdog, type WatchdogOptions } from "./watchdog.js";
export { createHttpToolExecutor, normalizeHttpToolConfig, interpolate, type HttpToolConfig } from "./http-tool-executor.js";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SessionStore } from "./sessions.js";
import { startWatchdog, type WatchdogOptions } from "./watchdog.js";
import { logger } from "./logger.js";

const MAX_BODY_SIZE = 1_048_576;

// Simple JSON body parser
export async function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bodySizeBytes = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      bodySizeBytes += chunk.length;
      if (bodySizeBytes > MAX_BODY_SIZE) {
        rejected = true;
        req.resume();
        logger.warn(`[sidecar] Request body too large: size=${bodySizeBytes}, max=${MAX_BODY_SIZE}`);
        reject(new Error("Payload too large"));
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        logger.warn(`[sidecar] Invalid JSON body: size=${body.length}`);
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function routeMatch(url: string, pattern: string): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const urlParts = url.split("?")[0].split("/");
  if (patternParts.length !== urlParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = urlParts[i];
    } else if (patternParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

export interface SidecarHandle {
  close(): Promise<void>;
}

export function startSidecar(options?: { port?: number; host?: string; watchdogUrl?: string; watchdogOptions?: WatchdogOptions }): SidecarHandle {
  const PORT = options?.port ?? parseInt(process.env.SIDECAR_PORT || "9100", 10);
  const HOST = options?.host ?? (process.env.DEV_MODE === "true" ? "0.0.0.0" : "127.0.0.1");

  const store = new SessionStore();

  const server = createServer(async (req, res) => {
    const method = req.method || "GET";
    const url = req.url || "/";
    const requestStart = Date.now();

    try {
      // GET /health
      if (method === "GET" && url === "/health") {
        if (!store.ready) {
          logger.debug(`[sidecar] GET /health 503: status=starting`);
          sendJson(res, 503, { status: "starting", message: "Model discovery in progress" });
          return;
        }
        if (store.discoveryError) {
          logger.debug(`[sidecar] GET /health 200: status=degraded, sessions=${store.count()}`);
          sendJson(res, 200, {
            status: "degraded",
            message: "Model discovery failed",
            sessions: store.count(),
          });
          return;
        }
        logger.debug(`[sidecar] GET /health 200: status=ok, sessions=${store.count()}`);
        sendJson(res, 200, { status: "ok", sessions: store.count() });
        return;
      }

      // GET /models
      if (method === "GET" && url === "/models") {
        const models = store.getModels();
        logger.debug(`[sidecar] GET /models 200 ${Date.now() - requestStart}ms: count=${models.length}`);
        sendJson(res, 200, { models });
        return;
      }

      // POST /models/refresh
      if (method === "POST" && url === "/models/refresh") {
        const models = await store.refreshModels();
        logger.info(`[sidecar] POST /models/refresh 200 ${Date.now() - requestStart}ms models=${models.length}`);
        sendJson(res, 200, { models });
        return;
      }

      // POST /sessions
      if (method === "POST" && url === "/sessions") {
        const body = await parseBody(req);
        const { provider, model, system_prompt, cwd, custom_tools, tools } = body;
        if (typeof provider !== "string" || provider.length === 0 || typeof system_prompt !== "string" || system_prompt.length === 0) {
          logger.warn(`[sidecar] POST /sessions 400 ${Date.now() - requestStart}ms: validation=failed, field=provider|system_prompt, reason=must be non-empty strings`);
          sendJson(res, 400, { error: "provider and system_prompt are required and must be non-empty strings" });
          return;
        }
        if (typeof model !== "string" || model.length === 0) {
          logger.warn(`[sidecar] POST /sessions 400 ${Date.now() - requestStart}ms: validation=failed, field=model, reason=must be non-empty string`);
          sendJson(res, 400, { error: "model is required and must be a non-empty string. Use GET /models to list available models." });
          return;
        }
        if (cwd !== undefined && typeof cwd !== "string") {
          logger.warn(`[sidecar] POST /sessions 400 ${Date.now() - requestStart}ms: validation=failed, field=cwd, reason=must be string`);
          sendJson(res, 400, { error: "cwd must be a string" });
          return;
        }
        if (tools !== undefined) {
          if (!Array.isArray(tools) || !tools.every((t: any) => typeof t === "string")) {
            logger.warn(`[sidecar] POST /sessions 400 ${Date.now() - requestStart}ms: validation=failed, field=tools, reason=must be array of strings`);
            sendJson(res, 400, { error: "tools must be an array of strings" });
            return;
          }
        }
        if (custom_tools !== undefined) {
          if (!Array.isArray(custom_tools)) {
            logger.warn(`[sidecar] POST /sessions 400 ${Date.now() - requestStart}ms: validation=failed, field=custom_tools, reason=must be array`);
            sendJson(res, 400, { error: "custom_tools must be an array" });
            return;
          }
          if (!custom_tools.every((t: any) => t != null && typeof t === "object" && !Array.isArray(t) && typeof t.name === "string" && t.name.length > 0)) {
            logger.warn(`[sidecar] POST /sessions 400 ${Date.now() - requestStart}ms: validation=failed, field=custom_tools, reason=entries must be plain objects with string name`);
            sendJson(res, 400, { error: "custom_tools entries must be plain objects with a string 'name' property" });
            return;
          }
        }
        const sessionId = await store.create({
          provider,
          model,
          systemPrompt: system_prompt,
          cwd: cwd || process.cwd(),
          tools,
          customTools: custom_tools,
        });
        logger.info(`[sidecar] POST /sessions 201 ${Date.now() - requestStart}ms session=${sessionId} provider=${provider} model=${model}`);
        sendJson(res, 201, { session_id: sessionId });
        return;
      }

      // POST /sessions/:id/prompt
      let params = routeMatch(url, "/sessions/:id/prompt");
      if (method === "POST" && params) {
        const body = await parseBody(req);
        if (!body.message) {
          logger.warn(`[sidecar] POST /sessions/${params.id}/prompt 400: message is required`);
          sendJson(res, 400, { error: "message is required" });
          return;
        }
        logger.debug(`[sidecar] POST /sessions/${params.id}/prompt: message_length=${body.message.length}`);
        const result = await store.prompt(params.id, body.message);
        logger.info(`[sidecar] POST /sessions/${params.id}/prompt 200 ${Date.now() - requestStart}ms text_length=${result.text.length}${result.error ? ` error=${result.error}` : ""}`);
        sendJson(res, 200, result);
        return;
      }

      // POST /sessions/:id/abort
      params = routeMatch(url, "/sessions/:id/abort");
      if (method === "POST" && params) {
        logger.debug(`[sidecar] POST /sessions/${params.id}/abort: processing`);
        await store.abort(params.id);
        logger.info(`[sidecar] POST /sessions/${params.id}/abort 200 ${Date.now() - requestStart}ms`);
        sendJson(res, 200, { aborted: true });
        return;
      }

      // DELETE /sessions/:id
      params = routeMatch(url, "/sessions/:id");
      if (method === "DELETE" && params) {
        logger.debug(`[sidecar] DELETE /sessions/${params.id}: processing`);
        store.delete(params.id);
        logger.info(`[sidecar] DELETE /sessions/${params.id} 200 ${Date.now() - requestStart}ms`);
        sendJson(res, 200, { deleted: true });
        return;
      }

      logger.debug(`[sidecar] Route not found: ${method} ${url}`);
      sendJson(res, 404, { error: "Not found" });
    } catch (err: any) {
      const message = err?.message || "Internal server error";
      const status = message.includes("not found for provider") ? 400
        : message.includes("Model is required") ? 400
        : message.includes("Payload too large") ? 413
        : message.includes("Invalid JSON") ? 400
        : message.includes("is busy") ? 409
        : message.includes("not found") ? 404
        : 500;
      if (status === 500) {
        logger.error(`[sidecar] ${method} ${url} ${status} ${Date.now() - requestStart}ms`, err);
      } else {
        logger.error(`[sidecar] ${method} ${url} ${status} ${Date.now() - requestStart}ms error:`, message);
      }
      sendJson(res, status, { error: message });
    }
  });

  // Stale session cleanup every 10 minutes
  const cleanupInterval = setInterval(() => {
    logger.debug(`[sidecar] Running stale session cleanup`);
    const cleaned = store.cleanupStale(60 * 60 * 1000); // 1 hour
    logger.debug(`[sidecar] Stale cleanup result: removed=${cleaned}`);
  }, 10 * 60 * 1000);

  let stopWatchdog: (() => void) | undefined;

  server.listen(PORT, HOST, () => {
    logger.info(`[sidecar] Pi SDK sidecar listening on http://${HOST}:${PORT}`);
    logger.info(`[sidecar] Config: host=${HOST}, port=${PORT}, devMode=${process.env.DEV_MODE || 'false'}, logLevel=${process.env.PI_SIDECAR_LOG_LEVEL || 'info'}`);
    const watchdogUrl = options?.watchdogUrl || process.env.SIDECAR_WATCHDOG_URL;
    if (watchdogUrl) {
      logger.info(`[sidecar] Watchdog enabled: url=${watchdogUrl}`);
      stopWatchdog = startWatchdog(watchdogUrl, () => {
        logger.warn("[sidecar] Backend unresponsive, shutting down");
        stopWatchdog?.();
        clearInterval(cleanupInterval);
        store.disposeAll();
        server.close();
      }, options?.watchdogOptions);
    } else {
      logger.info("[sidecar] Watchdog disabled (no SIDECAR_WATCHDOG_URL)");
    }

    // Auto-discover models from extensions on startup
    store.refreshModels().catch((err) => {
      logger.error("[sidecar] Model discovery failed:", err);
    });
  });

  return {
    close: () => new Promise<void>((resolve, reject) => {
      logger.info("[sidecar] Shutting down...");
      stopWatchdog?.();
      clearInterval(cleanupInterval);
      store.disposeAll();
      server.close((err) => {
        if (err) reject(err);
        else resolve();
        logger.info("[sidecar] Shut down");
      });
    }),
  };
}

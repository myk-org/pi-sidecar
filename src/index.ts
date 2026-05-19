export { SessionStore, type CreateSessionOptions } from "./sessions.js";
export { startWatchdog, type WatchdogOptions } from "./watchdog.js";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SessionStore } from "./sessions.js";
import { startWatchdog, type WatchdogOptions } from "./watchdog.js";

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
        reject(new Error("Payload too large"));
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
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

    try {
      // GET /health
      if (method === "GET" && url === "/health") {
        if (!store.ready) {
          sendJson(res, 503, { status: "starting", message: "Model discovery in progress" });
          return;
        }
        sendJson(res, 200, { status: "ok", sessions: store.count() });
        return;
      }

      // GET /models
      if (method === "GET" && url === "/models") {
        sendJson(res, 200, { models: store.getModels() });
        return;
      }

      // POST /models/refresh
      if (method === "POST" && url === "/models/refresh") {
        const models = await store.refreshModels();
        sendJson(res, 200, { models });
        return;
      }

      // POST /sessions
      if (method === "POST" && url === "/sessions") {
        const body = await parseBody(req);
        const { provider, model, system_prompt, cwd, custom_tools } = body;
        if (!provider || !system_prompt) {
          sendJson(res, 400, { error: "provider and system_prompt are required" });
          return;
        }
        if (!model) {
          sendJson(res, 400, { error: "model is required. Use GET /models to list available models." });
          return;
        }
        const sessionId = await store.create({
          provider,
          model: model || "",
          systemPrompt: system_prompt,
          cwd: cwd || process.cwd(),
          customTools: custom_tools,
        });
        sendJson(res, 201, { session_id: sessionId });
        return;
      }

      // POST /sessions/:id/prompt
      let params = routeMatch(url, "/sessions/:id/prompt");
      if (method === "POST" && params) {
        const body = await parseBody(req);
        if (!body.message) {
          sendJson(res, 400, { error: "message is required" });
          return;
        }
        const result = await store.prompt(params.id, body.message);
        sendJson(res, 200, result);
        return;
      }

      // POST /sessions/:id/abort
      params = routeMatch(url, "/sessions/:id/abort");
      if (method === "POST" && params) {
        await store.abort(params.id);
        sendJson(res, 200, { aborted: true });
        return;
      }

      // DELETE /sessions/:id
      params = routeMatch(url, "/sessions/:id");
      if (method === "DELETE" && params) {
        store.delete(params.id);
        sendJson(res, 200, { deleted: true });
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err: any) {
      const message = err?.message || "Internal server error";
      const status = message.includes("not found") ? 404 : message.includes("Payload too large") ? 413 : message.includes("Invalid JSON") ? 400 : message.includes("is busy") ? 409 : 500;
      console.error(`[sidecar] ${method} ${url} error:`, message);
      sendJson(res, status, { error: message });
    }
  });

  // Stale session cleanup every 10 minutes
  const cleanupInterval = setInterval(() => {
    store.cleanupStale(60 * 60 * 1000); // 1 hour
  }, 10 * 60 * 1000);

  let stopWatchdog: (() => void) | undefined;

  server.listen(PORT, HOST, () => {
    console.log(`[sidecar] Pi SDK sidecar listening on http://${HOST}:${PORT}`);
    const watchdogUrl = options?.watchdogUrl || process.env.SIDECAR_WATCHDOG_URL;
    if (watchdogUrl) {
      stopWatchdog = startWatchdog(watchdogUrl, () => {
        console.log("[sidecar] Backend unresponsive, shutting down");
        stopWatchdog?.();
        clearInterval(cleanupInterval);
        store.disposeAll();
        server.close();
      }, options?.watchdogOptions);
    }

    // Auto-discover models from extensions on startup
    store.refreshModels().catch((err) => {
      console.error("[sidecar] Model discovery failed:", err);
    });
  });

  return {
    close: () => new Promise<void>((resolve, reject) => {
      stopWatchdog?.();
      clearInterval(cleanupInterval);
      store.disposeAll();
      server.close((err) => {
        if (err) reject(err);
        else resolve();
        console.log("[sidecar] Shut down");
      });
    }),
  };
}

# Server Deployment Scenarios

## Programmatic TypeScript Startup
Embed the sidecar directly inside an existing Node.js application instead of running it as a standalone shell process.

```typescript
import { startSidecar } from "@myk-org/pi-sidecar";

const handle = startSidecar({
  port: 9200,
  host: "127.0.0.1"
});

console.log("Sidecar started on http://127.0.0.1:9200");

// Later, you can gracefully stop it:
// await handle.close();
```

Use `startSidecar()` when you need your TypeScript/Node application to manage the sidecar lifecycle. This gives you a `SidecarHandle` object with a `close()` method, ensuring clean shutdown logic instead of forcefully killing spawned subprocesses.

*   **Tip:** `startSidecar()` will automatically enforce the Pi SDK version floor upon initialization and throw synchronously if the SDK is outdated.

## Configure Watchdog Health-Checks
Automatically shut down the sidecar when your primary backend application becomes unresponsive.

```typescript
import { startSidecar } from "@myk-org/pi-sidecar";

const handle = startSidecar({
  port: 9100,
  watchdogUrl: "http://localhost:8000/health",
  watchdogOptions: {
    startDelayMs: 60000, // Wait 60s before first check
    intervalMs: 30000,   // Poll every 30s
    timeoutMs: 10000,    // Cancel request after 10s
    maxFailures: 6       // Shut down after 6 consecutive fails
  }
});
```

This configuration ensures the sidecar doesn't outlive its companion backend (avoiding zombie processes). It waits through a grace period (`startDelayMs`), then polls the `watchdogUrl`. If it fails continuously for the `maxFailures` threshold, the sidecar safely disposes of all sessions and shuts itself down.

*   **Tip:** If you're starting the sidecar via the command line instead of code, you can enable the watchdog by setting `SIDECAR_WATCHDOG_URL=http://localhost:8000/health`. See [Environment Variables](environment-variables.html).

## Expose to Remote Callers (Non-Loopback Binds)
Bind the sidecar to `0.0.0.0` to allow client requests from outside the local machine.

```typescript
import { startSidecar } from "@myk-org/pi-sidecar";

const handle = startSidecar({
  host: "0.0.0.0", // Expose to external network
  port: 9100
});
```

By default, the sidecar binds to `127.0.0.1` and assumes a local trust boundary (no built-in authentication). If you bind to `0.0.0.0` or another non-loopback IP, the sidecar applies extra security rules to untrusted callers.

> **Note:** On non-loopback binds, caller-provided `agent_dir` paths are completely rejected with an HTTP 400 error to prevent directory traversal. Additionally, sensitive credential information on the `/models/:provider/status` endpoint is strictly redacted. 

## Graceful Process Termination (SIGINT)
Ensure in-flight requests and internal runtimes finish cleaning up when your process receives a termination signal.

```typescript
import { startSidecar } from "@myk-org/pi-sidecar";

const handle = startSidecar();

process.on("SIGINT", async () => {
  console.log("\nShutting down sidecar gracefully...");
  await handle.close();
  process.exit(0);
});
```

Calling `handle.close()` does not abruptly kill active queries. It prevents new sessions from starting, waits (up to 30 seconds) for currently active requests to drain, properly disposes the internal `AgentSessionRuntime`, and triggers extension shutdown hooks before finally closing the HTTP server. 

## Run in Development Mode
Bypass strict non-loopback restrictions temporarily during local network testing.

```bash
# Start via CLI with DEV_MODE
DEV_MODE=true npx tsx src/server.ts
```

Setting `DEV_MODE=true` forces the sidecar to bind to `0.0.0.0`. While `agent_dir` parameters from incoming requests are normally rejected outright on non-local binds, `DEV_MODE` allows the request to succeed by silently discarding the directory payload and emitting a warning in the logs.

*   **Warning:** Never use `DEV_MODE=true` in a production environment. See [Environment Variables](environment-variables.html) for more configuration options.

## Related Pages

- [Environment Variables](environment-variables.html)
- [Runtime Architecture](runtime-architecture.html)
- [Configuring Model Providers](configuring-providers.html)
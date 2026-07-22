# Embedding the Sidecar in a Node.js Application

Start the pi-sidecar HTTP server directly from your own TypeScript or Node.js process — no separate CLI needed — so your application controls the server lifecycle, port, and shutdown behavior.

## Prerequisites

- **Node.js ≥ 22.19**
- The `@myk-org/pi-sidecar` npm package installed in your project:
  ```bash
  npm install @myk-org/pi-sidecar
  ```

## Quick Example

```ts
import { startSidecar } from "@myk-org/pi-sidecar";

const handle = startSidecar({ port: 9200 });

// Later, shut down cleanly:
await handle.close();
```

This starts the sidecar on `http://127.0.0.1:9200`, discovers available models, and returns a handle you use to stop it.

## Step-by-Step: Embedding in Your Application

### 1. Import and start the sidecar

Call `startSidecar()` with the options your application needs. All options are optional — defaults work out of the box:

```ts
import { startSidecar } from "@myk-org/pi-sidecar";

const handle = startSidecar({
  port: 9200,
  host: "127.0.0.1",
});

console.log("Sidecar started on http://127.0.0.1:9200");
```

The server begins listening immediately and starts model discovery in the background. The `/health` endpoint returns `503` until discovery completes, then switches to `200`.

### 2. Use the sidecar from your application

Once started, make HTTP requests to the sidecar from anywhere in your process — or from the Python client on the same host. Point your client at the port you chose:

```ts
// Example: check health from the same process
const res = await fetch("http://127.0.0.1:9200/health");
const data = await res.json();
console.log(data); // { status: "ok", sessions: 0 }
```

See [REST API Reference](rest-api-reference.html) for all available endpoints, or [Python Client Recipes](recipes-python-client.html) for calling the sidecar from Python.

### 3. Shut down gracefully

The `close()` method disposes all active sessions, stops the watchdog (if enabled), cancels stale-session cleanup, and closes the HTTP server:

```ts
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await handle.close();
  process.exit(0);
});
```

> **Warning:** Calling `process.exit()` without `await handle.close()` will abandon active AI sessions without cleanup.

## Startup Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `9100` | TCP port the HTTP server listens on |
| `host` | `string` | `"127.0.0.1"` | Bind address; localhost-only by default |
| `watchdogUrl` | `string` | *none* | Health endpoint URL of a companion backend to monitor |
| `watchdogOptions` | `object` | *see below* | Fine-tune watchdog polling behavior |

Each option can also be set via an environment variable. Programmatic options take priority:

| Option | Environment Variable | Default |
|--------|---------------------|---------|
| `port` | `SIDECAR_PORT` | `9100` |
| `host` | `SIDECAR_HOST`, else `DEV_MODE=true` → `"0.0.0.0"` | `"127.0.0.1"` |
| `watchdogUrl` | `SIDECAR_WATCHDOG_URL` | *none* |

See [Configuration and Environment Variables](configuration-reference.html) for the full list of environment variables.

## Advanced Usage

### Monitoring a companion backend with the watchdog

If your application includes a separate backend (for example, a web server on port 8000), the watchdog can automatically shut down the sidecar when that backend becomes unresponsive:

```ts
const handle = startSidecar({
  port: 9200,
  watchdogUrl: "http://localhost:8000/health",
  watchdogOptions: {
    intervalMs: 15_000,    // Check every 15 seconds
    timeoutMs: 5_000,      // 5-second timeout per check
    maxFailures: 4,        // Shut down after 4 consecutive failures
    startDelayMs: 30_000,  // Wait 30 seconds before first check
  },
});
```

**Watchdog option defaults:**

| Option | Default | Description |
|--------|---------|-------------|
| `intervalMs` | `30000` (30s) | Time between health checks |
| `timeoutMs` | `10000` (10s) | Timeout for each health check request |
| `maxFailures` | `6` | Consecutive failures before triggering shutdown |
| `startDelayMs` | `60000` (60s) | Grace period before the first check |

When `maxFailures` consecutive checks fail, the watchdog disposes all sessions and closes the server — your `handle.close()` promise resolves and the process can exit.

See [Monitoring a Companion Backend with the Watchdog](configuring-watchdog.html) for detailed watchdog behavior and recovery patterns.

### Running with `tsx` for development

During development, use `tsx` to run TypeScript files directly without a build step:

```bash
npx tsx start-sidecar.ts
```

### Full embedded example

This example starts the sidecar, handles signals, and connects a watchdog:

```ts
import { startSidecar } from "@myk-org/pi-sidecar";

const handle = startSidecar({
  port: 9200,
  host: "127.0.0.1",
  watchdogUrl: "http://localhost:8000/health",
});

console.log("Sidecar started on http://127.0.0.1:9200");
console.log("Press Ctrl+C to stop\n");

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await handle.close();
  process.exit(0);
});
```

### Controlling log verbosity

Set the `PI_SIDECAR_LOG_LEVEL` environment variable before starting your process. The sidecar reads this value at import time:

```bash
PI_SIDECAR_LOG_LEVEL=debug npx tsx start-sidecar.ts
```

Available levels: `debug`, `info` (default), `warn`, `error`.

> **Note:** Because the log level is read once at import time, you cannot change it after the process starts.

### Binding to all interfaces

By default, the sidecar binds to `127.0.0.1` (localhost only). To open it to all network interfaces — for example, inside a container — either pass `host: "0.0.0.0"` or set `DEV_MODE=true`:

```ts
const handle = startSidecar({
  port: 9200,
  host: "0.0.0.0",
});
```

> **Warning:** The sidecar has **no authentication**. Binding to `0.0.0.0` exposes it to the entire network. Only do this in trusted environments (containers, private networks). See [Configuration and Environment Variables](configuration-reference.html) for the security implications of `DEV_MODE`.

## Troubleshooting

**The `/health` endpoint returns `503 starting`**
Model discovery runs in the background after startup. Wait a few seconds and retry. If it stays at `503`, check the process logs for discovery errors.

**Port already in use (`EADDRINUSE`)**
Another process is using the port. Change the `port` option or stop the other process. The default port is `9100`.

**`handle.close()` hangs**
This usually means a session has an in-flight prompt. The server waits for active connections to drain. Call the `/sessions/:id/abort` endpoint first to cancel long-running prompts, then call `close()`. See [Managing Session Lifecycle](managing-sessions.html) for abort patterns.

**Watchdog shuts down the sidecar unexpectedly**
The companion backend may have become temporarily unreachable. Increase `maxFailures` or `startDelayMs` in `watchdogOptions` to tolerate brief outages. The default tolerance is ~3 minutes (6 failures × 30s interval).

## Related Pages

- [Monitoring a Companion Backend with the Watchdog](configuring-watchdog.html)
- [Configuration and Environment Variables](configuration-reference.html)
- [REST API Reference](rest-api-reference.html)
- [Getting Started with pi-sidecar](quickstart.html)
- [Managing Session Lifecycle](managing-sessions.html)
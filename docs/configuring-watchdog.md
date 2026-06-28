# Monitoring a Companion Backend with the Watchdog

If your sidecar runs alongside another service (e.g., a web backend), you can automatically shut the sidecar down when that companion service becomes unresponsive. The watchdog polls a health endpoint and triggers a clean shutdown after repeated failures, preventing the sidecar from running indefinitely without its partner.

## Prerequisites

- A running pi-sidecar instance (see [Getting Started with pi-sidecar](quickstart.html))
- A companion backend that exposes an HTTP health endpoint (returning any `2xx` status when healthy)

## Quick Example

Set the `SIDECAR_WATCHDOG_URL` environment variable before starting the sidecar:

```bash
SIDECAR_WATCHDOG_URL=http://localhost:8000/health node dist/server.js
```

That's it. The sidecar will now monitor `http://localhost:8000/health` and shut itself down if the backend stops responding.

## How the Watchdog Works

The watchdog follows a simple lifecycle:

1. **Grace period** — waits 60 seconds after startup before the first check, giving the companion backend time to initialize.
2. **Polling** — sends an HTTP GET to the health URL every 30 seconds.
3. **Failure counting** — increments a counter on each failed check (network error, timeout, or non-`2xx` response). A successful check resets the counter to zero.
4. **Shutdown** — after 6 consecutive failures (~3 minutes of downtime), the sidecar cleans up all sessions and shuts down.

> **Note:** The watchdog is completely opt-in. If you don't set `SIDECAR_WATCHDOG_URL`, the sidecar runs indefinitely with no health-check polling.

## Enabling the Watchdog

You have two options, depending on how you run the sidecar.

### Option 1: Environment Variable

Set `SIDECAR_WATCHDOG_URL` to your companion's health endpoint:

```bash
export SIDECAR_WATCHDOG_URL=http://localhost:8000/health
node dist/server.js
```

### Option 2: Programmatic Startup (TypeScript)

Pass `watchdogUrl` when starting the sidecar from code:

```typescript
import { startSidecar } from "@myk-org/pi-sidecar";

const handle = startSidecar({
  port: 9200,
  host: "127.0.0.1",
  watchdogUrl: "http://localhost:8000/health",
});
```

See [Embedding the Sidecar in a Node.js Application](embedding-in-node.html) for more on programmatic startup.

## What Counts as a Failure

Each poll check can succeed or fail:

| Outcome | Effect |
|---------|--------|
| HTTP `2xx` response | Success — failure counter resets to 0 |
| HTTP `4xx` or `5xx` response | Failure — counter increments |
| Network error (connection refused, DNS failure) | Failure — counter increments |
| Request timeout (exceeds 10 seconds) | Failure — counter increments |

> **Tip:** If your health endpoint is slow, consider increasing the `timeoutMs` option (see Advanced Usage below) to avoid false positives.

## What Happens at Shutdown

When the watchdog reaches its failure threshold, it performs a clean shutdown:

1. Stops the watchdog polling
2. Disposes all active AI sessions
3. Closes the HTTP server

Any in-flight prompt requests will receive an error response. Python clients will see an `httpx` connection error on their next request.

## Advanced Usage

### Customizing Timing Parameters

When starting the sidecar programmatically, pass a `watchdogOptions` object to fine-tune the watchdog behavior:

```typescript
import { startSidecar } from "@myk-org/pi-sidecar";

const handle = startSidecar({
  watchdogUrl: "http://localhost:8000/health",
  watchdogOptions: {
    intervalMs: 15_000,    // Poll every 15 seconds (default: 30,000)
    timeoutMs: 5_000,      // 5-second request timeout (default: 10,000)
    maxFailures: 10,       // Tolerate 10 failures before shutdown (default: 6)
    startDelayMs: 120_000, // Wait 2 minutes before first check (default: 60,000)
  },
});
```

| Option | Default | Minimum | Description |
|--------|---------|---------|-------------|
| `intervalMs` | `30000` (30s) | `1000` | Time between health checks |
| `timeoutMs` | `10000` (10s) | `1000` | Per-request timeout for each health check |
| `maxFailures` | `6` | `1` | Consecutive failures before shutdown |
| `startDelayMs` | `60000` (60s) | `0` | Grace period before first health check |

> **Note:** Values below the minimum are automatically clamped. For example, setting `intervalMs: 500` will use `1000`.

### Calculating Time-to-Shutdown

The maximum time before the watchdog triggers a shutdown is:

```
startDelayMs + (maxFailures × intervalMs)
```

With defaults: **60s + (6 × 30s) = 240 seconds (4 minutes)**

Adjust these values based on how quickly you need the sidecar to shut down after the backend fails versus how tolerant you want to be of transient outages.

### Recovery Before Threshold

The failure counter resets on any successful health check. If the backend recovers before reaching `maxFailures`, the sidecar continues running normally. For example, with the default `maxFailures` of 6:

- Check 1: ❌ failure (count: 1)
- Check 2: ❌ failure (count: 2)
- Check 3: ✅ success (count: **0** — reset)
- Check 4: ❌ failure (count: 1)

The sidecar stays alive because the counter never reaches 6.

## Troubleshooting

### Watchdog shuts down the sidecar too quickly

Increase `maxFailures` or `intervalMs` to tolerate longer outages. A companion backend that restarts might need a higher threshold:

```typescript
watchdogOptions: {
  maxFailures: 12,      // ~6 minutes of downtime tolerated
  intervalMs: 30_000,
}
```

### Watchdog doesn't activate

- Verify the environment variable is set: `echo $SIDECAR_WATCHDOG_URL`
- Check the sidecar logs for either `Watchdog enabled: url=...` or `Watchdog disabled (no SIDECAR_WATCHDOG_URL)` — this prints at startup
- Set `PI_SIDECAR_LOG_LEVEL=debug` for detailed watchdog polling output

See [Configuration and Environment Variables](configuration-reference.html) for all available environment variables.

### Health endpoint returns 2xx but the backend is actually unhealthy

The watchdog only checks HTTP status codes — it does not inspect the response body. Make sure your companion backend's health endpoint returns a non-`2xx` status (e.g., `503`) when it is not ready to serve traffic.

## Related Pages

- [Embedding the Sidecar in a Node.js Application](embedding-in-node.html)
- [Configuration and Environment Variables](configuration-reference.html)
- [Getting Started with pi-sidecar](quickstart.html)
- [REST API Reference](rest-api-reference.html)
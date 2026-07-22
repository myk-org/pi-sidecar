Let me start by reading the graph report and page manifest, then explore the source files for all configuration and environment variables.

Now let me check the Python client for environment variables it uses:

Now let me check for any additional environment variables I might have missed:

Now let me check the examples for startup options usage:

Now I have all the information I need. Let me compose the reference page.

# Configuration and Environment Variables

Reference for all environment variables and programmatic startup options that control the pi-sidecar server and Python client behavior.

---

## Environment Variables — Sidecar Server (TypeScript)

These environment variables are read by the `@myk-org/pi-sidecar` Node.js server process.

### `SIDECAR_PORT`

| Property | Value |
|----------|-------|
| **Type** | Integer (string-encoded) |
| **Default** | `9100` |
| **Read by** | `startSidecar()` in `src/index.ts` |

TCP port the sidecar HTTP server listens on. Overridden by the `port` option in `startSidecar()`.

```bash
SIDECAR_PORT=9200 node dist/server.js
```

---

### `DEV_MODE`

| Property | Value |
|----------|-------|
| **Type** | String (`"true"` to enable) |
| **Default** | Not set (disabled) |
| **Read by** | `startSidecar()` in `src/index.ts` |

Controls two behaviors:

| Behavior | `DEV_MODE` unset / not `"true"` | `DEV_MODE=true` |
|----------|-------------------------------|-----------------|
| **Bind address** | `127.0.0.1` (localhost only) | `0.0.0.0` (all interfaces) |
| **`agent_dir` handling** | On loopback: validated (absolute existing directory) and passed to the Pi SDK. On non-loopback (e.g. `SIDECAR_HOST`): requests that include `agent_dir` get HTTP 400 | Type-checked but value is **discarded** with an `AGENT_DIR_IGNORED` warning — prevents remote callers from steering resource loading |

> **Warning:** Setting `DEV_MODE=true` exposes the sidecar on all network interfaces. The sidecar has **no authentication**. Only use this in trusted development environments.

```bash
DEV_MODE=true SIDECAR_PORT=9100 node dist/server.js
```

---

### `PI_SIDECAR_LOG_LEVEL`

| Property | Value |
|----------|-------|
| **Type** | String: `debug`, `info`, `warn`, or `error` |
| **Default** | `info` |
| **Read by** | `src/logger.ts` (TypeScript server), `pi_sidecar_client/__init__.py` (Python client) |

Controls log verbosity for **both** the TypeScript sidecar server and the Python client. Log messages at or above the configured level are emitted; messages below are suppressed.

| Level | Output includes |
|-------|----------------|
| `debug` | All messages: request tracing, model resolution, internal details |
| `info` | Lifecycle events, request completions with timing, model discovery |
| `warn` | Validation failures, empty responses, cleanup failures |
| `error` | Operation failures, AI errors, unhandled exceptions |

```bash
PI_SIDECAR_LOG_LEVEL=debug node dist/server.js
```

---

### `ACPX_AGENTS`

| Property | Value |
|----------|-------|
| **Type** | Comma-separated string of agent names |
| **Default** | `""` (empty — no ACPX discovery) |
| **Read by** | `SessionStore.refreshModels()` in `src/sessions.ts` |

List of ACPX agent names to discover models from at startup and on `POST /models/refresh`. Each agent is queried via the `acpx/runtime` library with a 30-second timeout. Agent names must match the pattern `[a-z0-9_-]+`.

Discovered models are registered with provider `acpx-<agent>` and model IDs prefixed with `<agent>:` (e.g., `cursor:gpt-5.4[context=272k,reasoning=medium]`).

```bash
ACPX_AGENTS=cursor node dist/server.js
```

```bash
ACPX_AGENTS=cursor,windsurf node dist/server.js
```

---

### `SIDECAR_WATCHDOG_URL`

| Property | Value |
|----------|-------|
| **Type** | URL string |
| **Default** | Not set (watchdog disabled) |
| **Read by** | `startSidecar()` in `src/index.ts` |

Health endpoint URL for the companion backend watchdog. When set, the sidecar polls this URL periodically and shuts down after repeated failures. Overridden by the `watchdogUrl` option in `startSidecar()`.

See [Monitoring a Companion Backend with the Watchdog](configuring-watchdog.html) for usage patterns.

```bash
SIDECAR_WATCHDOG_URL=http://localhost:8000/health node dist/server.js
```

---

### `SIDECAR_ACPX_EXTENSION_PATH`

| Property | Value |
|----------|-------|
| **Type** | Absolute file path |
| **Default** | Auto-resolved from `pi-orchestrator-config` package (`extensions/acpx-provider/index.ts`) |
| **Read by** | `resolveExtensionPath()` in `src/sessions.ts` |

Overrides the auto-detected path to the ACPX provider extension file. Use this when the extension is installed in a non-standard location.

```bash
SIDECAR_ACPX_EXTENSION_PATH=/opt/extensions/acpx-provider/index.ts node dist/server.js
```

---

### `SIDECAR_VERTEX_EXTENSION_PATH`

| Property | Value |
|----------|-------|
| **Type** | Absolute file path |
| **Default** | Auto-resolved from `pi-vertex-claude` package (`index.ts`) |
| **Read by** | `resolveExtensionPath()` in `src/sessions.ts` |

Overrides the auto-detected path to the Vertex Claude extension file. Use this when the extension is installed in a non-standard location.

```bash
SIDECAR_VERTEX_EXTENSION_PATH=/opt/extensions/pi-vertex-claude/index.ts node dist/server.js
```

---

## Environment Variables — Python Client

These environment variables are read by the `pi_sidecar_client` Python package.

### `SIDECAR_URL`

| Property | Value |
|----------|-------|
| **Type** | URL string |
| **Default** | `http://127.0.0.1:9100` |
| **Read by** | `pi_sidecar_client/__init__.py` |

Base URL of the sidecar HTTP server. Used by `SidecarClient` and all convenience functions (`call_ai`, `call_ai_once`, `list_models`, `check_sidecar_available`).

```bash
export SIDECAR_URL=http://127.0.0.1:9200
python -c "from pi_sidecar_client import check_sidecar_available; import asyncio; print(asyncio.run(check_sidecar_available()))"
```

You can also override per-client by passing `base_url` to the `SidecarClient` constructor:

```python
from pi_sidecar_client import SidecarClient

client = SidecarClient(base_url="http://127.0.0.1:9200")
```

---

### `PI_SIDECAR_LOG_LEVEL` (Python)

| Property | Value |
|----------|-------|
| **Type** | String: `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| **Default** | `INFO` |
| **Read by** | `pi_sidecar_client/__init__.py` |

Controls the Python client's log verbosity. This is the same variable name used by the TypeScript server, so a single export configures both when running on the same host.

> **Note:** The Python client accepts standard Python logging level names (uppercase), while the TypeScript server accepts lowercase. Both read from the same `PI_SIDECAR_LOG_LEVEL` variable. Setting `debug` works for both since the Python logger normalizes case.

```bash
PI_SIDECAR_LOG_LEVEL=DEBUG python my_script.py
```

---

## Programmatic Startup Options (`startSidecar`)

The `startSidecar()` function accepts an options object for programmatic embedding. These options **take precedence** over their corresponding environment variables.

See [Embedding the Sidecar in a Node.js Application](embedding-in-node.html) for integration patterns.

```typescript
import { startSidecar } from "@myk-org/pi-sidecar";

const handle = startSidecar({
  port: 9200,
  host: "127.0.0.1",
  watchdogUrl: "http://localhost:8000/health",
  watchdogOptions: {
    intervalMs: 15_000,
    timeoutMs: 5_000,
    maxFailures: 3,
    startDelayMs: 30_000,
  },
});
```

### `startSidecar` Options

| Parameter | Type | Default | Env Var Fallback | Description |
|-----------|------|---------|------------------|-------------|
| `port` | `number` | `9100` | `SIDECAR_PORT` | TCP port to listen on |
| `host` | `string` | `"127.0.0.1"` (or `"0.0.0.0"` if `DEV_MODE=true`) | `DEV_MODE` | Network interface to bind to |
| `watchdogUrl` | `string` | `undefined` | `SIDECAR_WATCHDOG_URL` | Health endpoint URL for the companion backend watchdog |
| `watchdogOptions` | `WatchdogOptions` | See below | — | Fine-tune watchdog polling behavior |

### `WatchdogOptions`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `intervalMs` | `number` | `30000` (30s) | Polling interval between health checks. Minimum: `1000`. |
| `timeoutMs` | `number` | `10000` (10s) | Timeout for each individual health check request. Minimum: `1000`. |
| `maxFailures` | `number` | `6` | Consecutive failures before triggering shutdown (~3 minutes at default interval). Minimum: `1`. |
| `startDelayMs` | `number` | `60000` (60s) | Grace period before the first health check. Allows the companion backend time to start. Minimum: `0`. |

```typescript
const handle = startSidecar({
  watchdogUrl: "http://localhost:8000/health",
  watchdogOptions: {
    intervalMs: 10_000,   // check every 10 seconds
    maxFailures: 10,      // tolerate 10 failures (~100 seconds)
    startDelayMs: 120_000 // wait 2 minutes before first check
  },
});
```

### `SidecarHandle`

`startSidecar()` returns a `SidecarHandle` object:

| Method | Signature | Description |
|--------|-----------|-------------|
| `close` | `() => Promise<void>` | Gracefully shuts down the server: stops the watchdog, clears the stale-session cleanup interval, disposes all sessions, and closes the HTTP listener. |

```typescript
// Graceful shutdown
process.on("SIGINT", async () => {
  await handle.close();
  process.exit(0);
});
```

---

## Internal Defaults (Non-configurable)

These values are hardcoded in the source and not configurable via environment variables or options. They are documented here for operational awareness.

| Constant | Value | Location | Description |
|----------|-------|----------|-------------|
| Max request body size | 1 MB (`1_048_576` bytes) | `src/index.ts` | Requests exceeding this limit receive HTTP 413 |
| Stale session max age | 1 hour (`3_600_000` ms) | `src/index.ts` | Idle sessions older than this are cleaned up |
| Stale session cleanup interval | 10 minutes | `src/index.ts` | How often the cleanup sweep runs |
| ACPX discovery timeout | 30 seconds per agent | `src/sessions.ts` | Timeout for each ACPX agent model discovery call |
| HTTP tool request timeout | 30 seconds | `src/http-tool-executor.ts` | Default timeout for HTTP-backed custom tool requests (overridable per-tool via `timeoutMs` in `HttpToolConfig`) |
| HTTP tool max response size | 1 MB (`1_048_576` bytes) | `src/http-tool-executor.ts` | Responses exceeding this limit are truncated |
| Default `agentDir` | `/tmp/pi-sidecar-agent` | `src/sessions.ts` | Used when `agent_dir` is not provided in `POST /sessions` |
| Default tools | `read`, `grep`, `find`, `ls`, `bash` | `src/sessions.ts` | Builtin tool set when `tools` is not specified at session creation |
| Python client HTTP timeout | 600 seconds | `pi_sidecar_client/__init__.py` | Default `httpx` timeout for all Python client requests |
| Excluded providers | `github-copilot` | `src/sessions.ts` | Providers requiring browser OAuth are excluded from model listing |

> **Tip:** The HTTP tool request timeout *is* configurable per-tool via the `timeoutMs` field in `HttpToolConfig`. See [HTTP Tool Executor Reference](http-tool-executor-reference.html) for details.

---

## Quick Reference Table

All environment variables in one place:

| Variable | Component | Default | Purpose |
|----------|-----------|---------|---------|
| `SIDECAR_PORT` | Server | `9100` | HTTP listen port |
| `SIDECAR_HOST` | Server | unset (`DEV_MODE? 0.0.0.0 : 127.0.0.1`) | Bind override; precedence `options.host` → `SIDECAR_HOST` → `DEV_MODE` → localhost; non-loopback rejects `agent_dir` with HTTP 400 (unless `DEV_MODE`) |
| `DEV_MODE` | Server | unset | When `SIDECAR_HOST` unset: bind `0.0.0.0`; type-check then discard `agent_dir` |
| `PI_SIDECAR_LOG_LEVEL` | Server + Client | `info` | Log verbosity (`debug` / `info` / `warn` / `error`) |
| `ACPX_AGENTS` | Server | `""` | Comma-separated ACPX agents for model discovery |
| `SIDECAR_WATCHDOG_URL` | Server | unset | Companion backend health URL (enables watchdog) |
| `SIDECAR_ACPX_EXTENSION_PATH` | Server | auto-resolved | Override ACPX extension file path |
| `SIDECAR_VERTEX_EXTENSION_PATH` | Server | auto-resolved | Override Vertex Claude extension file path |
| `SIDECAR_URL` | Python Client | `http://127.0.0.1:9100` | Sidecar base URL for the Python client |

---

## Example: Full Production Startup

```bash
export SIDECAR_PORT=9100
export PI_SIDECAR_LOG_LEVEL=info
export ACPX_AGENTS=cursor
export SIDECAR_WATCHDOG_URL=http://localhost:8000/health

node dist/server.js
```

## Example: Development Startup

```bash
export DEV_MODE=true
export PI_SIDECAR_LOG_LEVEL=debug
export SIDECAR_PORT=9200

npx tsx src/server.ts
```

## Example: Python Client with Custom URL

```bash
export SIDECAR_URL=http://127.0.0.1:9200
export PI_SIDECAR_LOG_LEVEL=DEBUG
```

```python
from pi_sidecar_client import call_ai_once
import asyncio

result = asyncio.run(call_ai_once(
    "Hello!",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
))
print(result.text)
```

## Related Pages

- [Getting Started with pi-sidecar](quickstart.html)
- [Embedding the Sidecar in a Node.js Application](embedding-in-node.html)
- [Monitoring a Companion Backend with the Watchdog](configuring-watchdog.html)
- [REST API Reference](rest-api-reference.html)
- [HTTP Tool Executor Reference](http-tool-executor-reference.html)
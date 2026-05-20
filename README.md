# pi-sidecar

A standalone HTTP service that wraps the [Pi coding agent SDK](https://www.npmjs.com/package/@earendil-works/pi-coding-agent), exposing AI sessions over a simple JSON API. Ships with a Python client for easy integration.

## Packages

| Package | Language | Install |
|---------|----------|---------|
| `@myk-org/pi-sidecar` | TypeScript | `npm install @myk-org/pi-sidecar` |
| `pi-sidecar-client` | Python ≥ 3.10 | `pip install pi-sidecar-client` |

## Provider Support

| Provider | Sidecar name | Required env vars / config |
|----------|-------------|---------------------------|
| Gemini | `google` | `GOOGLE_API_KEY` or Application Default Credentials |
| Claude (Vertex AI) | `google-vertex-claude` | `GOOGLE_APPLICATION_CREDENTIALS`, Vertex extension (`SIDECAR_VERTEX_EXTENSION_PATH`) |
| Claude (API key) | `anthropic` | `ANTHROPIC_API_KEY` |
| Cursor (via acpx) | `acpx-cursor` | `ACPX_AGENTS=cursor`, acpx CLI on `$PATH`, ACPX extension (`SIDECAR_ACPX_EXTENSION_PATH`) |

> **Note:** The Python client accepts friendly provider names (`gemini`, `claude`, `cursor`) and maps them internally to sidecar provider names (`google`, `google-vertex-claude`, `acpx-cursor`).

## HTTP API

All endpoints accept/return JSON. Default base URL: `http://127.0.0.1:9100`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns `{"status":"ok","sessions":N}`. 503 while model discovery is in progress. |
| `GET` | `/models` | List all discovered models. |
| `POST` | `/models/refresh` | Re-run model discovery and return updated list. |
| `POST` | `/sessions` | Create a session. Body: `{provider, model, system_prompt, cwd?, custom_tools?}` → `{session_id}` |
| `POST` | `/sessions/:id/prompt` | Send a message. Body: `{message}` → `{text, usage, error?}` |
| `POST` | `/sessions/:id/abort` | Abort an in-progress prompt. |
| `DELETE` | `/sessions/:id` | Delete a session and free resources. |

> **`POST /sessions/:id/prompt` — error field:**
>
> The response includes an optional `error` string field, present when the AI returned errors during processing. When `error` is set, `text` may still contain partial output. Python client callers: when `error` is present, `AIResult.success` will be `False`.

## TypeScript Usage

### Programmatic

```ts
import { startSidecar } from "@myk-org/pi-sidecar";

startSidecar({ port: 9100, host: "127.0.0.1" });
```

### Standalone

```bash
npm run build
node dist/server.js          # listens on 127.0.0.1:9100
SIDECAR_PORT=9200 node dist/server.js   # custom port
DEV_MODE=true node dist/server.js       # bind 0.0.0.0
```

## Python Client Usage

### Single-shot call (auto-cleanup)

```python
from pi_sidecar_client import call_ai_once

result = await call_ai_once(
    "Summarize this log file",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="You are a log analyst.",
)
print(result.text)
```

### Multi-turn conversation (session reuse)

```python
from pi_sidecar_client import call_ai, get_sidecar_client

r1 = await call_ai("Analyze this failure", ai_provider="claude", ai_model="claude-sonnet-4-20250514")
r2 = await call_ai("Now suggest a fix", session_id=r1.session_id)

# Clean up when done
await get_sidecar_client().delete_session(r2.session_id)
```

### Direct client usage

```python
from pi_sidecar_client import SidecarClient

client = SidecarClient("http://127.0.0.1:9100")
try:
    sid = await client.create_session(
        provider="google",
        model="gemini-2.5-flash",
        system_prompt="You are helpful.",
    )
    result = await client.prompt(sid, "Hello!")
    print(result.text)
    await client.delete_session(sid)
finally:
    await client.close()
```

### List models

```python
from pi_sidecar_client import list_models

all_models = await list_models()
gemini_only = await list_models(provider="gemini")
```

## Testing

**TypeScript sidecar:**

```bash
npm install
npm test
```

**Python client:**

```bash
pip install -e '.[tests]'
pytest
```

## Examples

See the [`examples/`](examples/) directory for usage patterns:

| File | Description |
|------|-------------|
| `basic_prompt.py` | Single-shot AI call with `call_ai_once()` |
| `multi_turn.py` | Multi-turn conversation with session reuse |
| `list_models.py` | Discover available models by provider |
| `health_check.py` | Verify sidecar is running and ready |
| `parallel_tasks.py` | Run multiple AI calls with concurrency limiting |
| `usage_tracking.py` | Track token usage with a pluggable callback |
| `start-sidecar.ts` | Start the sidecar programmatically (TypeScript) |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SIDECAR_PORT` | `9100` | HTTP listen port |
| `SIDECAR_URL` | `http://127.0.0.1:9100` | Base URL used by the Python client |
| `DEV_MODE` | `false` | Set `true` to bind `0.0.0.0` instead of `127.0.0.1` |
| `ACPX_AGENTS` | *(empty)* | Comma-separated list of acpx agents to discover models from (e.g. `cursor`) |
| `SIDECAR_ACPX_EXTENSION_PATH` | auto-resolved via `require.resolve` from `pi-orchestrator-config` | Path to the acpx provider extension |
| `SIDECAR_VERTEX_EXTENSION_PATH` | auto-resolved via `require.resolve` from `node_modules` | Path to the Vertex Claude extension |
| `SIDECAR_WATCHDOG_URL` | *(disabled)* | Health endpoint URL for watchdog monitoring. When set, the sidecar monitors this URL and shuts down if it becomes unresponsive. Disabled by default for standalone usage. |

## Architecture Notes

- **Watchdog**: opt-in health-check poller activated via `SIDECAR_WATCHDOG_URL`. When enabled, waits 60 s then monitors the given URL every 30 s; shuts down after 6 consecutive failures (~3 min). Timings are configurable via `watchdogOptions`. Disabled by default for standalone usage.
- **Stale session cleanup**: sessions idle for >1 hour are automatically disposed (checked every 10 minutes).
- **Model discovery**: runs at startup; `/health` returns 503 until complete.

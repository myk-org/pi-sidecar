# Python Client API Reference

Full API reference for the `pi-sidecar-client` Python package (`pi_sidecar_client`).

**Install:**

```bash
pip install pi-sidecar-client
```

**Requirements:** Python ≥ 3.10, `httpx ≥ 0.27`

**Import:**

```python
from pi_sidecar_client import (
    AIResult,
    AITokenUsage,
    SidecarClient,
    call_ai,
    call_ai_once,
    check_sidecar_available,
    get_sidecar_client,
    list_models,
    run_parallel_with_limit,
    set_usage_recorder,
)
```

> **Note:** All functions and methods that perform I/O are `async`. You must `await` them from within an async context or use `asyncio.run()`.

---

## Module-Level Constants

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `SIDECAR_URL` | `str` | `"http://127.0.0.1:9100"` | Base URL for the sidecar, read from the `SIDECAR_URL` environment variable at import time. |
| `DEFAULT_CWD` | `str` | `tempfile.gettempdir()` | Default working directory passed to session creation when `cwd` is not specified. |

---

## Provider Name Mapping

The client automatically maps friendly provider names to sidecar-internal provider identifiers. This mapping applies to all functions and methods that accept a `provider` or `ai_provider` parameter.

| Friendly Name | Sidecar Provider | Model Prefix Added |
|---------------|------------------|--------------------|
| `"cursor"` | `"acpx-cursor"` | `cursor:` prepended if missing |
| `"claude"` | `"google-vertex-claude"` | None |
| `"gemini"` | `"google"` | None |

Any provider name not in this table is passed through unchanged.

```python
# These are equivalent:
await call_ai_once("hi", ai_provider="gemini", ai_model="gemini-2.5-flash")
await call_ai_once("hi", ai_provider="google", ai_model="gemini-2.5-flash")

# Cursor models get the cursor: prefix automatically:
# ai_provider="cursor", ai_model="gpt-4o" → provider="acpx-cursor", model="cursor:gpt-4o"
```

See [Discovering and Selecting Models](discovering-models.html) for details on model selection.

---

## Data Classes

### `AIResult`

Result from an AI call.

```python
@dataclass
class AIResult:
    success: bool
    text: str
    usage: AITokenUsage | None = None
    session_id: str | None = None
    error: str | None = None
```

**Fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `success` | `bool` | *(required)* | `True` if the prompt completed without errors. `False` if the sidecar returned an HTTP error or the AI response contained an `error` field. |
| `text` | `str` | *(required)* | The AI response text. May be empty for tool-only responses. On failure, contains the error message. |
| `usage` | `AITokenUsage \| None` | `None` | Token usage data. Present on successful prompts and on some error responses (HTTP 200 with error field). |
| `session_id` | `str \| None` | `None` | The session ID used for this call. Set by `call_ai` and `call_ai_once`. `None` after successful cleanup by `call_ai_once`. |
| `error` | `str \| None` | `None` | Error description when `success` is `False`. `None` on success. |

#### `AIResult.record_usage()`

Record token usage via a previously registered callback. Best-effort — never raises.

```python
async def record_usage(
    self,
    *,
    request_id: str,
    call_type: str,
    prompt_chars: int = 0,
    ai_provider: str = "",
    ai_model: str = "",
) -> None
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `request_id` | `str` | *(required)* | Caller-defined identifier for this request. |
| `call_type` | `str` | *(required)* | Label for the type of call (e.g., `"analysis"`, `"question"`). |
| `prompt_chars` | `int` | `0` | Number of characters in the prompt. |
| `ai_provider` | `str` | `""` | Provider name for the record. |
| `ai_model` | `str` | `""` | Model name for the record. |

```python
result = await call_ai_once("What is Pi?", ai_provider="gemini", ai_model="gemini-2.5-flash")
await result.record_usage(
    request_id="req-001",
    call_type="question",
    prompt_chars=len("What is Pi?"),
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
)
```

> **Note:** If no callback has been registered via `set_usage_recorder()`, this method is a no-op. If the callback raises an exception, it is silently swallowed and logged at `debug` level.

See [Tracking Token Usage and Costs](tracking-usage.html) for usage patterns.

---

### `AITokenUsage`

Token usage data from an AI call.

```python
@dataclass
class AITokenUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float | None = None
    duration_ms: int | None = None
    provider: str = ""
    model: str = ""
    session_id: str = ""
```

**Fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `input_tokens` | `int` | `0` | Number of input tokens consumed. |
| `output_tokens` | `int` | `0` | Number of output tokens generated. |
| `cache_read_tokens` | `int` | `0` | Tokens read from cache. |
| `cache_write_tokens` | `int` | `0` | Tokens written to cache. |
| `cost_usd` | `float \| None` | `None` | Estimated cost in USD, if available. |
| `duration_ms` | `int \| None` | `None` | Duration of the AI call in milliseconds, if available. |
| `provider` | `str` | `""` | Provider identifier. |
| `model` | `str` | `""` | Model identifier. |
| `session_id` | `str` | `""` | Session identifier. |

```python
if result.usage:
    print(f"Tokens: {result.usage.input_tokens} in, {result.usage.output_tokens} out")
    print(f"Cost: ${result.usage.cost_usd:.4f}")
    print(f"Duration: {result.usage.duration_ms}ms")
```

---

## `SidecarClient`

Low-level async HTTP client for the Pi SDK sidecar service. For most use cases, prefer the [convenience functions](#convenience-functions) instead.

### Constructor

```python
SidecarClient(base_url: str = SIDECAR_URL)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `base_url` | `str` | `SIDECAR_URL` (`"http://127.0.0.1:9100"`) | Base URL of the sidecar HTTP server. Trailing slashes are stripped. |

The underlying `httpx.AsyncClient` is created with a **600-second** (10-minute) default timeout.

```python
client = SidecarClient()
# or with a custom URL:
client = SidecarClient(base_url="http://localhost:9200")
```

---

### `SidecarClient.health()`

Check sidecar health.

```python
async def health(self) -> dict
```

**Returns:** A dict with the health response payload (e.g., `{"status": "ok", "sessions": 0}`).

**Raises:** `httpx.HTTPStatusError` if the sidecar returns a non-2xx status.

```python
data = await client.health()
if data["status"] == "ok":
    print("Sidecar is ready")
```

---

### `SidecarClient.get_models()`

Get available models.

```python
async def get_models(self) -> list[dict]
```

**Returns:** A list of model dicts from the `models` field of the response. Each dict contains `id`, `name`, `provider`, and other model metadata.

**Raises:** `httpx.HTTPStatusError` on non-2xx response.

```python
models = await client.get_models()
for m in models:
    print(f"{m['provider']}/{m['id']}")
```

---

### `SidecarClient.refresh_models()`

Trigger model discovery and return the updated list.

```python
async def refresh_models(self) -> list[dict]
```

**Returns:** A list of model dicts after re-discovery.

**Raises:** `httpx.HTTPStatusError` on non-2xx response.

```python
models = await client.refresh_models()
print(f"Refreshed: {len(models)} models available")
```

---

### `SidecarClient.create_session()`

Create a new AI session.

```python
async def create_session(
    self,
    *,
    provider: str,
    model: str,
    system_prompt: str,
    cwd: str = DEFAULT_CWD,
    agent_dir: str | None = None,
    custom_tools: list | None = None,
    tools: list[str] | None = None,
) -> str
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `provider` | `str` | *(required)* | AI provider name. Friendly names (`"gemini"`, `"cursor"`, `"claude"`) are automatically mapped. |
| `model` | `str` | *(required)* | Model identifier (e.g., `"gemini-2.5-flash"`, `"gpt-4o"`). |
| `system_prompt` | `str` | *(required)* | System prompt for the AI session. |
| `cwd` | `str` | `DEFAULT_CWD` | Working directory. Also controls Pi SDK resource loading from `{cwd}/.pi/` and `{cwd}/AGENTS.md`. |
| `agent_dir` | `str \| None` | `None` | Absolute path to the global agent directory for user-level resources. Omitted from the request body when `None`. |
| `custom_tools` | `list \| None` | `None` | List of custom tool configuration dicts. Omitted from the request body when `None`. |
| `tools` | `list[str] \| None` | `None` | Override the default built-in tool set. Omitted from the request body when `None` (server uses defaults: `read`, `grep`, `find`, `ls`, `bash`). |

**Returns:** The `session_id` string.

**Raises:** `httpx.HTTPStatusError` on non-2xx response.

```python
session_id = await client.create_session(
    provider="gemini",
    model="gemini-2.5-pro",
    system_prompt="You are a code reviewer.",
    cwd="/home/user/project",
    tools=["read", "grep", "bash"],
)
```

See [Configuring Built-in and Custom Tools](configuring-tools.html) for tool configuration details.

---

### `SidecarClient.prompt()`

Send a message to a session.

```python
async def prompt(
    self,
    session_id: str,
    message: str,
    timeout: float | None = None,
) -> AIResult
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `session_id` | `str` | *(required)* | Session to send the prompt to. |
| `message` | `str` | *(required)* | The prompt message text. |
| `timeout` | `float \| None` | `None` | Request timeout in seconds. `None` uses the client's default (600s). |

**Returns:** An `AIResult`. On HTTP error or an `error` field in the response, `success` is `False`.

```python
result = await client.prompt("sess-123", "Explain this function.")
if result.success:
    print(result.text)
```

> **Note:** The sidecar may return HTTP 200 with an `error` field in the JSON body. The client detects this and sets `success=False` with the error message preserved in `result.error`.

---

### `SidecarClient.abort()`

Abort an in-progress prompt.

```python
async def abort(self, session_id: str) -> None
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `session_id` | `str` | *(required)* | Session whose prompt to abort. |

**Raises:** `httpx.HTTPStatusError` on non-2xx response.

```python
await client.abort("sess-123")
```

---

### `SidecarClient.delete_session()`

Delete a session and free its resources.

```python
async def delete_session(self, session_id: str) -> None
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `session_id` | `str` | *(required)* | Session to delete. |

**Raises:** `httpx.HTTPStatusError` on non-2xx response.

```python
await client.delete_session("sess-123")
```

---

### `SidecarClient.close()`

Close the underlying HTTP client. After calling this, the client instance cannot be reused.

```python
async def close(self) -> None
```

```python
await client.close()
```

---

## Convenience Functions

High-level functions that use a [singleton client](#get_sidecar_client) internally. These cover the most common workflows without requiring manual `SidecarClient` management.

### `call_ai()`

Send a prompt to an AI model. Creates a new session or reuses an existing one.

```python
async def call_ai(
    prompt: str,
    *,
    ai_provider: str = "",
    ai_model: str = "",
    cwd: str | None = None,
    agent_dir: str | None = None,
    system_prompt: str = "",
    ai_call_timeout: int | None = None,
    session_id: str | None = None,
    custom_tools: list | None = None,
    tools: list[str] | None = None,
) -> AIResult
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | `str` | *(required)* | The message to send to the AI. |
| `ai_provider` | `str` | `""` | AI provider name (friendly or sidecar-internal). |
| `ai_model` | `str` | `""` | Model identifier. |
| `cwd` | `str \| None` | `None` | Working directory. Falls back to `DEFAULT_CWD` when `None`. |
| `agent_dir` | `str \| None` | `None` | Global agent directory path. |
| `system_prompt` | `str` | `""` | System prompt. Defaults to `"You are a helpful assistant."` when empty and a new session is created. |
| `ai_call_timeout` | `int \| None` | `None` | Timeout in **minutes**. Converted to seconds internally. `None` uses the client default (600s). |
| `session_id` | `str \| None` | `None` | Reuse an existing session. When `None`, a new session is created. |
| `custom_tools` | `list \| None` | `None` | Custom tool configurations for session creation. |
| `tools` | `list[str] \| None` | `None` | Override built-in tool set for session creation. |

> **Warning:** The `ai_call_timeout` parameter is specified in **minutes**, not seconds. A value of `5` sets a 300-second timeout.

**Returns:** An `AIResult` with `session_id` populated.

**Session lifecycle:**
- When `session_id` is `None`, a new session is created. The caller is responsible for deleting it when done.
- When a new session is created and the prompt raises an exception, the session is automatically deleted.
- For single-shot use, prefer `call_ai_once()` which handles cleanup automatically.

```python
# Multi-turn conversation
result1 = await call_ai(
    "What is Python?",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="Be concise.",
)

# Continue the conversation using the same session
result2 = await call_ai(
    "Show me an example.",
    session_id=result1.session_id,
)

# Clean up when done
await get_sidecar_client().delete_session(result2.session_id)
```

See [Managing Session Lifecycle](managing-sessions.html) for session management patterns.

---

### `call_ai_once()`

Single-shot AI call with automatic session cleanup. Creates a session, sends the prompt, and deletes the session.

```python
async def call_ai_once(
    prompt: str,
    *,
    ai_provider: str = "",
    ai_model: str = "",
    cwd: str | None = None,
    agent_dir: str | None = None,
    system_prompt: str = "",
    ai_call_timeout: int | None = None,
    custom_tools: list | None = None,
    tools: list[str] | None = None,
) -> AIResult
```

**Parameters:** Same as `call_ai()` except `session_id` is not accepted (a new session is always created).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | `str` | *(required)* | The message to send to the AI. |
| `ai_provider` | `str` | `""` | AI provider name. |
| `ai_model` | `str` | `""` | Model identifier. |
| `cwd` | `str \| None` | `None` | Working directory. Falls back to `DEFAULT_CWD` when `None`. |
| `agent_dir` | `str \| None` | `None` | Global agent directory path. |
| `system_prompt` | `str` | `""` | System prompt. Defaults to `"You are a helpful assistant."` when empty. |
| `ai_call_timeout` | `int \| None` | `None` | Timeout in **minutes**. |
| `custom_tools` | `list \| None` | `None` | Custom tool configurations. |
| `tools` | `list[str] \| None` | `None` | Override built-in tool set. |

**Returns:** An `AIResult`. On successful cleanup, `session_id` is set to `None`. If session deletion fails, `session_id` is preserved so the caller can retry cleanup.

```python
result = await call_ai_once(
    "What are the three laws of robotics?",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="You are a helpful assistant. Be concise.",
)

if result.success:
    print(result.text)
    print(f"Tokens: in={result.usage.input_tokens} out={result.usage.output_tokens}")
else:
    print(f"Error: {result.error}")
```

See [Sending Prompts to AI Models](sending-prompts.html) for more prompt patterns.

---

### `list_models()`

List available models, optionally filtered by provider.

```python
async def list_models(provider: str = "") -> list[dict]
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `provider` | `str` | `""` | Filter by provider name (friendly or sidecar-internal). Empty string returns all models. |

**Returns:** A list of model dicts. Each dict contains at minimum `id`, `name`, and `provider` fields.

```python
# All models
all_models = await list_models()

# Only Gemini models ("gemini" maps to "google")
gemini_models = await list_models(provider="gemini")

# Only Cursor models ("cursor" maps to "acpx-cursor")
cursor_models = await list_models(provider="cursor")
```

See [Discovering and Selecting Models](discovering-models.html) for model discovery details.

---

### `check_sidecar_available()`

Check if the sidecar service is available and ready.

```python
async def check_sidecar_available() -> tuple[bool, str]
```

**Returns:** A `(available, message)` tuple.

| Sidecar State | `available` | `message` example |
|---------------|-------------|-------------------|
| Ready | `True` | `"Sidecar is ready"` |
| Starting (HTTP 503 or `status: "starting"`) | `False` | `"Sidecar starting: model discovery in progress"` |
| Unhealthy (non-ok status) | `False` | `"Sidecar unhealthy: {'status': 'error'}"` |
| Unreachable (connection error) | `False` | `"Sidecar unavailable: [ConnectError] refused"` |

```python
available, message = await check_sidecar_available()
if available:
    print(f"✅ {message}")
else:
    print(f"❌ {message}")
```

---

### `get_sidecar_client()`

Get or create the module-level singleton `SidecarClient`.

```python
def get_sidecar_client() -> SidecarClient
```

**Returns:** A `SidecarClient` instance. Creates a new one (using `SIDECAR_URL`) if the singleton has not been initialized or was previously closed.

> **Note:** This is a synchronous function — it does not need to be awaited.

```python
client = get_sidecar_client()
await client.health()
```

---

### `run_parallel_with_limit()`

Run async tasks in parallel with a concurrency limit.

```python
async def run_parallel_with_limit(
    tasks: list,
    max_concurrency: int = 5,
) -> list
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tasks` | `list` | *(required)* | List of awaitable coroutines to execute. |
| `max_concurrency` | `int` | `5` | Maximum number of tasks running simultaneously. Must be ≥ 1. |

**Returns:** A list of results in the same order as the input tasks. Failed tasks return their exception object instead of raising.

**Raises:** `ValueError` if `max_concurrency < 1`.

```python
async def analyze(item: str) -> str:
    result = await call_ai_once(
        f"In one sentence, what is {item}?",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
    )
    return f"{item}: {result.text}" if result.success else f"{item}: ERROR"

results = await run_parallel_with_limit(
    [analyze(item) for item in ["Python", "Rust", "Go"]],
    max_concurrency=2,
)

for r in results:
    if isinstance(r, Exception):
        print(f"Failed: {r}")
    else:
        print(r)
```

See [Running Parallel AI Calls](running-parallel-tasks.html) for concurrency patterns.

---

### `set_usage_recorder()`

Register a global callback for recording AI token usage.

```python
def set_usage_recorder(callback: Callable) -> None
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `callback` | `Callable` | *(required)* | Sync or async function to call when `AIResult.record_usage()` is invoked. |

> **Note:** This is a synchronous function — it does not need to be awaited.

The callback receives the following keyword arguments:

| Argument | Type | Description |
|----------|------|-------------|
| `request_id` | `str` | Caller-defined request identifier. |
| `result` | `AIResult` | The full AI result (including `usage`). |
| `call_type` | `str` | Label for the call type. |
| `prompt_chars` | `int` | Character count of the prompt. |
| `ai_provider` | `str` | Provider name. |
| `ai_model` | `str` | Model name. |

The callback may be synchronous or asynchronous — both are supported:

```python
# Async callback
async def my_recorder(*, request_id, result, call_type, prompt_chars, ai_provider, ai_model):
    await db.insert({"request_id": request_id, "tokens": result.usage.input_tokens})

# Sync callback
def my_sync_recorder(*, request_id, result, call_type, prompt_chars, ai_provider, ai_model):
    log.append({"request_id": request_id, "cost": result.usage.cost_usd})

set_usage_recorder(my_recorder)
```

> **Tip:** Call `set_usage_recorder()` once at application startup. Usage is not recorded automatically — you must call `result.record_usage()` after each AI call.

See [Tracking Token Usage and Costs](tracking-usage.html) for complete examples.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SIDECAR_URL` | `"http://127.0.0.1:9100"` | Base URL for the sidecar server. Read at module import time into the `SIDECAR_URL` constant. |
| `PI_SIDECAR_LOG_LEVEL` | `"INFO"` | Log level for the client logger. Accepts `DEBUG`, `INFO`, `WARNING`, `ERROR`. |

See [Configuration and Environment Variables](configuration-reference.html) for all sidecar configuration options.

---

## Error Handling

All `SidecarClient` methods except `prompt()` raise `httpx.HTTPStatusError` on non-2xx responses. The `prompt()` method catches HTTP errors and returns them as `AIResult(success=False, ...)`.

The convenience functions (`call_ai`, `call_ai_once`) catch all exceptions and return `AIResult(success=False, text=str(error), error=str(error))`. They never raise.

```python
# Convenience functions — always returns AIResult, never raises
result = await call_ai_once("hello", ai_provider="gemini", ai_model="gemini-2.5-flash")
if not result.success:
    print(f"Error: {result.error}")

# SidecarClient methods — may raise
client = SidecarClient()
try:
    models = await client.get_models()
except httpx.HTTPStatusError as e:
    print(f"HTTP {e.response.status_code}: {e.response.text}")
except httpx.ConnectError:
    print("Could not connect to sidecar")
```

See [REST API Reference](rest-api-reference.html) for the HTTP status codes and error formats returned by the sidecar server.

## Related Pages

- [REST API Reference](rest-api-reference.html)
- [Sending Prompts to AI Models](sending-prompts.html)
- [Managing Session Lifecycle](managing-sessions.html)
- [Discovering and Selecting Models](discovering-models.html)
- [Tracking Token Usage and Costs](tracking-usage.html)
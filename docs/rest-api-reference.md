Let me start by reading the knowledge graph and the pages manifest, then explore the source code systematically.

Now let me read the core source files:

Now let me look at the tests and examples for additional detail:

Now let me look at a few more tests and the HTTP tool executor:

Now let me check the watchdog and route-match tests:

Now I have a thorough understanding of all endpoints, validation rules, request/response schemas, status codes, and error formats. Let me write the complete reference page.

# REST API Reference

All pi-sidecar endpoints accept and return JSON over HTTP. The server binds to `127.0.0.1:9100` by default. See [Configuration and Environment Variables](configuration-reference.html) for customization.

> **Note:** There is no authentication on the sidecar API. Security relies on the localhost network boundary. See [Embedding the Sidecar in a Node.js Application](embedding-in-node.html) for trust model details.

---

## Common Conventions

| Convention | Detail |
|---|---|
| Content type | All request and response bodies are `application/json` |
| Max request body | 1 MB (1,048,576 bytes). Exceeding this returns `413` |
| Invalid JSON | Returns `400` with `{"error": "Invalid JSON body"}` |
| Unknown routes | Returns `404` with `{"error": "Not found"}` |
| Session IDs | UUIDv4 strings |
| Stale session cleanup | Sessions idle for more than 1 hour are automatically disposed (checked every 10 minutes) |

### Error Response Format

All error responses use the same shape:

```json
{
  "error": "Human-readable error message"
}
```

---

## Health

### `GET /health`

Check whether the sidecar is ready to accept requests.

**Parameters:** None

**Response**

| Status | `status` field | Meaning |
|--------|---------------|---------|
| `200` | `"ok"` | Server is ready; model discovery succeeded |
| `200` | `"degraded"` | Server is ready; model discovery failed |
| `503` | `"starting"` | Model discovery is still in progress |

**Response fields**

| Field | Type | Present when | Description |
|-------|------|-------------|-------------|
| `status` | `string` | Always | One of `"ok"`, `"degraded"`, `"starting"` |
| `message` | `string` | `starting` or `degraded` | Human-readable status message |
| `sessions` | `number` | `ok` or `degraded` | Number of active sessions |

**Examples**

```bash
# Ready
curl http://127.0.0.1:9100/health
```
```json
{ "status": "ok", "sessions": 2 }
```

```bash
# Still starting
curl http://127.0.0.1:9100/health
```
```json
{ "status": "starting", "message": "Model discovery in progress" }
```

```bash
# Degraded
curl http://127.0.0.1:9100/health
```
```json
{ "status": "degraded", "message": "Model discovery failed", "sessions": 0 }
```

---

## Models

### `GET /models`

List all available AI models. Returns builtin models and any ACPX-discovered models, with duplicates removed (ACPX models take priority).

**Parameters:** None

**Response**

| Status | Description |
|--------|-------------|
| `200` | Model list returned |

**Response fields**

| Field | Type | Description |
|-------|------|-------------|
| `models` | `array` | Array of model objects |
| `models[].id` | `string` | Model identifier (e.g. `"gemini-2.5-flash"`, `"cursor:default[context=272k]"`) |
| `models[].name` | `string` | Human-readable display name |
| `models[].provider` | `string` | Provider identifier (e.g. `"google"`, `"acpx-cursor"`, `"google-vertex-claude"`) |

> **Note:** Models from providers requiring browser OAuth (e.g. `github-copilot`) are excluded.

**Example**

```bash
curl http://127.0.0.1:9100/models
```
```json
{
  "models": [
    { "id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "provider": "google" },
    { "id": "cursor:default[context=272k,reasoning=medium]", "name": "Default (cursor)", "provider": "acpx-cursor" }
  ]
}
```

---

### `POST /models/refresh`

Trigger model discovery from all configured providers. Blocks until discovery completes.

This creates a temporary bootstrap session internally, queries ACPX agents listed in the `ACPX_AGENTS` environment variable, and updates the model list. See [Discovering and Selecting Models](discovering-models.html) for details on how discovery works.

**Request body:** None (empty or `{}`)

**Response**

| Status | Description |
|--------|-------------|
| `200` | Discovery succeeded; updated model list returned |
| `500` | Discovery failed |

**Response fields (200)**

| Field | Type | Description |
|-------|------|-------------|
| `models` | `array` | Updated array of model objects (same shape as `GET /models`) |

**Example**

```bash
curl -X POST http://127.0.0.1:9100/models/refresh
```
```json
{
  "models": [
    { "id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "provider": "google" }
  ]
}
```

---

## Sessions

### `POST /sessions`

Create a new AI session. Returns a session ID for subsequent prompts.

**Request body**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `provider` | `string` | **Yes** | — | AI provider identifier (e.g. `"google"`, `"acpx-cursor"`, `"google-vertex-claude"`) |
| `model` | `string` | **Yes** | — | Model identifier from `GET /models` (e.g. `"gemini-2.5-flash"`) |
| `system_prompt` | `string` | **Yes** | — | System prompt for the session |
| `cwd` | `string` | No | Server's `process.cwd()` | Working directory. Also controls Pi SDK resource loading from `{cwd}/.pi/` and `{cwd}/AGENTS.md` |
| `agent_dir` | `string` | No | `"/tmp/pi-sidecar-agent"` | Absolute path to the global agent directory for user-level resources. Must be an existing directory |
| `tools` | `string[]` | No | `["read", "grep", "find", "ls", "bash"]` | Override the builtin tool set. Each entry must be a string |
| `custom_tools` | `object[]` | No | `[]` | Additional custom tool definitions. See [Configuring Built-in and Custom Tools](configuring-tools.html) |

> **Tip:** Use the Python client's provider mapping for convenience: `"gemini"` → `"google"`, `"cursor"` → `"acpx-cursor"`, `"claude"` → `"google-vertex-claude"`. See [Python Client API Reference](python-client-reference.html).

**Validation rules**

| Field | Rule | Error message |
|-------|------|---------------|
| `provider` | Must be a non-empty string | `"provider and system_prompt are required and must be non-empty strings"` |
| `system_prompt` | Must be a non-empty string | `"provider and system_prompt are required and must be non-empty strings"` |
| `model` | Must be a non-empty string | `"model is required and must be a non-empty string. Use GET /models to list available models."` |
| `cwd` | If present, must be a string | `"cwd must be a string"` |
| `agent_dir` | If present, must be a non-empty string | `"agent_dir must be a non-empty string"` |
| `agent_dir` | Must be an absolute path (loopback, non-`DEV_MODE`) | `"agent_dir must be an absolute path"` |
| `agent_dir` | Must point to an existing directory (loopback, non-`DEV_MODE`) | `"agent_dir does not exist"` / `"agent_dir must be a directory"` / `"agent_dir permission denied"` |
| `agent_dir` | Not allowed on non-loopback binds when `DEV_MODE` is unset | `"agent_dir is not allowed when the sidecar is bound to a non-loopback address"` |
| `tools` | If present, must be an array of strings | `"tools must be an array of strings"` |
| `custom_tools` | If present, must be an array | `"custom_tools must be an array"` |
| `custom_tools[*]` | Each entry must be a plain object (not array, not null) with a non-empty string `name` | `"custom_tools entries must be plain objects with a string 'name' property"` |
| — (model lookup) | Model must exist in registry, builtins, or ACPX models | `"Model '<model>' not found for provider '<provider>'. Use GET /models to list available models."` |

> **Warning:** When `DEV_MODE=true`, the `agent_dir` parameter is type-checked but its value is discarded with an `AGENT_DIR_IGNORED` warning (even on `0.0.0.0`). When bound to a non-loopback address without `DEV_MODE` (e.g. `SIDECAR_HOST`), including `agent_dir` returns HTTP 400. See [Configuration and Environment Variables](configuration-reference.html).

**Response**

| Status | Description |
|--------|-------------|
| `201` | Session created |
| `400` | Validation failed |

**Response fields (201)**

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | UUIDv4 session identifier |

**Custom tools `custom_tools[*]` shape**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **Yes** | Unique tool name (non-empty) |
| `description` | `string` | No | Human-readable tool description |
| `parameters` | `object` | No | JSON Schema defining tool parameters |
| `http` | `object` | No | HTTP-backed tool configuration. See [HTTP Tool Executor Reference](http-tool-executor-reference.html) |

> **Note:** Tools with an `http` property are automatically wrapped with the HTTP tool executor. Tools without `http` are passed through to the Pi SDK as-is and must conform to the SDK's `ToolDefinition` interface.

**Examples**

```bash
# Minimal session
curl -X POST http://127.0.0.1:9100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "model": "gemini-2.5-flash",
    "system_prompt": "You are a helpful assistant."
  }'
```
```json
{ "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
```

```bash
# Session with custom tools and overridden builtin tools
curl -X POST http://127.0.0.1:9100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "model": "gemini-2.5-flash",
    "system_prompt": "You are a code reviewer.",
    "cwd": "/home/user/project",
    "tools": ["read", "grep"],
    "custom_tools": [
      {
        "name": "lookup_user",
        "description": "Look up a user by ID",
        "parameters": { "type": "object", "properties": { "userId": { "type": "string" } } },
        "http": { "method": "GET", "url": "https://api.example.com/users/{userId}" }
      }
    ]
  }'
```
```json
{ "session_id": "f9e8d7c6-b5a4-3210-fedc-ba0987654321" }
```

---

### `POST /sessions/:id/prompt`

Send a message to an existing session and receive the AI response. Blocks until the AI completes its response.

**URL parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Session ID from `POST /sessions` |

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | **Yes** | The prompt message to send |

**Response**

| Status | Description |
|--------|-------------|
| `200` | Prompt completed (may still contain `error` field — see below) |
| `400` | `message` is missing |
| `404` | Session not found |
| `409` | Session is busy (concurrent prompt in progress) |

**Response fields (200)**

| Field | Type | Present when | Description |
|-------|------|-------------|-------------|
| `text` | `string` | Always | AI response text. May be empty for tool-only responses |
| `usage` | `object` | Always | Token usage statistics |
| `usage.input_tokens` | `number` | Always | Number of input tokens consumed |
| `usage.output_tokens` | `number` | Always | Number of output tokens generated |
| `usage.cache_read_tokens` | `number` | Always | Tokens read from cache |
| `usage.cache_write_tokens` | `number` | Always | Tokens written to cache |
| `usage.cost_usd` | `number \| null` | Always | Estimated cost in USD, or `null` if unavailable |
| `usage.duration_ms` | `number` | Always | Wall-clock duration of the prompt in milliseconds |
| `error` | `string` | On AI errors | Error messages from the AI, semicolon-separated. Up to 10 errors are captured; additional errors are summarized as `[+N more]` |

> **Warning:** An HTTP `200` response may still contain an `error` field if the AI encountered errors during processing. Always check the `error` field. Partial `text` may be present alongside the error.

**Multi-message responses**

When the AI produces multiple assistant messages (e.g., tool calls followed by a final answer), message boundaries are joined with `\n\n`. JSON responses are protected — separators are never inserted inside valid JSON structures.

**Examples**

```bash
curl -X POST http://127.0.0.1:9100/sessions/a1b2c3d4-e5f6-7890-abcd-ef1234567890/prompt \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 2 + 2?"}'
```
```json
{
  "text": "2 + 2 = 4",
  "usage": {
    "input_tokens": 15,
    "output_tokens": 8,
    "cache_read_tokens": 0,
    "cache_write_tokens": 0,
    "cost_usd": 0.00012,
    "duration_ms": 1250
  }
}
```

```bash
# Response with AI error
curl -X POST http://127.0.0.1:9100/sessions/a1b2c3d4/prompt \
  -H "Content-Type: application/json" \
  -d '{"message": "Do something"}'
```
```json
{
  "text": "Partial response before error",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 5,
    "cache_read_tokens": 0,
    "cache_write_tokens": 0,
    "cost_usd": null,
    "duration_ms": 3200
  },
  "error": "Rate limit exceeded; Request timed out"
}
```

```bash
# Session is busy
curl -X POST http://127.0.0.1:9100/sessions/a1b2c3d4/prompt \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```
```json
{ "error": "Session a1b2c3d4 is busy — concurrent prompts are not supported" }
```

---

### `POST /sessions/:id/abort`

Abort an in-progress prompt on a session.

**URL parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Session ID |

**Request body:** None (empty or `{}`)

**Response**

| Status | Description |
|--------|-------------|
| `200` | Abort signal sent |
| `404` | Session not found |

**Response fields (200)**

| Field | Type | Description |
|-------|------|-------------|
| `aborted` | `boolean` | Always `true` |

**Example**

```bash
curl -X POST http://127.0.0.1:9100/sessions/a1b2c3d4-e5f6-7890-abcd-ef1234567890/abort
```
```json
{ "aborted": true }
```

---

### `DELETE /sessions/:id`

Delete a session and release its resources.

**URL parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Session ID |

**Response**

| Status | Description |
|--------|-------------|
| `200` | Session deleted (or did not exist) |

**Response fields (200)**

| Field | Type | Description |
|-------|------|-------------|
| `deleted` | `boolean` | Always `true` |
| `existed` | `boolean` | `true` if the session existed and was disposed; `false` if the session ID was not found |

> **Note:** Deleting a non-existent session returns `200` with `existed: false` — the operation is idempotent.

**Example**

```bash
curl -X DELETE http://127.0.0.1:9100/sessions/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```
```json
{ "deleted": true, "existed": true }
```

---

## Status Code Reference

| Code | Condition |
|------|-----------|
| `200` | Request succeeded |
| `201` | Session created |
| `400` | Validation error (missing/invalid fields, unknown model) |
| `404` | Session or route not found |
| `409` | Session is busy (concurrent prompt) |
| `413` | Request body exceeds 1 MB |
| `500` | Internal server error |
| `503` | Service starting (model discovery in progress) |

### Error-to-Status Mapping

Unhandled exceptions from the session store are mapped to status codes based on the error message content:

| Error message contains | Status |
|------------------------|--------|
| `"not found for provider"` | `400` |
| `"Model is required"` | `400` |
| `"Payload too large"` | `413` |
| `"Invalid JSON"` | `400` |
| `"is busy"` | `409` |
| `"not found"` | `404` |
| _(anything else)_ | `500` |

---

## Default Tools

When `tools` is not specified in `POST /sessions`, the following builtin tools are enabled:

| Tool | Description |
|------|-------------|
| `read` | Read file contents |
| `grep` | Search file contents |
| `find` | Find files by glob pattern |
| `ls` | List directory contents |
| `bash` | Execute shell commands |

Override by passing a `tools` array. Extend with additional tools via `custom_tools`. See [Configuring Built-in and Custom Tools](configuring-tools.html) for details.

---

## Request/Response Flow

1. Client sends `GET /health` to confirm the sidecar is ready (`status: "ok"`).
2. Client sends `GET /models` to discover available models.
3. Client sends `POST /sessions` with `provider`, `model`, and `system_prompt` to create a session.
4. Client sends `POST /sessions/:id/prompt` with `message` to interact with the AI. Repeat for multi-turn conversations.
5. Client sends `POST /sessions/:id/abort` if a prompt needs to be cancelled.
6. Client sends `DELETE /sessions/:id` to clean up resources.

See [REST API Recipes](recipes-rest-api.html) for copy-paste curl examples covering each step.

## Related Pages

- [REST API Recipes](recipes-rest-api.html)
- [Python Client API Reference](python-client-reference.html)
- [Configuration and Environment Variables](configuration-reference.html)
- [Managing Session Lifecycle](managing-sessions.html)
- [Configuring Built-in and Custom Tools](configuring-tools.html)
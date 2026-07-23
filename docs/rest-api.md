# REST API Endpoints

## Server Lifecycle & Health

### GET /health
Checks the operational status of the sidecar server and the internal model registrar.

**Response Formats:**
- **200 OK**: When discovery has completed (`status: "ok"` or `status: "degraded"`).
- **503 Service Unavailable**: When the server is still running initial model discovery (`status: "starting"`).

**Response Fields:**

| Name | Type | Description |
|------|------|-------------|
| `status` | string | Operational state (`"ok"`, `"starting"`, or `"degraded"`). |
| `sessions` | number | Number of active AI sessions currently in memory. |
| `message` | string | Contextual info, usually present when starting or degraded. |

**Example Request:**
```bash
curl -X GET http://127.0.0.1:9100/health
```

**Example Response (200 OK):**
```json
{
  "status": "ok",
  "sessions": 2
}
```

---

## Model Discovery

### GET /models
Lists available AI models across all configured providers (built-ins, ACPX, and CLI providers). Models are filtered and deduplicated (e.g., ACPX base models replace built-in placeholders). 

**Response Fields:**

| Name | Type | Description |
|------|------|-------------|
| `models` | array | List of model objects available for session creation. |
| `models[].id` | string | The full model ID to be passed when creating a session. |
| `models[].name` | string | Human-readable model name. |
| `models[].provider` | string | The provider namespace (e.g., `"google"`, `"acpx-cursor"`, `"cli-claude"`). |

**Example Request:**
```bash
curl -X GET http://127.0.0.1:9100/models
```

**Example Response (200 OK):**
```json
{
  "models": [
    { "id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "provider": "google" },
    { "id": "cursor:gpt-4o[context=128k]", "name": "GPT-4o", "provider": "acpx-cursor" }
  ]
}
```

---

### POST /models/refresh
Forces a synchronous refresh of the underlying model registry, triggering jiti extension re-evaluation for ACPX/CLI agents, then returns the updated catalog.

**Response Fields:**
Identical to `GET /models`.

**Example Request:**
```bash
curl -X POST http://127.0.0.1:9100/models/refresh
```

---

### GET /models/:provider/status
Fetches diagnostics for a specific provider namespace (e.g., `"google"`, `"acpx-cursor"`), detailing authentication status and registration state.

> **Note:** Due to the sidecar's default local trust model, non-loopback clients receive a redacted version of this payload. Redacted responses omit `authStatus.source`, `authStatus.label`, and `authCheck.source` to prevent leaking environment variables or config paths. See [Server Deployment Scenarios](server-deployment-scenarios.html) for host binding details.

**Path Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `provider` | string | The provider namespace to query. |

**Response Fields:**

| Name | Type | Description |
|------|------|-------------|
| `provider` | string | Echoes the queried provider namespace. |
| `registered` | boolean | True if the provider is currently mounted on the model runtime. |
| `modelCount` | number | Number of available models for this specific provider. |
| `authStatus` | object / null | Diagnostics output from `getProviderAuthStatus()`. |
| `authStatus.configured` | boolean | True if credentials are fully configured. |
| `authStatus.source` | string | *Loopback only.* Source of credentials (e.g., `"env"`). |
| `authStatus.label` | string | *Loopback only.* Key holding the credentials. |
| `authCheck` | object / null | Output from `checkAuth()`. |
| `authCheck.type` | string | Type of auth required (e.g., `"api-key"`). |
| `error` | string | Present only on 404 (when the provider is not registered). |

**Example Request:**
```bash
curl -X GET http://127.0.0.1:9100/models/google/status
```

**Example Response (200 OK):**
```json
{
  "provider": "google",
  "registered": true,
  "modelCount": 7,
  "authStatus": {
    "configured": true,
    "source": "env",
    "label": "GEMINI_API_KEY"
  },
  "authCheck": {
    "type": "api-key"
  }
}
```

---

## Session Management

### POST /sessions
Creates an isolated AI session context. This instantiates a new AgentSession runtime instance.

**Request Body (JSON):**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `provider` | string | *(Required)* | The provider namespace (e.g., `"google"`). |
| `model` | string | *(Required)* | The ID of the model to use. |
| `system_prompt`| string | *(Required)* | System prompt initializing the AI's behavior. |
| `cwd` | string | `process.cwd()` | Current working directory for the AI runtime file resolution. |
| `agent_dir` | string | `/tmp/pi-...` | Absolute path to the user-level agent workspace. Rejected with 400 for remote clients unless `DEV_MODE=true` is set. |
| `tools` | array | `[]` | Array of built-in tool names to enable (e.g., `["read", "grep"]`). |
| `custom_tools` | array | `[]` | Array of custom tool definitions. See [Extending Capabilities with Tools](extending-with-tools.html) for payload schemas. |

**Response Fields:**

| Name | Type | Description |
|------|------|-------------|
| `session_id` | string | Unique opaque identifier for the created session. |

**Example Request:**
```bash
curl -X POST http://127.0.0.1:9100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "model": "gemini-2.5-flash",
    "system_prompt": "You are a helpful assistant.",
    "tools": ["read", "ls"]
  }'
```

**Example Response (201 Created):**
```json
{
  "session_id": "8f83b169-2a9a-4c28-98de-1eab9dbf2e4b"
}
```

---

### DELETE /sessions/:id
Tears down an AI session and frees associated process memory.

**Path Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `id` | string | The session ID returned by `POST /sessions`. |

**Response Fields:**

| Name | Type | Description |
|------|------|-------------|
| `deleted` | boolean | Always `true` if the request succeeds. |
| `existed` | boolean | `true` if the session was found and removed, `false` if it was already gone. |

**Example Request:**
```bash
curl -X DELETE http://127.0.0.1:9100/sessions/8f83b169-2a9a-4c28-98de-1eab9dbf2e4b
```

**Example Response (200 OK):**
```json
{
  "deleted": true,
  "existed": true
}
```

---

## Prompting & Execution

### POST /sessions/:id/prompt
Submits a user message to an active session, triggering LLM inference and automatic tool execution loop. The request blocks until the AI completes its reasoning, optionally yielding errors encountered during execution.

**Path Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `id` | string | The session ID returned by `POST /sessions`. |

**Request Body (JSON):**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `message` | string | *(Required)* | The input prompt text. |

**Response Fields:**

| Name | Type | Description |
|------|------|-------------|
| `text` | string | The final text content returned by the AI. Empty strings are possible if the AI only called tools. |
| `usage` | object | Computed token usage and execution telemetry. |
| `usage.input_tokens` | number | Number of prompt input tokens processed. |
| `usage.output_tokens` | number | Number of completion tokens generated. |
| `usage.cache_read_tokens` | number | Tokens read from the provider's context cache. |
| `usage.cache_write_tokens`| number | Tokens written to the provider's context cache. |
| `usage.cost_usd` | number | Optional estimated financial cost (if provided by SDK). |
| `usage.duration_ms` | number | End-to-end processing time for this specific prompt call. |
| `error` | string | *(Optional)* If the AI triggered runtime errors (e.g., tool crash), they are surfaced here. `text` may still be populated. |

**Example Request:**
```bash
curl -X POST http://127.0.0.1:9100/sessions/8f83b169-2a9a-4c28-98de-1eab9dbf2e4b/prompt \
  -H "Content-Type: application/json" \
  -d '{ "message": "List files in the current directory." }'
```

**Example Response (200 OK):**
```json
{
  "text": "I found 3 files in your directory: package.json, server.ts, and README.md.",
  "usage": {
    "input_tokens": 142,
    "output_tokens": 45,
    "cache_read_tokens": 0,
    "cache_write_tokens": 0,
    "duration_ms": 3450
  }
}
```

---

### POST /sessions/:id/abort
Interrupts a currently executing prompt request. The original `POST /sessions/:id/prompt` connection will immediately terminate or return partial results.

**Path Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `id` | string | The session ID to interrupt. |

**Response Fields:**

| Name | Type | Description |
|------|------|-------------|
| `aborted` | boolean | Always `true` if the signal was dispatched successfully. |

**Example Request:**
```bash
curl -X POST http://127.0.0.1:9100/sessions/8f83b169-2a9a-4c28-98de-1eab9dbf2e4b/abort
```

**Example Response (200 OK):**
```json
{
  "aborted": true
}
```

## Related Pages

- [Managing AI Conversations](managing-conversations.html)
- [Extending Capabilities with Tools](extending-with-tools.html)
- [Python Client Reference](python-client.html)
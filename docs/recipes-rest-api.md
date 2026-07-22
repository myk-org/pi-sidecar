# REST API Recipes

Copy-paste `curl` and HTTP examples for every pi-sidecar endpoint. Each recipe is self-contained and ready to run against a sidecar on `http://127.0.0.1:9100`.

> **Note:** These recipes use the raw HTTP API. For Python workflows, see [Python Client Recipes](recipes-python-client.html). For full endpoint schemas and status codes, see [REST API Reference](rest-api-reference.html).

---

## Check if the Sidecar Is Ready

Verify the sidecar is running and model discovery has completed before sending prompts.

```bash
curl -s http://127.0.0.1:9100/health | jq
```

**Response (ready):**

```json
{ "status": "ok", "sessions": 0 }
```

**Response (still starting — 503):**

```json
{ "status": "starting", "message": "Model discovery in progress" }
```

**Response (degraded — model discovery failed):**

```json
{ "status": "degraded", "message": "Model discovery failed", "sessions": 2 }
```

The `status` field tells you whether prompts will work: `ok` means ready, `starting` means wait and retry, and `degraded` means the sidecar is up but model discovery had errors.

> **Tip:** Poll `/health` in a loop before your first prompt. A `503` status code means discovery is still in progress — wait a few seconds and retry.

---

## Wait for the Sidecar to Be Ready (Shell Loop)

Block a script until the sidecar finishes startup and model discovery.

```bash
echo "Waiting for sidecar..."
until curl -sf http://127.0.0.1:9100/health | jq -e '.status == "ok"' > /dev/null 2>&1; do
  sleep 2
done
echo "Sidecar is ready."
```

This is useful in CI pipelines or startup scripts where the sidecar is launched in the background. The loop exits as soon as `/health` returns `{"status": "ok"}`.

---

## List Available Models

Discover which AI models and providers are available.

```bash
curl -s http://127.0.0.1:9100/models | jq
```

**Response:**

```json
{
  "models": [
    { "id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "provider": "google" },
    { "id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro", "provider": "google" },
    { "id": "cursor:gpt-4o[context=128k]", "name": "Gpt 4o (cursor)", "provider": "acpx-cursor" }
  ]
}
```

Each model object has `id` (use in `POST /sessions`), `name` (human-readable), and `provider` (use in `POST /sessions`). See [Discovering and Selecting Models](discovering-models.html) for provider mapping details.

---

## Filter Models by Provider (with jq)

List only models from a specific provider.

```bash
# Gemini models only
curl -s http://127.0.0.1:9100/models | jq '.models[] | select(.provider == "google")'

# Cursor models only
curl -s http://127.0.0.1:9100/models | jq '.models[] | select(.provider == "acpx-cursor")'

# Just the model IDs
curl -s http://127.0.0.1:9100/models | jq -r '.models[].id'
```

The sidecar returns all models in a flat list. Use `jq` to filter client-side by `provider` or extract just the fields you need.

---

## Refresh Model Discovery

Force the sidecar to re-discover models from all configured providers (including ACPX agents).

```bash
curl -s -X POST http://127.0.0.1:9100/models/refresh | jq
```

**Response:**

```json
{
  "models": [
    { "id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "provider": "google" },
    { "id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro", "provider": "google" }
  ]
}
```

This triggers a full model refresh and returns the updated list. Use it after changing `ACPX_AGENTS` or adding new provider extensions.

> **Warning:** This endpoint creates a temporary bootstrap session internally and can take up to 30 seconds per ACPX agent. Do not call it on every request.

---

## Single-Shot Prompt (Create → Prompt → Delete)

Send one prompt and clean up immediately — the most common pattern.

```bash
# 1. Create a session
SESSION=$(curl -s -X POST http://127.0.0.1:9100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "model": "gemini-2.5-flash",
    "system_prompt": "You are a helpful assistant. Be concise."
  }' | jq -r '.session_id')

echo "Session: $SESSION"

# 2. Send a prompt
curl -s -X POST "http://127.0.0.1:9100/sessions/$SESSION/prompt" \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the three laws of robotics?"}' | jq

# 3. Delete the session
curl -s -X DELETE "http://127.0.0.1:9100/sessions/$SESSION" | jq
```

This is the full lifecycle: create a session, send a prompt, and clean up. Every session consumes memory, so always delete when done.

---

## Create a Session with a Working Directory

Set `cwd` to control where the Pi SDK loads project resources from (skills, prompts, extensions from `{cwd}/.pi/` and `AGENTS.md` from `{cwd}/`).

```bash
curl -s -X POST http://127.0.0.1:9100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "model": "gemini-2.5-pro",
    "system_prompt": "You are a code reviewer.",
    "cwd": "/home/user/my-project"
  }' | jq
```

**Response:**

```json
{ "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
```

When `cwd` is omitted, it defaults to the sidecar's own working directory. See [Configuration and Environment Variables](configuration-reference.html) for details on resource loading.

---

## Create a Session with a Custom Agent Directory

Point `agent_dir` to a global agent directory for user-level resources (skills, extensions, auth, model configs).

```bash
curl -s -X POST http://127.0.0.1:9100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "model": "gemini-2.5-flash",
    "system_prompt": "You are a helpful assistant.",
    "cwd": "/home/user/my-project",
    "agent_dir": "/home/user/.pi/agent"
  }' | jq
```

The `agent_dir` must be an absolute path pointing to an existing directory. When omitted, it defaults to `/tmp/pi-sidecar-agent`.

> **Warning:** In `DEV_MODE=true`, `agent_dir` is type-checked then discarded with an `AGENT_DIR_IGNORED` warning. On non-loopback binds without `DEV_MODE` (e.g. `SIDECAR_HOST`), including `agent_dir` returns HTTP 400.

---

## Multi-Turn Conversation

Reuse a session ID across multiple prompts to maintain conversation context.

```bash
# Create a session
SESSION=$(curl -s -X POST http://127.0.0.1:9100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "model": "gemini-2.5-flash",
    "system_prompt": "You are a senior Python developer. Be concise."
  }' | jq -r '.session_id')

# Turn 1
curl -s -X POST "http://127.0.0.1:9100/sessions/$SESSION/prompt" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the best Python web framework for a REST API?"}' | jq '.text'

# Turn 2 — same session, conversation context preserved
curl -s -X POST "http://127.0.0.1:9100/sessions/$SESSION/prompt" \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me a minimal example with that framework."}' | jq '.text'

# Clean up
curl -s -X DELETE "http://127.0.0.1:9100/sessions/$SESSION" | jq
```

Each prompt in the same session sees the full conversation history. See [Managing Session Lifecycle](managing-sessions.html) for best practices on session reuse.

> **Warning:** Sessions do not support concurrent prompts. Sending a second prompt while one is in flight returns HTTP 409 with `"Session ... is busy"`.

---

## Read the Prompt Response (Full Structure)

Understand every field in a prompt response.

```bash
curl -s -X POST "http://127.0.0.1:9100/sessions/$SESSION/prompt" \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain HTTPS in one sentence."}' | jq
```

**Response:**

```json
{
  "text": "HTTPS encrypts HTTP traffic using TLS to prevent eavesdropping and tampering.",
  "usage": {
    "input_tokens": 42,
    "output_tokens": 18,
    "cache_read_tokens": 0,
    "cache_write_tokens": 0,
    "cost_usd": 0.00012,
    "duration_ms": 1523
  }
}
```

**Response with errors (AI encountered an issue but returned partial output):**

```json
{
  "text": "partial output here...",
  "usage": { "input_tokens": 10, "output_tokens": 5, "duration_ms": 800 },
  "error": "AI model returned an error during processing"
}
```

The `error` field appears only when the AI reported errors. An HTTP 200 with an `error` field means the model produced output but with issues — always check for this field. See [Sending Prompts to AI Models](sending-prompts.html) for details on error handling.

---

## Override Built-in Tools

Restrict which tools the AI session can use (default: `read`, `grep`, `find`, `ls`, `bash`).

```bash
curl -s -X POST http://127.0.0.1:9100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "model": "gemini-2.5-flash",
    "system_prompt": "You are a read-only code reviewer.",
    "cwd": "/home/user/my-project",
    "tools": ["read", "grep", "find", "ls"]
  }' | jq
```

Pass a `tools` array to override the defaults. This example removes `bash` to create a read-only session. When `tools` is omitted, all five default tools are enabled. See [Configuring Built-in and Custom Tools](configuring-tools.html) for the full tool configuration reference.

---

## Add Custom Tools

Attach custom tool definitions that the AI can invoke during a session.

```bash
curl -s -X POST http://127.0.0.1:9100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "model": "gemini-2.5-flash",
    "system_prompt": "You are a helpful assistant with access to a user lookup tool.",
    "custom_tools": [
      {
        "name": "lookup_user",
        "description": "Look up a user by their email address",
        "parameters": {
          "type": "object",
          "properties": {
            "email": { "type": "string", "description": "User email address" }
          },
          "required": ["email"]
        },
        "http": {
          "method": "GET",
          "url": "https://api.example.com/users",
          "query_params": { "email": "{email}" }
        }
      }
    ]
  }' | jq
```

Custom tools with an `http` property are automatically backed by HTTP requests with `{paramName}` placeholder interpolation. Each custom tool entry must be a plain object with a non-empty string `name`. See [Configuring Built-in and Custom Tools](configuring-tools.html) for the full `HttpToolConfig` schema and [HTTP Tool Executor Reference](http-tool-executor-reference.html) for security details.

---

## Add an HTTP-Backed Custom Tool with POST Body

Define a custom tool that sends a POST request with an interpolated JSON body.

```bash
curl -s -X POST http://127.0.0.1:9100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "model": "gemini-2.5-flash",
    "system_prompt": "You can create support tickets.",
    "custom_tools": [
      {
        "name": "create_ticket",
        "description": "Create a support ticket",
        "parameters": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "priority": { "type": "string", "enum": ["low", "medium", "high"] }
          },
          "required": ["title", "priority"]
        },
        "http": {
          "method": "POST",
          "url": "https://api.example.com/tickets",
          "headers": { "Authorization": "Bearer my-api-token" },
          "body_template": { "title": "{title}", "priority": "{priority}" },
          "timeout_ms": 15000
        }
      }
    ]
  }' | jq
```

String values in `body_template` objects are automatically JSON-escaped to prevent injection. The executor uses a 30-second default timeout, which you can override with `timeout_ms`. The `Content-Type: application/json` header is added automatically when a body is present and no content-type is set.

---

## Abort a Running Prompt

Cancel an in-flight prompt from another terminal or process.

```bash
curl -s -X POST "http://127.0.0.1:9100/sessions/$SESSION/abort" | jq
```

**Response:**

```json
{ "aborted": true }
```

This sends an abort signal to the AI session. The in-flight prompt call will return with whatever partial results were available. Aborting a session that has no active prompt is a no-op that succeeds. See [Managing Session Lifecycle](managing-sessions.html) for abort patterns.

---

## Delete a Session

Clean up a session and free its resources.

```bash
curl -s -X DELETE "http://127.0.0.1:9100/sessions/$SESSION" | jq
```

**Response (session existed):**

```json
{ "deleted": true, "existed": true }
```

**Response (session already gone):**

```json
{ "deleted": true, "existed": false }
```

Deleting a nonexistent session returns 200 with `"existed": false` — it is always safe to call. Stale sessions are also automatically cleaned up every 10 minutes (sessions idle for over 1 hour are removed).

---

## Handle Common Errors

Reference for error responses you may encounter across endpoints.

### Session not found (404)

```bash
curl -s -X POST "http://127.0.0.1:9100/sessions/nonexistent-id/prompt" \
  -H "Content-Type: application/json" \
  -d '{"message": "hello"}' | jq
```

```json
{ "error": "Session nonexistent-id not found" }
```

### Missing required fields (400)

```bash
curl -s -X POST http://127.0.0.1:9100/sessions \
  -H "Content-Type: application/json" \
  -d '{"provider": "google"}' | jq
```

```json
{ "error": "model is required and must be a non-empty string. Use GET /models to list available models." }
```

### Concurrent prompt on busy session (409)

```json
{ "error": "Session a1b2c3d4-... is busy — concurrent prompts are not supported" }
```

### Invalid model (400)

```json
{ "error": "Model 'nonexistent-model' not found for provider 'google'. Use GET /models to list available models." }
```

### Payload too large (413)

Request bodies larger than 1 MB are rejected:

```json
{ "error": "Payload too large" }
```

### Invalid JSON (400)

```json
{ "error": "Invalid JSON body" }
```

See [REST API Reference](rest-api-reference.html) for the complete error catalog and status code documentation.

---

## Full Scripted Workflow (Shell)

A complete shell script that checks health, picks a model, runs a prompt, and cleans up.

```bash
#!/usr/bin/env bash
set -euo pipefail

SIDECAR="http://127.0.0.1:9100"

# 1. Wait for sidecar
echo "Waiting for sidecar..."
until curl -sf "$SIDECAR/health" | jq -e '.status == "ok"' > /dev/null 2>&1; do
  sleep 2
done
echo "Sidecar ready."

# 2. Pick the first available Gemini model
MODEL=$(curl -s "$SIDECAR/models" | jq -r '.models[] | select(.provider == "google") | .id' | head -1)
echo "Using model: $MODEL"

# 3. Create session
SESSION=$(curl -sf -X POST "$SIDECAR/sessions" \
  -H "Content-Type: application/json" \
  -d "{
    \"provider\": \"google\",
    \"model\": \"$MODEL\",
    \"system_prompt\": \"You are a helpful assistant. Be concise.\"
  }" | jq -r '.session_id')
echo "Session: $SESSION"

# 4. Send prompt
RESPONSE=$(curl -sf -X POST "$SIDECAR/sessions/$SESSION/prompt" \
  -H "Content-Type: application/json" \
  -d '{"message": "Summarize the Unix philosophy in one paragraph."}')

echo "$RESPONSE" | jq -r '.text'
echo ""
echo "Tokens: in=$(echo "$RESPONSE" | jq '.usage.input_tokens'), out=$(echo "$RESPONSE" | jq '.usage.output_tokens')"

# 5. Clean up
curl -sf -X DELETE "$SIDECAR/sessions/$SESSION" > /dev/null
echo "Session cleaned up."
```

This script is safe for CI: it waits for the sidecar, dynamically selects a model, and always cleans up the session.

---

## Quick Reference: All Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `ok`, `starting`, or `degraded` |
| `GET` | `/models` | List all available models |
| `POST` | `/models/refresh` | Re-run model discovery |
| `POST` | `/sessions` | Create a new AI session |
| `POST` | `/sessions/:id/prompt` | Send a message to a session |
| `POST` | `/sessions/:id/abort` | Abort an in-flight prompt |
| `DELETE` | `/sessions/:id` | Delete a session and free resources |

> **Tip:** The sidecar binds to `127.0.0.1:9100` by default. Set `SIDECAR_PORT` to change the port or `DEV_MODE=true` to bind to `0.0.0.0`. See [Configuration and Environment Variables](configuration-reference.html) for all options.

## Related Pages

- [Python Client Recipes](recipes-python-client.html)
- [REST API Reference](rest-api-reference.html)
- [Managing Session Lifecycle](managing-sessions.html)
- [Configuring Built-in and Custom Tools](configuring-tools.html)
- [Discovering and Selecting Models](discovering-models.html)
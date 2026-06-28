# Configuring Built-in and Custom Tools

Control which tools the AI can use during a session — restrict to a safe subset, add your own domain-specific tools, or connect external APIs through HTTP-backed tools with automatic parameter interpolation.

## Prerequisites

- A running pi-sidecar server (see [Getting Started with pi-sidecar](quickstart.html))
- The Python client installed (`pip install pi-sidecar-client`) or `curl` for REST calls

## Quick Example

Give the AI only `read` and `grep` (dropping `find`, `ls`, and `bash`):

```python
from pi_sidecar_client import call_ai_once

result = await call_ai_once(
    "Summarize the README.md file",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="You are a code reviewer.",
    cwd="/path/to/project",
    tools=["read", "grep"],
)
```

## Default Tool Set

When you don't pass a `tools` parameter, every session gets these five built-in tools:

| Tool | What It Does |
|------|-------------|
| `read` | Read file contents |
| `grep` | Search file contents by pattern |
| `find` | Find files by glob pattern |
| `ls` | List directory contents |
| `bash` | Execute shell commands |

## Overriding Built-in Tools

Pass a `tools` array to replace the defaults entirely. Only the tools you list will be available.

```python
# Read-only session — no shell access
result = await call_ai_once(
    "What does the main function do?",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="Analyze this code.",
    tools=["read", "grep", "find", "ls"],
)
```

To restore the defaults explicitly:

```python
tools=["read", "grep", "find", "ls", "bash"]
```

> **Tip:** Restrict tools to the minimum the AI needs. Omitting `bash` prevents the AI from running arbitrary commands.

## Adding Custom Tools

Pass `custom_tools` to give the AI access to tools you define. Custom tools are **added alongside** the built-in tools (or whichever built-ins you specify in `tools`).

Each custom tool must be a plain object with at least a `name` property:

```python
result = await call_ai_once(
    "Look up user 42 and summarize their profile",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="You are a support agent.",
    custom_tools=[
        {
            "name": "get_user",
            "description": "Fetch a user profile by ID",
            "parameters": {
                "type": "object",
                "properties": {
                    "userId": {"type": "string", "description": "The user ID"}
                },
            },
            "http": {
                "method": "GET",
                "url": "https://api.example.com/users/{userId}",
            },
        }
    ],
)
```

When the AI decides to use `get_user`, the sidecar makes the HTTP request automatically, interpolates `{userId}` from the AI's parameters, and returns the response to the AI.

### Custom Tool Validation Rules

The sidecar validates every entry in `custom_tools`:

- Each entry must be a **plain object** (not an array or null)
- Each entry must have a non-empty **string `name`**
- Entries failing validation are rejected with a `400` error

## HTTP-Backed Tools

Any custom tool with an `http` property is automatically wired up as an HTTP-backed tool. The sidecar handles the request lifecycle — you just declare the configuration.

### Supported HTTP Methods

`GET`, `POST`, `PUT`, `DELETE`, `PATCH`

### Parameter Interpolation

Use `{paramName}` placeholders anywhere in the HTTP config. The sidecar replaces them with values the AI provides at call time:

```python
custom_tools=[
    {
        "name": "create_ticket",
        "description": "Create a support ticket",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "priority": {"type": "string"},
                "description": {"type": "string"},
            },
        },
        "http": {
            "method": "POST",
            "url": "https://api.example.com/tickets",
            "headers": {
                "Authorization": "Bearer {token}",
                "X-Request-Id": "{reqId}",
            },
            "query_params": {
                "priority": "{priority}",
            },
            "body_template": {
                "title": "{title}",
                "body": "{description}",
                "source": "ai-agent",
            },
        },
    }
]
```

Placeholders work in four locations:

| Location | Example | Notes |
|----------|---------|-------|
| URL path | `https://api.example.com/users/{userId}` | Values are URI-encoded for safety |
| Headers | `"Authorization": "Bearer {token}"` | CR/LF characters are stripped |
| Query parameters | `"q": "{searchTerm}"` | Values are URL-encoded automatically |
| Body template | `{"name": "{itemName}"}` | String values are JSON-escaped in object templates |

> **Note:** Unmatched placeholders (those not provided by the AI) are left as-is in the output.

### String vs. Object Body Templates

You can specify `body_template` as either a string or an object:

**String template** — interpolated directly, giving you full control over the format:

```python
"body_template": '{"name": "{itemName}", "count": {itemCount}}'
```

**Object template** — serialized to JSON, with automatic JSON-escaping to prevent injection:

```python
"body_template": {"name": "{itemName}", "active": True}
```

> **Tip:** Use object templates when possible. They automatically JSON-escape string values containing quotes, backslashes, or newlines, preventing malformed JSON.

### snake_case and camelCase

The HTTP config accepts both naming conventions. These are equivalent:

| camelCase | snake_case |
|-----------|-----------|
| `queryParams` | `query_params` |
| `bodyTemplate` | `body_template` |
| `timeoutMs` | `timeout_ms` |

When both are provided, camelCase takes priority.

### Timeouts and Response Limits

- **Request timeout**: 30 seconds by default. Override with `timeout_ms`:

  ```python
  "http": {
      "method": "GET",
      "url": "https://slow-api.example.com/report",
      "timeout_ms": 60000,  # 60 seconds
  }
  ```

- **Response size limit**: Responses larger than 1 MB are truncated automatically.

### Error Handling

HTTP tool executors never crash the session. Errors are returned as text strings to the AI, which can then decide how to respond:

| Scenario | Returned to the AI |
|----------|--------------------|
| HTTP 404 response | `HTTP 404: Not Found` |
| Network failure | `HTTP request failed: Connection refused` |
| Request timeout | `HTTP request failed: Request timed out after 30000ms` |
| Invalid URL | `HTTP request failed: Invalid URL` |
| Blocked scheme (e.g. `file://`) | `HTTP request failed: Unsupported URL scheme 'file:' — only http: and https: are allowed` |

## Advanced Usage

### Combining Built-in Overrides with Custom Tools

You can restrict built-in tools *and* add custom tools at the same time:

```python
result = await call_ai_once(
    "Read the config file and check the deployment status",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="You are a DevOps assistant.",
    tools=["read"],  # Only allow reading files
    custom_tools=[
        {
            "name": "check_deployment",
            "description": "Check deployment status for a service",
            "parameters": {
                "type": "object",
                "properties": {
                    "service": {"type": "string"},
                },
            },
            "http": {
                "method": "GET",
                "url": "https://deploy.internal/status/{service}",
            },
        }
    ],
)
```

The AI will have access to `read` (built-in) and `check_deployment` (custom) — nothing else.

### Custom Tools with Multi-Turn Sessions

Custom tools are configured at session creation time. For multi-turn conversations, pass them when you create the session:

```python
from pi_sidecar_client import call_ai, get_sidecar_client

# First turn — creates session with custom tools
result = await call_ai(
    "Look up the order status for order 12345",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="You are a support agent.",
    custom_tools=[
        {
            "name": "get_order",
            "description": "Look up an order by ID",
            "parameters": {
                "type": "object",
                "properties": {"orderId": {"type": "string"}},
            },
            "http": {
                "method": "GET",
                "url": "https://api.example.com/orders/{orderId}",
            },
        }
    ],
)

# Second turn — reuses session (tools are already configured)
result = await call_ai(
    "Now cancel that order",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    session_id=result.session_id,
)

# Clean up
client = get_sidecar_client()
if result.session_id:
    await client.delete_session(result.session_id)
```

> **Note:** You cannot change `tools` or `custom_tools` on an existing session. Create a new session if you need a different tool set.

### Security Considerations

The sidecar applies several protections to HTTP-backed tools automatically:

- **URI encoding** — Path parameters are encoded to prevent path traversal (`../../admin` becomes `..%2F..%2Fadmin`)
- **CRLF stripping** — Carriage return and line feed characters are removed from header values to prevent header injection
- **JSON escaping** — String values in object body templates are JSON-escaped to prevent JSON injection
- **URL scheme validation** — Only `http:` and `https:` URLs are allowed; schemes like `file:` are blocked

> **Warning:** Host allowlisting and private-network blocking are **not** built in. If your sidecar is accessible to untrusted callers, you are responsible for restricting which hosts custom tools can reach.

For the full HTTP tool configuration schema and all security details, see [HTTP Tool Executor Reference](http-tool-executor-reference.html).

## Troubleshooting

**"custom_tools entries must be plain objects with a string 'name' property"**
Every item in `custom_tools` must be a dictionary with a non-empty `name` key. Check for `None` values, empty strings, or array entries in your list.

**"tools must be an array of strings"**
The `tools` parameter only accepts a list of strings (e.g., `["read", "bash"]`). Passing a single string or non-string values will be rejected.

**HTTP tool returns "Request timed out after 30000ms"**
The target API is too slow. Increase the timeout with `timeout_ms` in the `http` config, or check that the target service is reachable from the sidecar host.

**HTTP tool returns "Unsupported URL scheme"**
Only `http://` and `https://` URLs are supported. Schemes like `file://`, `ftp://`, or `data:` are blocked for security.

## Related Pages

- [HTTP Tool Executor Reference](http-tool-executor-reference.html)
- [Managing Session Lifecycle](managing-sessions.html)
- [Sending Prompts to AI Models](sending-prompts.html)
- [REST API Reference](rest-api-reference.html)
- [REST API Recipes](recipes-rest-api.html)
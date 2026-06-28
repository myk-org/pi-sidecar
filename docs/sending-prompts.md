# Sending Prompts to AI Models

Send prompts to AI models through the pi-sidecar Python client — either as fire-and-forget single-shot calls or as part of multi-turn conversations that preserve context across messages.

## Prerequisites

- A running pi-sidecar server (see [Getting Started with pi-sidecar](quickstart.html))
- The `pi-sidecar-client` Python package installed
- At least one AI provider configured (e.g., Gemini, Cursor, Claude)

## Quick Example

The fastest way to get an AI response — one function call, no cleanup required:

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    result = await call_ai_once(
        "What are the three laws of robotics?",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        system_prompt="You are a helpful assistant. Be concise.",
    )

    if result.success:
        print(result.text)
        print(f"\nTokens: in={result.usage.input_tokens} out={result.usage.output_tokens}")
    else:
        print(f"Error: {result.text}")

asyncio.run(main())
```

This creates a session behind the scenes, sends the prompt, and automatically deletes the session when done.

## Choosing Between Single-Shot and Multi-Turn

| Approach | Function | Session cleanup | Conversation context |
|----------|----------|----------------|---------------------|
| **Single-shot** | `call_ai_once()` | Automatic | No — each call is independent |
| **Multi-turn** | `call_ai()` | Manual (you delete) | Yes — model remembers previous messages |

Use `call_ai_once` when you need a one-off answer. Use `call_ai` when follow-up questions depend on earlier context.

## Single-Shot Prompts with `call_ai_once`

### Step 1: Send the prompt

Pass your prompt text along with a provider, model, and optional system prompt:

```python
result = await call_ai_once(
    "Explain Docker in one paragraph.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="You are a DevOps instructor.",
)
```

### Step 2: Check the result

Every call returns an `AIResult` with a `success` flag. Always check it before using the response:

```python
if result.success:
    print(result.text)
else:
    print(f"Error: {result.error}")
```

> **Note:** Even when the HTTP request succeeds, `result.success` can be `False` if the AI model itself returned an error (e.g., rate limiting). Always check `result.success`.

### Step 3: Inspect token usage (optional)

Token counts and cost data are available on every successful result:

```python
if result.usage:
    print(f"Input tokens:  {result.usage.input_tokens}")
    print(f"Output tokens: {result.usage.output_tokens}")
    print(f"Cache read:    {result.usage.cache_read_tokens}")
    print(f"Cache write:   {result.usage.cache_write_tokens}")
    print(f"Cost (USD):    {result.usage.cost_usd}")
    print(f"Duration (ms): {result.usage.duration_ms}")
```

## Multi-Turn Conversations with `call_ai`

Multi-turn conversations let the model remember what was said earlier. You create a session on the first call, then pass the `session_id` back on follow-ups.

### Step 1: Start the conversation

```python
from pi_sidecar_client import call_ai, get_sidecar_client

# First message — creates a new session automatically
result = await call_ai(
    "I'm building a REST API in Python. What framework should I use?",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="You are a senior Python developer. Be concise.",
)
session_id = result.session_id
```

### Step 2: Send follow-up messages

Pass the `session_id` from the previous result to continue the conversation. The model has full context of earlier messages:

```python
result = await call_ai(
    "Show me a minimal example with that framework.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    session_id=session_id,
)
```

> **Tip:** When reusing a session, `provider`, `model`, and `system_prompt` are only used if a new session needs to be created. If you pass a valid `session_id`, those parameters are ignored.

### Step 3: Clean up the session

Unlike `call_ai_once`, you are responsible for deleting multi-turn sessions when the conversation is done. Always use a `try/finally` block:

```python
session_id = None
try:
    result = await call_ai(
        "What is Kubernetes?",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        system_prompt="Be concise.",
    )
    session_id = result.session_id

    result = await call_ai(
        "How does it compare to Docker Swarm?",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        session_id=session_id,
    )
    print(result.text)
finally:
    if session_id:
        client = get_sidecar_client()
        await client.delete_session(session_id)
```

> **Warning:** Leaked sessions consume server memory. The sidecar automatically cleans up stale sessions after one hour, but relying on this is not recommended. See [Managing Session Lifecycle](managing-sessions.html) for cleanup patterns.

## Working with Providers and Models

The Python client accepts friendly provider names and maps them automatically:

| Friendly name | Sidecar provider | Model prefix |
|--------------|-----------------|--------------|
| `gemini` | `google` | None needed |
| `cursor` | `acpx-cursor` | `cursor:` added automatically |
| `claude` | `google-vertex-claude` | None needed |

You can use any provider name — unrecognized names are passed through unchanged. To discover available models, see [Discovering and Selecting Models](discovering-models.html).

```python
# These all work — provider mapping is handled automatically
await call_ai_once("Hello", ai_provider="gemini", ai_model="gemini-2.5-flash")
await call_ai_once("Hello", ai_provider="cursor", ai_model="gpt-4o")
await call_ai_once("Hello", ai_provider="claude", ai_model="claude-sonnet-4-20250514")
```

## Advanced Usage

### Setting a call timeout

Long-running prompts (e.g., complex code generation) may need more time. Set `ai_call_timeout` in **minutes**:

```python
result = await call_ai_once(
    "Refactor this entire codebase to use async/await.",
    ai_provider="gemini",
    ai_model="gemini-2.5-pro",
    ai_call_timeout=10,  # 10 minutes
)
```

The default client timeout is 600 seconds (10 minutes). Use `ai_call_timeout` to override it for individual calls.

### Setting the working directory with `cwd`

The `cwd` parameter tells the sidecar where to find project-level resources. The Pi SDK loads skills, prompts, extensions, and themes from `{cwd}/.pi/` and reads `AGENTS.md` from `{cwd}/`:

```python
result = await call_ai_once(
    "Review this project's code structure.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    cwd="/path/to/your/project",
)
```

When omitted, `cwd` defaults to the system temp directory.

### Setting the agent directory with `agent_dir`

The optional `agent_dir` points to a global agent directory for user-level resources (skills, extensions, auth, model configs):

```python
result = await call_ai_once(
    "Analyze this code.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    agent_dir="/home/user/.pi/agent",
)
```

> **Note:** `agent_dir` must be an absolute path pointing to an existing directory. It defaults to `/tmp/pi-sidecar-agent` when omitted.

### Configuring tools

By default, sessions include the built-in tool set (`read`, `grep`, `find`, `ls`, `bash`). You can override or extend the available tools:

```python
# Use only specific built-in tools
result = await call_ai_once(
    "Read the README file.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    tools=["read", "grep"],
)

# Add custom tools alongside built-in tools
result = await call_ai_once(
    "Look up the ticket status.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    custom_tools=[{"name": "get_ticket", "description": "Fetch a support ticket by ID"}],
)
```

For detailed tool configuration including HTTP-backed tools with parameter interpolation, see [Configuring Built-in and Custom Tools](configuring-tools.html).

### Handling errors and partial output

When the AI model returns an error during processing, the result may contain both partial output and an error message:

```python
result = await call_ai_once("...", ai_provider="gemini", ai_model="gemini-2.5-flash")

if not result.success:
    print(f"Error: {result.error}")
    if result.text:
        print(f"Partial output: {result.text}")
```

If `call_ai_once` fails to delete the session during cleanup, `result.session_id` is preserved so you can retry cleanup manually:

```python
if result.session_id:
    # Cleanup failed — session still exists
    client = get_sidecar_client()
    await client.delete_session(result.session_id)
```

### Recording token usage

Register a callback to capture token counts for billing or analytics after each call:

```python
from pi_sidecar_client import set_usage_recorder

set_usage_recorder(my_usage_callback)

result = await call_ai_once("What is the speed of light?", ai_provider="gemini", ai_model="gemini-2.5-flash")
await result.record_usage(
    request_id="req-001",
    call_type="question",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
)
```

See [Tracking Token Usage and Costs](tracking-usage.html) for full details on setting up usage recording.

### Connecting to a custom sidecar URL

By default, the client connects to `http://127.0.0.1:9100`. Override this with the `SIDECAR_URL` environment variable or by instantiating the client directly:

```python
from pi_sidecar_client import SidecarClient

client = SidecarClient(base_url="http://localhost:9200")
session_id = await client.create_session(
    provider="gemini",
    model="gemini-2.5-flash",
    system_prompt="You are a helpful assistant.",
)
result = await client.prompt(session_id, "Hello!")
await client.delete_session(session_id)
await client.close()
```

See [Configuration and Environment Variables](configuration-reference.html) for all available settings.

## Troubleshooting

**"Sidecar unavailable" or connection refused**
The sidecar server isn't running. Start it first, then verify with a health check:

```python
from pi_sidecar_client import check_sidecar_available

available, message = await check_sidecar_available()
print(message)  # "Sidecar is ready" or reason for failure
```

**"Sidecar starting: Model discovery in progress"**
The sidecar is still discovering available models at startup. Wait a few seconds and retry. Model discovery typically completes within 30 seconds.

**Result has `success=False` with an error about rate limiting**
The AI provider rejected the request. Wait and retry, or switch to a different model. The error is surfaced directly in `result.error`.

**Session "is busy" (HTTP 409)**
You sent a prompt to a session that is still processing a previous prompt. Wait for the in-progress prompt to complete, or abort it first. See [Managing Session Lifecycle](managing-sessions.html) for abort patterns.

**Empty `result.text` but `success=True`**
This is valid — it typically means the AI used tools to perform an action without generating text output. Check whether the requested task was completed through tool execution.

## Related Pages

- [Getting Started with pi-sidecar](quickstart.html)
- [Managing Session Lifecycle](managing-sessions.html)
- [Configuring Built-in and Custom Tools](configuring-tools.html)
- [Tracking Token Usage and Costs](tracking-usage.html)
- [Python Client API Reference](python-client-reference.html)
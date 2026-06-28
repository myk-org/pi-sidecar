Let me start by reading the knowledge graph and pages manifest, then explore the relevant source files.

Now let me explore the key source files for session lifecycle management.

Now let me look at the example files and test files for more usage patterns.

Now let me look at the tests for additional session lifecycle details:

Now let me check the health check example and usage tracking example:

I now have a thorough understanding of the session lifecycle. Let me write the guide.

# Managing Session Lifecycle

Create, reuse, and clean up AI sessions to build single-shot prompts, multi-turn conversations, and parallel workflows with the pi-sidecar Python client.

## Prerequisites

- pi-sidecar server running (see [Getting Started with pi-sidecar](quickstart.html))
- `pi-sidecar-client` Python package installed
- Python 3.10+

## Quick Example

The fastest way to make an AI call with automatic session cleanup:

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
    else:
        print(f"Error: {result.error}")

asyncio.run(main())
```

`call_ai_once` creates a session, sends the prompt, deletes the session, and returns the result — all in one call. No cleanup needed.

## Choosing Between `call_ai_once` and `call_ai`

| | `call_ai_once` | `call_ai` |
|---|---|---|
| **Use case** | Single-shot prompts | Multi-turn conversations |
| **Session cleanup** | Automatic | You must delete manually |
| **Returns `session_id`** | `None` (cleared after cleanup) | Session ID for reuse |
| **Conversation context** | Not preserved | Preserved across prompts |
| **When to use** | Independent questions, parallel tasks | Follow-up questions, iterative refinement |

> **Tip:** Start with `call_ai_once`. Switch to `call_ai` only when you need conversation continuity.

## Single-Shot Calls

Use `call_ai_once` when each prompt is independent and you don't need follow-up questions:

```python
from pi_sidecar_client import call_ai_once

result = await call_ai_once(
    "Summarize the key features of Rust.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="Answer in exactly three bullet points.",
)
```

The session is created and destroyed behind the scenes. If session deletion fails, `result.session_id` is preserved so you can retry cleanup.

## Multi-Turn Conversations

For conversations where context matters, use `call_ai` and pass the `session_id` between calls:

```python
from pi_sidecar_client import call_ai, get_sidecar_client

session_id = None
try:
    # First message — creates a new session
    result = await call_ai(
        "I'm building a REST API in Python. What framework should I use?",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        system_prompt="You are a senior Python developer. Be concise.",
    )
    session_id = result.session_id

    if not result.success:
        print(f"Error: {result.error}")
    else:
        print(result.text)

        # Follow-up — reuses the same session (conversation context preserved)
        result = await call_ai(
            "Show me a minimal example with that framework.",
            ai_provider="gemini",
            ai_model="gemini-2.5-flash",
            session_id=session_id,
        )
        session_id = result.session_id  # Update in case of cleanup failure
        print(result.text)
finally:
    # Always clean up when done
    if session_id:
        client = get_sidecar_client()
        await client.delete_session(session_id)
```

Key steps:

1. **First call** — omit `session_id` to create a new session automatically.
2. **Capture `session_id`** — grab it from `result.session_id` immediately (before checking success).
3. **Follow-up calls** — pass `session_id` to `call_ai` to continue the conversation.
4. **Clean up** — delete the session in a `finally` block.

> **Warning:** Always delete sessions when done. Sessions that are not deleted consume server memory until the sidecar's automatic stale cleanup removes them (after 1 hour of inactivity).

## Session Cleanup Patterns

### Using `try/finally` (recommended)

Wrap your session work in `try/finally` to guarantee cleanup:

```python
session_id = None
try:
    result = await call_ai("Hello", ai_provider="gemini", ai_model="gemini-2.5-flash")
    session_id = result.session_id
    # ... more prompts using session_id ...
finally:
    if session_id:
        client = get_sidecar_client()
        try:
            await client.delete_session(session_id)
        except Exception:
            print(f"Warning: failed to clean up session {session_id}")
```

### Automatic cleanup on error

When `call_ai` creates a new session and the prompt fails with an exception, it automatically deletes the session it created. You only need manual cleanup for sessions you explicitly reuse.

```python
# If this fails, the session is auto-cleaned
result = await call_ai("Hello", ai_provider="gemini", ai_model="gemini-2.5-flash")

# If THIS fails, you must clean up session_id yourself
result2 = await call_ai("Follow up", session_id=result.session_id)
```

### Closing the client

When your application shuts down, close the HTTP client to release connections:

```python
client = get_sidecar_client()
await client.close()
```

## Aborting an In-Progress Prompt

If a prompt is taking too long, you can abort it from another task:

```python
client = get_sidecar_client()

# Start a long-running prompt in one task
async def long_prompt(sid):
    return await client.prompt(sid, "Analyze this large codebase...")

# Abort from another task after a timeout
async def timeout_guard(sid, seconds):
    await asyncio.sleep(seconds)
    await client.abort(sid)
```

> **Note:** A session can only handle one prompt at a time. Sending a second prompt to a busy session returns an error. Use `abort` first if you need to cancel and retry.

## Advanced Usage

### Using the `SidecarClient` directly

For full control, use `SidecarClient` methods instead of the convenience functions:

```python
from pi_sidecar_client import SidecarClient

client = SidecarClient(base_url="http://127.0.0.1:9100")

# Create a session
session_id = await client.create_session(
    provider="gemini",
    model="gemini-2.5-flash",
    system_prompt="You are a code reviewer.",
    cwd="/path/to/project",
)

# Send prompts
result = await client.prompt(session_id, "Review this function for bugs.")
print(result.text)

# Delete when done
await client.delete_session(session_id)
await client.close()
```

### Setting a prompt timeout

Both `call_ai` and `call_ai_once` accept `ai_call_timeout` in **minutes**:

```python
result = await call_ai_once(
    "Analyze this large dataset...",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    ai_call_timeout=5,  # 5-minute timeout
)
```

For fine-grained control, `client.prompt()` accepts `timeout` in **seconds**:

```python
result = await client.prompt(session_id, "Quick question", timeout=30.0)
```

### Resource loading via `cwd`

The `cwd` parameter controls which project resources the AI session loads. The Pi SDK looks for skills, prompts, extensions, and themes in `{cwd}/.pi/` and loads `AGENTS.md` from `{cwd}/`.

```python
result = await call_ai_once(
    "Explain this project's architecture.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    cwd="/home/user/my-project",  # Loads .pi/ resources from this directory
)
```

When `cwd` is omitted, it defaults to the system temp directory.

### Configuring tools on a session

Override or extend the default tool set (`read`, `grep`, `find`, `ls`, `bash`) when creating a session:

```python
# Restrict to read-only tools
result = await call_ai_once(
    "Summarize this file.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    tools=["read", "grep"],
)
```

See [Configuring Built-in and Custom Tools](configuring-tools.html) for custom tool setup and HTTP-backed tools.

### Stale session cleanup

The sidecar automatically cleans up sessions that have been idle for over 1 hour. This runs every 10 minutes. Sessions with an active prompt (in-flight) are never cleaned up.

You should still clean up sessions explicitly — don't rely on stale cleanup for normal operation.

## Troubleshooting

| Problem | Cause | Solution |
|---|---|---|
| `Session <id> not found` | Session was deleted or cleaned up by stale cleanup | Create a new session — don't cache session IDs across long idle periods |
| `Session <id> is busy` | You sent a second prompt while one is still running | Wait for the first prompt to complete, or `abort` it first |
| `call_ai_once` returns a `session_id` | Session deletion failed after the prompt | Retry deletion with `client.delete_session(result.session_id)` |
| `Sidecar unavailable` | Sidecar is not running or not yet ready | Run `check_sidecar_available()` to check status; wait for model discovery to complete |
| Timeout during prompt | The AI call exceeded the default 600s timeout | Set `ai_call_timeout` (minutes) or use `client.prompt(..., timeout=seconds)` |

See [Sending Prompts to AI Models](sending-prompts.html) for details on prompt formatting and response handling. See [Tracking Token Usage and Costs](tracking-usage.html) for recording usage after each call.

## Related Pages

- [Sending Prompts to AI Models](sending-prompts.html)
- [Getting Started with pi-sidecar](quickstart.html)
- [Configuring Built-in and Custom Tools](configuring-tools.html)
- [Tracking Token Usage and Costs](tracking-usage.html)
- [REST API Reference](rest-api-reference.html)
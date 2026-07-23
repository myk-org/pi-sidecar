# Managing AI Conversations

Maintain conversational context across multiple turns or run isolated, single-shot tasks without managing state. Using sessions allows the AI to remember previous messages while keeping separate tasks from interfering with each other.

## Prerequisites
- A running sidecar server. See [Quickstart](quickstart.html) if you haven't started one yet.
- The `pi_sidecar_client` Python package installed.

## Quick Example
For simple, one-off tasks where you don't need the AI to remember previous messages, use `call_ai_once`. It automatically creates a session, runs your prompt, and cleans up after itself.

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    result = await call_ai_once(
        "What are the three laws of robotics?",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        system_prompt="You are a helpful assistant. Be concise."
    )
    
    if result.success:
        print(result.text)

if __name__ == "__main__":
    asyncio.run(main())
```

## Step-by-Step: Multi-Turn Conversations
When you need the AI to answer follow-up questions or iterate on a task, you must manage the session manually using `call_ai` and retain the `session_id`.

### 1. Start the Conversation
Call `call_ai` without passing a `session_id`. This creates a new session.

```python
from pi_sidecar_client import call_ai, get_sidecar_client

# First message — creates a new session
result1 = await call_ai(
    "I'm building a REST API in Python. What framework should I use?",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="You are a senior developer. Be concise.",
)

# Save the session ID to use for follow-ups
session_id = result1.session_id
```

### 2. Send Follow-Up Messages
Pass the `session_id` from the previous result into your next call. The AI will remember the context.

```python
# Follow-up — reuses the same session
result2 = await call_ai(
    "Show me a minimal example with that framework.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    session_id=session_id,  # Context is preserved
)
print(result2.text)
```

### 3. Clean Up
Conversations consume resources on the sidecar. Always delete the session when you are finished.

```python
client = get_sidecar_client()
if session_id:
    await client.delete_session(session_id)
```

> **Tip:** Always wrap your multi-turn logic in a `try...finally` block to guarantee the session is deleted even if an error occurs.

## Advanced Usage

### Context Isolation with Directories
By default, the sidecar loads user-level skills, configurations, and extensions from a global agent directory, and project-level resources (like `.pi/` folders and `AGENTS.md`) from the system's temporary directory. You can override these to strictly isolate context for different tasks.

- **`cwd`**: Sets the project root where the AI discovers project-specific skills, prompts, extensions, and themes (`{cwd}/.pi/`).
- **`agent_dir`**: Sets the global directory for user-level resources (e.g., `~/.pi/agent/`).

```python
result = await call_ai_once(
    "Review my code for security issues.",
    ai_provider="cursor",
    ai_model="cursor:claude-3.5-sonnet",
    cwd="/path/to/my/project",          # Project-level context
    agent_dir="/tmp/isolated-agent-dir" # User-level context
)
```

### Setting a Timeout
Long-running prompts might need more time. You can adjust the timeout (in minutes) via the `ai_call_timeout` parameter:

```python
result = await call_ai_once(
    "Write a very long and detailed report...",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    ai_call_timeout=5, # Wait up to 5 minutes
)
```

## Troubleshooting

- **Session not found**: If you receive a 404 error when passing a `session_id`, the session may have been deleted, or the sidecar server may have restarted (sessions are stored in memory and do not survive restarts).
- **Stuck or hanging prompts**: If a prompt is running indefinitely, you can manually abort it using `await get_sidecar_client().abort(session_id)`.
- **Empty text in response**: If `result.success` is true but `result.text` is empty, check `result.error`. See [Python Client Reference](python-client.html) for more details on error handling.

## Related Pages

- [Quickstart](quickstart.html)
- [REST API Endpoints](rest-api.html)
- [Python Client Reference](python-client.html)
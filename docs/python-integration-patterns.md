# Python Integration Patterns

## Multi-Turn Conversations
Maintain conversation history and agent context across multiple prompts by reusing a `session_id`.

```python
import asyncio
from pi_sidecar_client import call_ai, get_sidecar_client

async def chat():
    session_id = None
    try:
        # First prompt: omit session_id to create a new session
        res1 = await call_ai(
            "I'm building a REST API. What Python framework should I use?",
            ai_provider="gemini",
            ai_model="gemini-2.5-flash",
            system_prompt="You are a senior developer. Be concise."
        )
        session_id = res1.session_id
        print(f"AI: {res1.text}\n")

        # Second prompt: pass the session_id to continue the conversation
        res2 = await call_ai(
            "Show me a minimal example using that framework.",
            ai_provider="gemini",
            ai_model="gemini-2.5-flash",
            session_id=session_id
        )
        print(f"AI: {res2.text}")
        
    finally:
        # Always clean up the stateful session when finished
        client = get_sidecar_client()
        if session_id:
            await client.delete_session(session_id)
        await client.close()

if __name__ == "__main__":
    asyncio.run(chat())
```

Use `call_ai()` instead of `call_ai_once()` when you need context to persist between prompts. See [Managing AI Conversations](managing-conversations.html) for details on context isolation and agent directories.

* Always wrap multi-turn logic in a `try...finally` block to ensure the session is destroyed.
* The `ai_provider` and `ai_model` parameters must be provided on every turn.

## Parallel Execution with Limits
Run multiple AI calls simultaneously while strictly capping the number of concurrent requests to avoid rate limits or overwhelming the sidecar.

```python
import asyncio
from pi_sidecar_client import call_ai_once, run_parallel_with_limit

async def analyze_topic(topic: str) -> str:
    """Analyze a single topic in isolation."""
    result = await call_ai_once(
        f"Explain {topic} in one sentence.",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash"
    )
    return result.text if result.success else f"Error: {result.text}"

async def batch_process():
    topics = ["Kubernetes", "WebAssembly", "GraphQL", "Rust"]

    # Execute all tasks with a maximum of 2 running concurrently
    results = await run_parallel_with_limit(
        [analyze_topic(t) for t in topics],
        max_concurrency=2,
    )

    for topic, answer in zip(topics, results):
        if isinstance(answer, Exception):
            print(f"{topic} failed: {answer}")
        else:
            print(f"{topic}: {answer}")

if __name__ == "__main__":
    asyncio.run(batch_process())
```

The `run_parallel_with_limit` helper manages an `asyncio.Semaphore` internally. It returns results in the exact same order as the input tasks and traps exceptions so a single failure doesn't crash the entire batch.

> **Tip:** If you are delegating parallel tasks to autonomous agents rather than raw LLM prompts, consider using the `subagent` tool instead. See [Orchestrating Subagents](orchestrating-subagents.html).

## Pre-flight Health Check
Verify the sidecar server is running and fully initialized before dispatching traffic.

```python
import asyncio
from pi_sidecar_client import check_sidecar_available

async def ensure_ready():
    available, message = await check_sidecar_available()
    
    if available:
        print(f"✅ Ready: {message}")
    else:
        print(f"❌ Unavailable: {message}")
        raise SystemExit(1)

if __name__ == "__main__":
    asyncio.run(ensure_ready())
```

`check_sidecar_available()` attempts to connect to the sidecar and fetches the `GET /health` endpoint. It safely handles connection resets and timeouts, distinguishing between a missing server and one that is still starting up. 

## Token Usage & Cost Tracking
Intercept all AI responses globally to record token usage and cost metrics to your own database or analytics system.

```python
import asyncio
from pi_sidecar_client import AIResult, call_ai_once, set_usage_recorder

# Set up your custom storage
metrics_db = []

async def my_usage_recorder(
    *,
    request_id: str,
    result: AIResult,
    call_type: str,
    prompt_chars: int,
    ai_provider: str,
    ai_model: str,
) -> None:
    """Global callback executed when result.record_usage() is called."""
    if not result.usage:
        return
        
    metrics_db.append({
        "request_id": request_id,
        "model": f"{ai_provider}/{ai_model}",
        "in": result.usage.input_tokens,
        "out": result.usage.output_tokens,
        "cost": result.usage.cost_usd,
    })

async def track_prompt():
    # 1. Register the handler once globally
    set_usage_recorder(my_usage_recorder)

    # 2. Make the AI call
    res = await call_ai_once(
        "Write a python loop.",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash"
    )
    
    # 3. Fire the tracking callback
    await res.record_usage(
        request_id="req-123",
        call_type="code_gen",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash"
    )
    
    print(f"Tokens used: {metrics_db[-1]['in']} + {metrics_db[-1]['out']}")

if __name__ == "__main__":
    asyncio.run(track_prompt())
```

By separating the global callback registration (`set_usage_recorder`) from the invocation (`record_usage`), you can keep your data storage dependencies isolated from your application's prompting logic. See the [Python Client Reference](python-client.html) for exactly what data is available on the `AIResult` object.

## Related Pages

- [Python Client Reference](python-client.html)
- [Quickstart](quickstart.html)
- [Managing AI Conversations](managing-conversations.html)
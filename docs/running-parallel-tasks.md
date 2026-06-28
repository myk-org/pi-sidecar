# Running Parallel AI Calls

Run multiple AI prompts at the same time while controlling how many execute concurrently, so you can process batches faster without overwhelming the sidecar with too many simultaneous requests.

## Prerequisites

- A running pi-sidecar server (see [Getting Started with pi-sidecar](quickstart.html))
- The `pi-sidecar-client` Python package installed
- Python 3.10+

## Quick Example

```python
import asyncio
from pi_sidecar_client import call_ai_once, run_parallel_with_limit


async def summarize(topic: str) -> str:
    result = await call_ai_once(f"In one sentence, what is {topic}?")
    return f"{topic}: {result.text}" if result.success else f"{topic}: ERROR"


async def main():
    topics = ["Python", "Kubernetes", "WebAssembly", "GraphQL", "Rust"]
    results = await run_parallel_with_limit(
        [summarize(topic) for topic in topics],
        max_concurrency=3,
    )
    for r in results:
        print(r)


asyncio.run(main())
```

This sends 5 prompts to the sidecar but never more than 3 at a time. Each prompt gets its own session (created and cleaned up automatically by `call_ai_once`).

## Step-by-Step

### 1. Define your per-item async function

Write an `async` function that takes a single input and returns a result. Use `call_ai_once` for single-shot calls — it handles session creation and cleanup automatically.

```python
async def analyze(item: str) -> str:
    result = await call_ai_once(
        f"In one sentence, what is {item}?",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        system_prompt="Answer in exactly one sentence.",
    )
    return f"{item}: {result.text}" if result.success else f"{item}: ERROR - {result.text}"
```

### 2. Build a list of coroutines

Create all the coroutines up front by calling your function for each input. Don't `await` them yet — pass them as a list to `run_parallel_with_limit`.

```python
items = ["Python", "Kubernetes", "WebAssembly", "GraphQL", "Rust"]
tasks = [analyze(item) for item in items]
```

### 3. Run with a concurrency limit

Pass the list of coroutines and a `max_concurrency` value. The function returns results in the same order as the input list.

```python
results = await run_parallel_with_limit(tasks, max_concurrency=3)
```

### 4. Handle errors in results

When a coroutine raises an exception, `run_parallel_with_limit` captures it instead of aborting the entire batch. Check each result for exceptions:

```python
for result in results:
    if isinstance(result, Exception):
        print(f"Failed: {result}")
    else:
        print(result)
```

> **Note:** Exceptions are returned in the results list, not raised. This means one failing task won't prevent the others from completing.

## Choosing max_concurrency

| Value | When to use |
|-------|-------------|
| `1` | Sequential execution — useful for debugging or rate-limited APIs |
| `3–5` | Safe default for most workloads; keeps sidecar responsive |
| `5–10` | Higher throughput when the sidecar and AI backend can handle it |
| `> 10` | Only if you've confirmed the backend supports this level of concurrency |

Each concurrent call creates its own session on the sidecar. Higher concurrency means more open sessions and more memory usage on the server side.

> **Tip:** Start with `max_concurrency=3` and increase it if your prompts are completing quickly with no errors. If you start seeing timeouts or rate-limit errors, reduce it.

## Advanced Usage

### Combining with usage tracking

You can record token usage for each parallel call by calling `record_usage` inside your per-item function. See [Tracking Token Usage and Costs](tracking-usage.html) for full details.

```python
from pi_sidecar_client import call_ai_once, run_parallel_with_limit, set_usage_recorder


async def my_recorder(*, request_id, result, call_type, **kwargs):
    if result.usage:
        print(f"  [{request_id}] {result.usage.input_tokens}in / {result.usage.output_tokens}out")


set_usage_recorder(my_recorder)


async def analyze_with_tracking(item: str) -> str:
    result = await call_ai_once(
        f"Summarize {item} in one sentence.",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
    )
    await result.record_usage(
        request_id=f"batch-{item}",
        call_type="parallel-analysis",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
    )
    return f"{item}: {result.text}"


async def main():
    items = ["Python", "Rust", "Go"]
    results = await run_parallel_with_limit(
        [analyze_with_tracking(item) for item in items],
        max_concurrency=3,
    )
    for r in results:
        if not isinstance(r, Exception):
            print(r)
```

### Using session reuse for multi-turn parallel conversations

If each parallel task needs multiple turns of conversation, use `call_ai` with explicit session management instead of `call_ai_once`. See [Managing Session Lifecycle](managing-sessions.html) for details on session reuse.

```python
from pi_sidecar_client import call_ai, get_sidecar_client, run_parallel_with_limit


async def deep_analyze(item: str) -> str:
    # First turn — creates a session
    result = await call_ai(
        f"What is {item}?",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
    )
    if not result.success:
        return f"{item}: ERROR - {result.text}"

    # Second turn — reuses the session
    result = await call_ai(
        "Now list its top 3 advantages.",
        session_id=result.session_id,
    )

    # Clean up the session
    if result.session_id:
        client = get_sidecar_client()
        await client.delete_session(result.session_id)

    return f"{item}: {result.text}"


async def main():
    items = ["Python", "Rust", "Go"]
    results = await run_parallel_with_limit(
        [deep_analyze(item) for item in items],
        max_concurrency=2,
    )
    for r in results:
        if not isinstance(r, Exception):
            print(r)
```

> **Warning:** Each session holds state and memory on the sidecar. Always delete sessions when you're done, especially in parallel workloads where many sessions may be open simultaneously.

### Specifying tools for parallel tasks

Pass `tools` or `custom_tools` to control which tools are available during each parallel call. See [Configuring Built-in and Custom Tools](configuring-tools.html).

```python
result = await call_ai_once(
    "Read the README.md and summarize it.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    tools=["read", "find"],  # Only allow file reading, not bash
    cwd="/path/to/project",
)
```

## Troubleshooting

**`ValueError: max_concurrency must be >= 1`**
The `max_concurrency` parameter must be a positive integer. Pass at least `1`.

**Some results are exceptions**
`run_parallel_with_limit` captures exceptions instead of raising them. Check each result with `isinstance(result, Exception)` and log or retry as needed.

**Timeouts on large batches**
If prompts are timing out, reduce `max_concurrency` to lower the load on the sidecar and AI backend. You can also set `ai_call_timeout` (in minutes) on individual `call_ai_once` calls to allow more time for complex prompts.

**Sidecar becomes unresponsive under load**
Check that the sidecar is running and healthy before starting a batch. See [Python Client Recipes](recipes-python-client.html) for a health-check pattern you can run before launching parallel work.

## Related Pages

- [Tracking Token Usage and Costs](tracking-usage.html)
- [Managing Session Lifecycle](managing-sessions.html)
- [Sending Prompts to AI Models](sending-prompts.html)
- [Python Client Recipes](recipes-python-client.html)
- [Python Client API Reference](python-client-reference.html)
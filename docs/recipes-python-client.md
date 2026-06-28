# Python Client Recipes

Copy-paste patterns for common Python workflows using `pi-sidecar-client`. Each recipe is self-contained — import it, adjust the values, and run.

> **Note:** All recipes assume a running sidecar at `http://127.0.0.1:9100`. See [Getting Started with pi-sidecar](quickstart.html) for setup instructions.

---

## Health Check Before Sending Prompts

Verify the sidecar is reachable and ready before making AI calls.

```python
import asyncio
from pi_sidecar_client import check_sidecar_available

async def main():
    available, message = await check_sidecar_available()
    if available:
        print(f"✅ {message}")
    else:
        print(f"❌ {message}")
        # "starting" means model discovery is still running — retry shortly
        # "unavailable" means the sidecar process isn't reachable

asyncio.run(main())
```

`check_sidecar_available()` returns a `(bool, str)` tuple. It distinguishes three states: **ready** (`True`), **starting** (model discovery in progress), and **unavailable** (connection refused or HTTP error). Use it in startup scripts and CI pipelines to gate work on sidecar readiness.

---

## Wait for Sidecar Readiness with Retry

Block until the sidecar finishes model discovery, with a timeout.

```python
import asyncio
from pi_sidecar_client import check_sidecar_available

async def wait_for_sidecar(timeout_seconds: int = 120, poll_interval: float = 2.0) -> None:
    """Block until sidecar is ready or timeout is reached."""
    elapsed = 0.0
    while elapsed < timeout_seconds:
        available, message = await check_sidecar_available()
        if available:
            print(f"Sidecar ready after {elapsed:.0f}s")
            return
        print(f"Waiting... ({message})")
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
    raise TimeoutError(f"Sidecar not ready after {timeout_seconds}s")

asyncio.run(wait_for_sidecar())
```

Model discovery runs on startup and can take 30+ seconds per ACPX agent. This pattern is useful when your script starts immediately after launching the sidecar process.

---

## Single-Shot Prompt with Automatic Cleanup

Send one prompt and let the client handle session lifecycle.

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    result = await call_ai_once(
        "Summarize the key differences between REST and GraphQL.",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        system_prompt="You are a senior software architect. Be concise.",
    )
    if result.success:
        print(result.text)
        if result.usage:
            print(f"\nTokens: in={result.usage.input_tokens} out={result.usage.output_tokens}")
    else:
        print(f"Error: {result.error}")

asyncio.run(main())
```

`call_ai_once` creates a session, sends the prompt, and deletes the session — all in one call. Use it for stateless, fire-and-forget prompts. For conversations, see [Sending Prompts to AI Models](sending-prompts.html).

---

## Error Handling with Partial Output

Handle both hard failures and AI-level errors that may include partial text.

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    result = await call_ai_once(
        "Analyze this codebase for security vulnerabilities.",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        system_prompt="You are a security auditor.",
    )

    if result.success:
        print(result.text)
        return

    # result.error contains the error message
    # result.text may contain partial output (e.g., AI was rate-limited mid-response)
    print(f"Call failed: {result.error}")
    if result.text and result.text != result.error:
        print(f"Partial output ({len(result.text)} chars): {result.text[:200]}...")

    # If cleanup failed, session_id is preserved for manual cleanup
    if result.session_id:
        print(f"Leaked session: {result.session_id} — delete manually or let stale cleanup handle it")

asyncio.run(main())
```

The client surfaces errors from three layers: HTTP transport errors, sidecar validation errors, and AI model errors (e.g., rate limits). When `success` is `False`, always check `result.error` for the reason and `result.text` for any partial output the model produced before failing.

> **Tip:** The sidecar automatically cleans up stale sessions after 1 hour of inactivity, so leaked sessions won't persist forever.

---

## Resource Loading via `cwd`

Point `cwd` at a project directory to load skills, prompts, extensions, and `AGENTS.md` automatically.

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    result = await call_ai_once(
        "Review the project structure and suggest improvements.",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        system_prompt="You are a code reviewer.",
        cwd="/home/user/my-project",  # Pi SDK loads {cwd}/.pi/ and {cwd}/AGENTS.md
    )
    if result.success:
        print(result.text)
    else:
        print(f"Error: {result.error}")

asyncio.run(main())
```

The Pi SDK's `DefaultResourceLoader` discovers project-level resources from `{cwd}/.pi/` — including skills, prompts, extensions, and themes — and loads `AGENTS.md` from the `{cwd}/` root. Set `cwd` to the root of the project you want the AI to understand.

- If `cwd` is omitted, it defaults to the system temp directory (`tempfile.gettempdir()`)
- The `agent_dir` parameter provides a separate path for user-level (global) resources — defaults to `/tmp/pi-sidecar-agent` when omitted

> **Note:** `agent_dir` must be an absolute path pointing to an existing directory. In `DEV_MODE`, it is validated for type only and then discarded for security.

---

## Multi-Turn Conversation with Session Cleanup

Maintain conversation context across multiple prompts by reusing a session.

```python
import asyncio
from pi_sidecar_client import call_ai, get_sidecar_client

async def main():
    session_id = None
    try:
        # First turn — creates a new session
        result = await call_ai(
            "What are the pros and cons of microservices?",
            ai_provider="gemini",
            ai_model="gemini-2.5-flash",
            system_prompt="You are a senior architect. Be concise.",
        )
        session_id = result.session_id
        if not result.success:
            print(f"Error: {result.error}")
            return
        print(f"Turn 1: {result.text}\n")

        # Second turn — reuses the session (conversation context preserved)
        result = await call_ai(
            "How does that change if my team is only 3 engineers?",
            ai_provider="gemini",
            ai_model="gemini-2.5-flash",
            session_id=session_id,
        )
        session_id = result.session_id
        if not result.success:
            print(f"Error: {result.error}")
            return
        print(f"Turn 2: {result.text}")
    finally:
        # Always clean up the session
        if session_id:
            client = get_sidecar_client()
            try:
                await client.delete_session(session_id)
            except Exception as e:
                print(f"Cleanup failed: {e}")
            await client.close()

asyncio.run(main())
```

`call_ai` does **not** delete the session after prompting — the caller owns the lifecycle. Always use a `try/finally` block to ensure cleanup. For full lifecycle details, see [Managing Session Lifecycle](managing-sessions.html).

> **Warning:** Pass `session_id` on follow-up turns, but you don't need to repeat `system_prompt` or `cwd` — those are bound to the session at creation time.

---

## Restricting Available Tools

Override the default tool set (`read`, `grep`, `find`, `ls`, `bash`) at session creation.

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    # Only allow read and grep — no bash execution
    result = await call_ai_once(
        "Find all TODO comments in the codebase.",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        system_prompt="You are a code analyst.",
        cwd="/home/user/my-project",
        tools=["read", "grep", "find"],
    )
    if result.success:
        print(result.text)
    else:
        print(f"Error: {result.error}")

asyncio.run(main())
```

The `tools` parameter replaces the default set entirely. If omitted, all five default tools are enabled. For adding custom HTTP-backed tools, see [Configuring Built-in and Custom Tools](configuring-tools.html).

---

## Setting a Custom Timeout

Override the default 600-second timeout for long-running prompts.

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    result = await call_ai_once(
        "Perform a comprehensive security audit of this codebase.",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        system_prompt="You are a security auditor. Be thorough.",
        cwd="/home/user/my-project",
        ai_call_timeout=15,  # 15 minutes (value is in minutes)
    )
    if result.success:
        print(result.text)
    else:
        print(f"Error: {result.error}")

asyncio.run(main())
```

`ai_call_timeout` is specified in **minutes** and is converted to seconds internally. The default httpx client timeout is 600 seconds (10 minutes). Use higher values for prompts that trigger extensive tool use.

---

## Using Provider Name Aliases

Use friendly provider names — the client maps them automatically.

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    # These friendly names are mapped automatically:
    #   "gemini"  → "google"
    #   "cursor"  → "acpx-cursor" (model gets "cursor:" prefix)
    #   "claude"  → "google-vertex-claude"

    result = await call_ai_once(
        "Explain Python decorators.",
        ai_provider="claude",                       # maps to "google-vertex-claude"
        ai_model="claude-sonnet-4-20250514",
        system_prompt="You are a Python instructor.",
    )
    if result.success:
        print(result.text)

asyncio.run(main())
```

You can use either the friendly name (`gemini`, `cursor`, `claude`) or the sidecar name (`google`, `acpx-cursor`, `google-vertex-claude`). See [Discovering and Selecting Models](discovering-models.html) for the full provider list.

---

## Connecting to a Non-Default Sidecar URL

Connect to a sidecar running on a custom port or host.

```python
import asyncio
from pi_sidecar_client import SidecarClient, AIResult

async def main():
    client = SidecarClient(base_url="http://127.0.0.1:9200")
    try:
        health = await client.health()
        print(f"Status: {health['status']}")

        session_id = await client.create_session(
            provider="gemini",
            model="gemini-2.5-flash",
            system_prompt="You are a helpful assistant.",
            cwd="/tmp",
        )
        result = await client.prompt(session_id, "What is 2 + 2?")
        print(f"Answer: {result.text}")

        await client.delete_session(session_id)
    finally:
        await client.close()

asyncio.run(main())
```

The convenience functions (`call_ai`, `call_ai_once`, `list_models`) use a singleton client bound to `SIDECAR_URL` (default `http://127.0.0.1:9100`). For a different address, either set the `SIDECAR_URL` environment variable or instantiate `SidecarClient` directly.

> **Tip:** Set `SIDECAR_URL` in your environment for convenience functions: `export SIDECAR_URL=http://127.0.0.1:9200`

---

## Listing and Filtering Available Models

Discover available models, optionally filtering by provider.

```python
import asyncio
from pi_sidecar_client import list_models

async def main():
    # All models
    all_models = await list_models()
    print(f"Total: {len(all_models)} models\n")

    # Filter by provider (uses friendly name mapping)
    gemini_models = await list_models(provider="gemini")
    for m in gemini_models:
        print(f"  {m['id']}: {m['name']}")

asyncio.run(main())
```

`list_models()` calls `GET /models` on the sidecar. The optional `provider` filter accepts friendly names (`gemini`, `cursor`, `claude`). For refreshing models and understanding ACPX discovery, see [Discovering and Selecting Models](discovering-models.html).

---

## Parallel AI Calls with Concurrency Limit

Run multiple prompts concurrently while capping simultaneous requests.

```python
import asyncio
from pi_sidecar_client import call_ai_once, run_parallel_with_limit

async def summarize(topic: str) -> str:
    result = await call_ai_once(
        f"In one sentence, explain {topic}.",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
        system_prompt="Be concise.",
    )
    return f"{topic}: {result.text}" if result.success else f"{topic}: ERROR - {result.error}"

async def main():
    topics = ["Rust", "WebAssembly", "GraphQL", "Kubernetes", "Terraform"]

    results = await run_parallel_with_limit(
        [summarize(t) for t in topics],
        max_concurrency=3,
    )

    for r in results:
        if isinstance(r, Exception):
            print(f"Failed: {r}")
        else:
            print(r)

asyncio.run(main())
```

`run_parallel_with_limit` uses an `asyncio.Semaphore` to cap concurrency. Exceptions from individual tasks are returned as values (not raised), so one failure doesn't cancel the batch. For detailed patterns, see [Running Parallel AI Calls](running-parallel-tasks.html).

---

## Recording Token Usage

Register a callback to capture token counts, costs, and timing.

```python
import asyncio
from pi_sidecar_client import AIResult, call_ai_once, set_usage_recorder

usage_log: list[dict] = []

async def recorder(
    *,
    request_id: str,
    result: AIResult,
    call_type: str,
    prompt_chars: int,
    ai_provider: str,
    ai_model: str,
) -> None:
    usage_log.append({
        "request_id": request_id,
        "call_type": call_type,
        "provider": ai_provider,
        "model": ai_model,
        "input_tokens": result.usage.input_tokens if result.usage else 0,
        "output_tokens": result.usage.output_tokens if result.usage else 0,
        "cost_usd": result.usage.cost_usd if result.usage else None,
    })

async def main():
    set_usage_recorder(recorder)

    result = await call_ai_once(
        "What is the speed of light?",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
    )

    # Usage is NOT recorded automatically — you must call record_usage explicitly
    await result.record_usage(
        request_id="req-001",
        call_type="question",
        ai_provider="gemini",
        ai_model="gemini-2.5-flash",
    )

    print(f"Answer: {result.text}")
    print(f"Usage: {usage_log}")

asyncio.run(main())
```

Call `set_usage_recorder` once at startup. The callback can be sync or async — the client detects and awaits coroutines automatically. `record_usage()` is best-effort and never raises, even if the callback throws. See [Tracking Token Usage and Costs](tracking-usage.html) for advanced patterns.

---

## Controlling Log Verbosity

Set the client's log level via environment variable.

```bash
# Show debug-level logs from the client (default: INFO)
export PI_SIDECAR_LOG_LEVEL=DEBUG
python my_script.py

# Suppress everything except errors
export PI_SIDECAR_LOG_LEVEL=ERROR
python my_script.py
```

The client logs to the module logger using the level set in `PI_SIDECAR_LOG_LEVEL`. The same variable controls logging for both the sidecar server and the Python client. See [Configuration and Environment Variables](configuration-reference.html) for all available settings.

---

## Graceful Client Shutdown

Close the HTTP client to release connections when your application exits.

```python
import asyncio
from pi_sidecar_client import get_sidecar_client, call_ai_once

async def main():
    client = get_sidecar_client()
    try:
        result = await call_ai_once(
            "Hello!",
            ai_provider="gemini",
            ai_model="gemini-2.5-flash",
        )
        print(result.text)
    finally:
        await client.close()

asyncio.run(main())
```

The singleton client (`get_sidecar_client()`) keeps an `httpx.AsyncClient` open with a 600-second timeout. Call `close()` when your application is shutting down to release the underlying connection pool. After closing, the next call to `get_sidecar_client()` creates a fresh client automatically.

## Related Pages

- [REST API Recipes](recipes-rest-api.html)
- [Sending Prompts to AI Models](sending-prompts.html)
- [Managing Session Lifecycle](managing-sessions.html)
- [Discovering and Selecting Models](discovering-models.html)
- [Python Client API Reference](python-client-reference.html)
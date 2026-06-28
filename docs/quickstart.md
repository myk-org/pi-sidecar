# Getting Started with pi-sidecar

Get a local AI coding assistant running and make your first AI call from Python — install the sidecar server, start it, and send a prompt in three steps.

## Prerequisites

- **Node.js ≥ 22.19** — the sidecar server is a Node.js application
- **Python ≥ 3.10** — for the Python client library
- **An AI provider API key** — e.g., `GOOGLE_API_KEY` for Gemini or `ANTHROPIC_API_KEY` for Claude

## Quick Example

```bash
# 1. Install and start the sidecar server
npm install @myk-org/pi-sidecar
npm run build
node dist/server.js
```

```bash
# 2. In a new terminal, install the Python client
pip install pi-sidecar-client
```

```python
# 3. Send your first prompt
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

That's it. The rest of this page walks through each step in detail.

---

## Step 1: Install the Sidecar Server

```bash
npm install @myk-org/pi-sidecar
npm run build
```

This installs the server and its dependencies (including the Pi coding agent SDK and provider extensions), then compiles the TypeScript source.

## Step 2: Set Up Your API Key

Export the credentials for your chosen AI provider before starting the server:

| Provider | Environment Variable |
|----------|---------------------|
| Gemini | `GOOGLE_API_KEY` |
| Claude (API key) | `ANTHROPIC_API_KEY` |
| Claude (Vertex AI) | `GOOGLE_APPLICATION_CREDENTIALS` |

```bash
export GOOGLE_API_KEY="your-api-key-here"
```

> **Tip:** For a full list of providers and their configuration, see [Configuration and Environment Variables](configuration-reference.html).

## Step 3: Start the Server

```bash
node dist/server.js
```

You'll see output like:

```
[sidecar] Pi SDK sidecar listening on http://127.0.0.1:9100
```

The server performs model discovery on startup. The `/health` endpoint returns `503` until discovery finishes, then `200` when ready.

> **Note:** The sidecar binds to `127.0.0.1` (localhost only) by default. There is no authentication — security relies on the network boundary.

## Step 4: Install the Python Client

In a separate terminal:

```bash
pip install pi-sidecar-client
```

## Step 5: Verify the Connection

```python
import asyncio
from pi_sidecar_client import check_sidecar_available

async def main():
    available, message = await check_sidecar_available()
    if available:
        print(f"✅ {message}")
    else:
        print(f"❌ {message}")

asyncio.run(main())
```

If you see `✅ Sidecar is ready`, you're all set.

## Step 6: Make Your First AI Call

The simplest approach is `call_ai_once`, which creates a session, sends a prompt, and cleans up automatically:

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

The result includes `text` (the AI response), `usage` (token counts and cost), and `success` (whether the call succeeded).

## What's Next

Now that you have the sidecar running and can make AI calls, explore these guides:

- **[Sending Prompts to AI Models](sending-prompts.html)** — single-shot vs. multi-turn conversations
- **[Discovering and Selecting Models](discovering-models.html)** — see what models are available and filter by provider
- **[Managing Session Lifecycle](managing-sessions.html)** — create, reuse, and clean up sessions
- **[Configuring Built-in and Custom Tools](configuring-tools.html)** — control what tools the AI can use
- **[Python Client Recipes](recipes-python-client.html)** — copy-paste patterns for common workflows

---

## Advanced Usage

### Using a Custom Port

```bash
SIDECAR_PORT=9200 node dist/server.js
```

Tell the Python client where to find the server:

```bash
export SIDECAR_URL="http://127.0.0.1:9200"
```

Or pass the URL directly:

```python
from pi_sidecar_client import SidecarClient

client = SidecarClient("http://127.0.0.1:9200")
```

### Friendly Provider Names

The Python client maps short provider names to their sidecar equivalents automatically:

| You write | Sidecar receives |
|-----------|-----------------|
| `gemini` | `google` |
| `claude` | `google-vertex-claude` |
| `cursor` | `acpx-cursor` |

You can use either form. The short names are more convenient for most workflows.

### Embedding in a Node.js Application

Instead of running the standalone server, you can start the sidecar programmatically:

```ts
import { startSidecar } from "@myk-org/pi-sidecar";

const handle = startSidecar({
  port: 9200,
  host: "127.0.0.1",
});

// Later, shut down cleanly
await handle.close();
```

See [Embedding the Sidecar in a Node.js Application](embedding-in-node.html) for the full guide.

### Enabling Debug Logs

Both the server and client support configurable log levels via the `PI_SIDECAR_LOG_LEVEL` environment variable:

```bash
# Server-side debug logging
PI_SIDECAR_LOG_LEVEL=debug node dist/server.js
```

```bash
# Client-side debug logging
export PI_SIDECAR_LOG_LEVEL=DEBUG
```

See [Configuration and Environment Variables](configuration-reference.html) for all available settings.

---

## Troubleshooting

**Health check returns `❌ Sidecar starting`**

Model discovery runs on startup and can take several seconds. Wait a moment and retry. If it persists, check the server terminal for errors — a missing API key is the most common cause.

**`Connection refused` errors from the Python client**

Make sure the sidecar server is running and that `SIDECAR_URL` matches the port the server is listening on (default: `http://127.0.0.1:9100`).

**`Model 'X' not found for provider 'Y'`**

The model name or provider doesn't match any discovered model. Use `list_models()` to see what's available:

```python
from pi_sidecar_client import list_models

models = await list_models()
for m in models:
    print(f"{m['provider']}: {m['id']}")
```

See [Discovering and Selecting Models](discovering-models.html) for details on model discovery and provider filtering.

## Related Pages

- [Sending Prompts to AI Models](sending-prompts.html)
- [Discovering and Selecting Models](discovering-models.html)
- [Managing Session Lifecycle](managing-sessions.html)
- [Configuration and Environment Variables](configuration-reference.html)
- [Python Client Recipes](recipes-python-client.html)
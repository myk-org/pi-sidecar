Let me start by reading the knowledge graph and understanding the codebase structure.

Now let me explore the key source files related to model discovery and the Python client:

Now let me look at the HTTP server to understand the model-related endpoints:

Now let me look at the multi-turn example to see provider/model usage patterns:

Let me also check the tests for model listing and provider mapping:

Now let me check for any environment variable documentation or provider-specific details:

Now I have enough information. Let me write the guide.

# Discovering and Selecting Models

Find out which AI models are available on your sidecar, filter them by provider, and refresh the model list when your configuration changes.

## Prerequisites

- A running pi-sidecar server (see [Getting Started with pi-sidecar](quickstart.html))
- The Python client installed: `uv pip install pi-sidecar-client`

## Quick Example

```python
import asyncio
from pi_sidecar_client import list_models

async def main():
    models = await list_models()
    print(f"{len(models)} models available")
    for m in models:
        print(f"  {m['id']} ({m['provider']})")

asyncio.run(main())
```

## Listing All Models

Call `list_models()` to fetch every model the sidecar has discovered. Each model is a dictionary with `id`, `name`, and `provider` fields:

```python
models = await list_models()

for m in models:
    print(f"{m['id']:40s}  provider={m['provider']}")
```

You can group results by provider to see what's available at a glance:

```python
all_models = await list_models()

providers: dict[str, list] = {}
for m in all_models:
    providers.setdefault(m["provider"], []).append(m)

for provider, models in sorted(providers.items()):
    print(f"{provider} ({len(models)} models):")
    for m in models[:3]:
        print(f"  - {m['id']}: {m['name']}")
    if len(models) > 3:
        print(f"  ... and {len(models) - 3} more")
```

## Filtering by Provider

Pass a `provider` argument to `list_models()` to return only models from that provider:

```python
# Only Gemini models
gemini_models = await list_models(provider="gemini")

# Only Cursor models
cursor_models = await list_models(provider="cursor")

# Only Claude models
claude_models = await list_models(provider="claude")
```

You can use either the **friendly name** or the **sidecar name** — the client maps them automatically. See [Provider Name Mapping](#provider-name-mapping) below.

## Using a Model in an AI Call

Once you've found a model you want to use, pass its `provider` and `id` to any AI call:

```python
from pi_sidecar_client import call_ai_once

result = await call_ai_once(
    "Explain quicksort in three sentences.",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="You are a helpful assistant. Be concise.",
)
```

For more details on sending prompts, see [Sending Prompts to AI Models](sending-prompts.html).

## Provider Name Mapping

The Python client lets you use short, friendly provider names. It translates them to the sidecar's internal provider names before making requests:

| Friendly name | Sidecar name | Model ID example |
|---------------|--------------|------------------|
| `gemini` | `google` | `gemini-2.5-flash` |
| `claude` | `google-vertex-claude` | `claude-sonnet-4-20250514` |
| `cursor` | `acpx-cursor` | `cursor:gpt-4o` |

For providers not in this table (e.g. `anthropic`), the name passes through unchanged.

**Cursor model prefixing:** When you use the `cursor` provider, the client automatically adds the `cursor:` prefix to model IDs if it's missing. Both of these are equivalent:

```python
# These produce the same result:
await call_ai_once("Hello", ai_provider="cursor", ai_model="gpt-4o")
await call_ai_once("Hello", ai_provider="cursor", ai_model="cursor:gpt-4o")
```

> **Tip:** Use the friendly names (`gemini`, `claude`, `cursor`) in your code. They're shorter and the client handles the translation.

## Provider Requirements

Each provider needs specific credentials or configuration to be available:

| Provider | Required setup |
|----------|---------------|
| Gemini | `GOOGLE_API_KEY` environment variable or Application Default Credentials |
| Claude (Vertex AI) | `GOOGLE_APPLICATION_CREDENTIALS` environment variable and the Vertex extension |
| Claude (API key) | `ANTHROPIC_API_KEY` environment variable |
| Cursor (via ACPX) | `ACPX_AGENTS=cursor` environment variable, `acpx` CLI on `$PATH` |

If a provider's credentials aren't configured, its models won't appear in `list_models()` results.

For full environment variable details, see [Configuration and Environment Variables](configuration-reference.html).

## Advanced Usage

### Refreshing the Model List

The sidecar discovers models at startup. If you add new providers or change credentials while the sidecar is running, trigger a refresh to pick up the changes:

```python
from pi_sidecar_client import get_sidecar_client

client = get_sidecar_client()
updated_models = await client.refresh_models()
print(f"Refreshed: {len(updated_models)} models now available")
```

> **Note:** Model refresh re-runs the full discovery process, including ACPX agent discovery (which has a 30-second timeout per agent). The call blocks until discovery completes.

### Enabling ACPX Model Discovery

ACPX agents (like Cursor) expose models dynamically. To discover them, set the `ACPX_AGENTS` environment variable before starting the sidecar:

```bash
# Discover models from the Cursor agent
ACPX_AGENTS=cursor node -e "import('@myk-org/pi-sidecar').then(m => m.startSidecar())"
```

Multiple agents can be specified as a comma-separated list:

```bash
ACPX_AGENTS=cursor,other-agent
```

ACPX-discovered models include bracket notation showing their options (e.g. `cursor:gpt-5.4[context=272k,reasoning=medium]`). When both a builtin placeholder model and an ACPX-discovered model share the same base ID, the ACPX version takes priority and the placeholder is removed from the list.

### Checking Sidecar Readiness

The sidecar returns HTTP 503 on its health endpoint while model discovery is still running. Use `check_sidecar_available()` to verify readiness before listing models:

```python
from pi_sidecar_client import check_sidecar_available

available, message = await check_sidecar_available()
if available:
    models = await list_models()
else:
    print(f"Sidecar not ready: {message}")
```

If discovery encountered errors, the health endpoint returns `"status": "degraded"` — the sidecar is usable, but some providers may be missing. See [Python Client Recipes](recipes-python-client.html) for health check patterns.

### Using the Client Instance Directly

The convenience function `list_models()` uses a singleton client under the hood. If you need more control (e.g. a custom sidecar URL), use the client directly:

```python
from pi_sidecar_client import SidecarClient

client = SidecarClient(base_url="http://localhost:9200")
models = await client.get_models()
refreshed = await client.refresh_models()
await client.close()
```

## Troubleshooting

**`list_models()` returns an empty list**
- The sidecar may still be starting up. Wait a few seconds and check `check_sidecar_available()` first.
- Verify that provider credentials are set. For Gemini, ensure `GOOGLE_API_KEY` is in the environment where the sidecar runs.

**A model I expect is missing**
- If it's an ACPX model, make sure `ACPX_AGENTS` is set (e.g. `ACPX_AGENTS=cursor`) when the sidecar starts.
- Try calling `client.refresh_models()` to re-run discovery.
- Check the sidecar logs at `DEBUG` level (`PI_SIDECAR_LOG_LEVEL=debug`) for discovery errors.

**"Model not found for provider" error when creating a session**
- The `provider` and `model` values must match what `list_models()` returns. List models first to find the exact ID.
- If using the Python client, make sure you're using friendly provider names (`gemini`, not `google`). The client maps them for you.

## Related Pages

- [Getting Started with pi-sidecar](quickstart.html)
- [Sending Prompts to AI Models](sending-prompts.html)
- [Configuration and Environment Variables](configuration-reference.html)
- [Python Client API Reference](python-client-reference.html)
- [Python Client Recipes](recipes-python-client.html)
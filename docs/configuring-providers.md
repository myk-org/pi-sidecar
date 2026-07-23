# Configuring Model Providers

Connect pi-sidecar to external LLM APIs and local AI agents to power your applications. By configuring the correct environment variables, you can authenticate requests and expose models from cloud providers, ACPX (Cursor) installations, or CLI agents.

- The pi-sidecar server installed and running.
- The `pi_sidecar_client` Python package installed.

### Quick Example

Before configuring anything, you can check which models are currently available to the sidecar using the Python client.

```python
import asyncio
from pi_sidecar_client import list_models

async def main():
    # Discover all models available to the sidecar
    models = await list_models()
    for m in models:
        print(f"{m['provider']}: {m['id']}")

asyncio.run(main())
```

### 1. Configure Built-in API Providers

The sidecar supports cloud providers like Google, OpenAI, and Anthropic out of the box.

1. Set standard API key environment variables in your terminal.
2. Start the sidecar server.

```bash
export GOOGLE_API_KEY="your-google-key"
export ANTHROPIC_API_KEY="your-anthropic-key"

npm run start
```

The sidecar automatically detects the keys and exposes models under built-in providers like `google` and `anthropic`.

### 2. Configure ACPX Agents

You can route prompts through existing ACPX-compatible local installations (like Cursor) to leverage their internal models and existing authentication.

1. Set the `ACPX_AGENTS` environment variable to the agent name.
2. Start the sidecar.

```bash
export ACPX_AGENTS="cursor"

npm run start
```

These models appear under the `acpx-cursor` provider namespace. Their model IDs use bracket notation to denote options (for example, `cursor:gpt-4o[context=128k]`).

### 3. Configure CLI Providers

If you use command-line AI agents, you can expose them to the sidecar using a similar pattern.

1. Set the `CLI_AGENTS` environment variable with a comma-separated list of your agent tools.
2. Start the sidecar.

```bash
export CLI_AGENTS="cursor,claude"

npm run start
```

Models from these agents will appear under provider namespaces like `cli-cursor` or `cli-claude`.

## Advanced Usage

### Using Discovered Models

Once your providers are configured and the sidecar is running, pass the specific provider and model ID to the client when making AI calls. The sidecar ensures the request routes correctly.

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    result = await call_ai_once(
        prompt="Write a Python script to list directory contents.",
        provider="acpx-cursor",
        model="cursor:gpt-4o[context=128k]"
    )
    print(result.text)

asyncio.run(main())
```

## Troubleshooting

### Diagnosing Missing Models

If an expected model isn't appearing in your list, verify that the provider is successfully registered and authenticated with the sidecar using the diagnostic status endpoint.

```python
import asyncio
from pi_sidecar_client import get_sidecar_client

async def diagnose_provider():
    client = get_sidecar_client()
    
    # Query status for a specific provider
    status = await client.get_model_provider_status("google")
    
    print(f"Registered: {status['registered']}")
    print(f"Total Models: {status['modelCount']}")
    print(f"Auth Configured: {'Yes' if status.get('authStatus') else 'No'}")

asyncio.run(diagnose_provider())
```

> **Note:** When the sidecar is bound to `127.0.0.1`, the provider status endpoint returns full configuration details to assist with local debugging. On remote host bindings, sensitive authentication details are automatically redacted. See [Server Deployment Scenarios](server-deployment-scenarios.html) for more details on host binding and security.

## Related Pages

- [Environment Variables](environment-variables.html)
- [Python Client Reference](python-client.html)
- [Runtime Architecture](runtime-architecture.html)
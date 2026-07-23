# Quickstart

Start the sidecar server and make your first AI call using the Python client in under a minute.

## Prerequisites

- Node.js 22.19 or higher.
- Python 3.10 or higher.
- The `@earendil-works/pi-coding-agent` SDK (≥ 0.81.1) installed in your Node environment.
- Access to an AI provider (e.g., API keys configured in your environment or a local agent).

## Quick Example

First, start the sidecar in the background:

```bash
./scripts/start-sidecar.sh
```

Then, use the Python client to send a prompt to the AI:

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
        print(f"\nTokens: in={result.usage.input_tokens} out={result.usage.output_tokens}")
    else:
        print(f"Error: {result.text}")

if __name__ == "__main__":
    asyncio.run(main())
```

## Step-by-Step

### 1. Start the Sidecar Server

The sidecar runs as a background HTTP service and binds to `127.0.0.1:9201` by default. It manages session lifecycles, model discovery, and tool execution.

```bash
# From the repository root
./scripts/start-sidecar.sh
```

You should see output indicating the sidecar is running, along with its Process ID (PID) and log file location.

> **Note:** See [Environment Variables](environment-variables.html) if you need to customize the port or bind host.

### 2. Install the Python Client

Install the async client package into your Python environment. You can use pip or your preferred package manager.

```bash
# Install from the local repository directory
pip install ./pi_sidecar_client
```

### 3. Make Your First Call

The `call_ai_once` function is the simplest way to interact with the sidecar. It automatically handles creating an HTTP session, sending your prompt, waiting for the AI response, and cleaning up the session when finished.

Create a file named `hello.py` and add the following code:

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    result = await call_ai_once(
        prompt="Write a Python function to reverse a string.",
        ai_provider="gemini",  # Or your configured provider
        ai_model="gemini-2.5-flash"
    )
    print(result.text)

asyncio.run(main())
```

Run the script:

```bash
python hello.py
```

## Advanced Usage

### Running in the Foreground

If you are developing or debugging, you may want to run the sidecar in the foreground to see real-time logs in your terminal.

```bash
./scripts/start-sidecar.sh --foreground
```

Press `Ctrl+C` to stop the server when running in the foreground.

### Stopping the Background Server

When you are finished using the background sidecar, you can cleanly stop it using the `--stop` flag:

```bash
./scripts/start-sidecar.sh --stop
```

### Next Steps

- For more complex orchestration workflows like chaining multiple turns in a stateful conversation, see [Managing AI Conversations](managing-conversations.html).
- To equip the AI with tools to read the filesystem or hit REST APIs, see [Extending Capabilities with Tools](extending-with-tools.html).
- For parallel execution and robust error handling patterns, check out [Python Integration Patterns](python-integration-patterns.html).

## Troubleshooting

- **Address in use:** If the server fails to start because port 9201 is already in use, you can either stop the existing instance (`./scripts/start-sidecar.sh --stop`) or start a new one on a different port by prefixing the command with `SIDECAR_PORT=9202`.
- **SDK version errors:** The sidecar strictly requires `@earendil-works/pi-coding-agent` version `0.81.1` or higher. Ensure your Node dependencies are up to date.
- **Provider errors:** If your chosen AI provider isn't returning models or accepting prompts, see [Configuring Model Providers](configuring-providers.html) to ensure it is registered and authenticated correctly.
- **Check the logs:** If something goes wrong with a background sidecar, view the logs at `/tmp/pi-work/pi-sidecar/sidecar.log` for full error stack traces.

## Related Pages

- [Managing AI Conversations](managing-conversations.html)
- [Python Integration Patterns](python-integration-patterns.html)
- [Configuring Model Providers](configuring-providers.html)
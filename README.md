# pi-sidecar

A standalone HTTP service that wraps the [Pi coding agent SDK](https://www.npmjs.com/package/@earendil-works/pi-coding-agent), exposing AI sessions over a simple JSON API. Ships with a Python client for easy integration.

📖 **[Full Documentation](https://myk-org.github.io/pi-sidecar/)**

## Packages

| Package | Language | Install |
|---------|----------|---------|
| `@myk-org/pi-sidecar` | TypeScript | `npm install @myk-org/pi-sidecar` |
| `pi-sidecar-client` | Python ≥ 3.10 | `uv pip install pi-sidecar-client` |

## Quick Start

```python
from pi_sidecar_client import call_ai_once

result = await call_ai_once(
    "Summarize this log file",
    ai_provider="gemini",
    ai_model="gemini-2.5-flash",
    system_prompt="You are a log analyst.",
)
print(result.text)
```

```bash
# Start the sidecar
npm run build && node dist/server.js  # listens on 127.0.0.1:9100
```

See the [full documentation](https://myk-org.github.io/pi-sidecar/) for everything else.

## License

MIT

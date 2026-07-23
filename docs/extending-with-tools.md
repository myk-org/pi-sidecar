# Extending Capabilities with Tools

Provide the AI with the ability to interact with your local filesystem, execute commands, or securely call external APIs. By default, sessions start with a standard set of filesystem tools, but you can override these or inject your own custom REST API tools without writing any server-side execution code.

## Prerequisites

* A running `pi-sidecar` server.
* The Python `pi_sidecar_client` installed and configured.

## Quick Example

When creating a session or making a single-shot AI call, you can explicitly define which tools the AI is allowed to use by providing a `tools` list. 

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    result = await call_ai_once(
        "Find all Python files in the tests directory and list them.",
        # This overrides defaults; the AI can only use 'find' and 'ls'
        tools=["find", "ls"]
    )
    print(result.text)

if __name__ == "__main__":
    asyncio.run(main())
```

## Using Built-in Tools

By default, if you omit the `tools` parameter, the sidecar provides a standard set of capabilities (`read`, `grep`, `find`, `ls`, `bash`).

To restrict the AI (for instance, to prevent it from executing arbitrary `bash` scripts), explicitly pass a `tools` list. The provided list completely replaces the defaults.

### Available Built-in Tools

*   `read`: Read file contents.
*   `grep`: Search for text patterns inside files.
*   `find`: Search for files matching glob patterns.
*   `ls`: List directory contents.
*   `bash`: Execute shell commands.
*   `subagent`: Delegate complex tasks to specialized agents. This tool is opt-in and requires explicitly adding `"subagent"` to your `tools` list. See [Orchestrating Subagents](orchestrating-subagents.html) for more details.

> **Tip:** If you provide an empty list (`tools=[]`), the AI will have no tools available.

## Advanced Usage

### Custom HTTP Tools

You can integrate external REST APIs directly into the AI's toolset using the `custom_tools` list. The sidecar includes a built-in HTTP tool executor, meaning you only need to provide the schema and endpoint configuration—no custom server-side execution code is required.

An HTTP tool requires a standard JSON schema defining its parameters, alongside an `http` configuration object that maps those parameters to the outgoing request.

1.  **Define the schema:** Give the tool a `name`, `description`, and define expected `parameters`.
2.  **Define the HTTP execution:** Set the `method`, `url`, and optionally `headers`, `query_params`, `body_template`, and `timeout_ms`.
3.  **Use placeholders:** Any parameter defined in the schema can be injected into the request by wrapping its name in curly braces (e.g., `{city}`).

### Example: Adding a Weather API Tool

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    weather_tool = {
        "name": "get_weather",
        "description": "Fetch the current weather for a specific city.",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "The city name"}
            },
            "required": ["city"]
        },
        "http": {
            "method": "GET",
            # The {city} placeholder is automatically replaced and URI-encoded
            "url": "https://api.example.com/weather/{city}",
            "query_params": {
                "units": "metric"
            },
            "headers": {
                "Accept": "application/json"
            },
            "timeout_ms": 10000
        }
    }

    result = await call_ai_once(
        "Is it raining in Seattle right now?",
        # We explicitly supply 'read' and 'bash' along with our custom tool
        tools=["read", "bash"],
        custom_tools=[weather_tool]
    )
    print(result.text)

if __name__ == "__main__":
    asyncio.run(main())
```

### Placeholders and Interpolation

The HTTP tool executor supports interpolating parameters in several places:

*   **URLs:** Safely URI-encodes the injected value to prevent path traversal and URL injection (e.g., `https://api.example.com/users/{id}`).
*   **Headers:** Replaces placeholders and automatically strips any carriage returns or line feeds to prevent HTTP header injection.
*   **Query Parameters:** Values mapped here are appropriately encoded into the query string.
*   **Body Templates:** If `body_template` is an object, placeholders inside strings will be replaced. Non-string variables injected into a JSON body are properly JSON-escaped.

### HTTP Tool Security Controls

The sidecar enforces strict security boundaries on the HTTP executor to protect your environment:

*   **URL Schemes:** Only `http` and `https` protocols are permitted.
*   **Response Limits:** To prevent memory exhaustion, API responses are strictly capped at 1MB.
*   **Timeouts:** The default request timeout is 30 seconds. You can override this per-tool using `timeout_ms`.

> **Warning:** The sidecar does not block internal network requests by default. If your environment requires restricting access to local IP ranges or specific internal hosts, you must enforce those network policies at your infrastructure level.

## Troubleshooting

*   **Custom tool request is rejected (HTTP 400):** Ensure every custom tool definition has a valid, non-empty `name` string and is passed as a flat dictionary object within the `custom_tools` list. Nested arrays or missing names will trigger a validation error.
*   **Missing subagent extension:** If you add `"subagent"` to your `tools` array but the sidecar fails to create the session with a 400 error, ensure the internal extension path is resolvable. See [Orchestrating Subagents](orchestrating-subagents.html) for setup requirements.
*   **HTTP Tool fails to execute:** Verify the target API is accessible from the machine running the `pi-sidecar` server and responds within the timeout period. The AI will receive the error message dynamically and may attempt to explain the failure in its response.

## Related Pages

- [Orchestrating Subagents](orchestrating-subagents.html)
- [Managing AI Conversations](managing-conversations.html)
- [REST API Endpoints](rest-api.html)
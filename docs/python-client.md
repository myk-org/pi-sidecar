# Python Client Reference

The `pi_sidecar_client` package provides an asynchronous Python client for the pi-sidecar HTTP API. It exposes dataclasses for typing and a `SidecarClient` class for interacting with the service, along with module-level helper functions for common operations.

## Installation and Requirements

Requires Python 3.10+ and `httpx`.

## Dataclasses

### `AITokenUsage`

Represents token usage statistics returned by the AI provider.

| Field | Type | Description |
|-------|------|-------------|
| `prompt_tokens` | `int` | Number of tokens in the prompt. |
| `completion_tokens` | `int` | Number of tokens generated in the response. |
| `total_tokens` | `int` | Total tokens used (prompt + completion). |

### `AIResult`

The result of an AI call.

| Field | Type | Description |
|-------|------|-------------|
| `text` | `str` | The generated text from the AI. |
| `usage` | `AITokenUsage \| None` | Token usage statistics, if provided by the model. |
| `error` | `str \| None` | Error message if the call failed. Callers must check this field. |

## Core Client

### `SidecarClient`

The primary class for interacting with the pi-sidecar service. It manages an underlying `httpx.AsyncClient`.

#### `__init__(base_url: str, client: httpx.AsyncClient | None = None)`

Initializes the client.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `base_url` | `str` | None (Required) | The base URL of the pi-sidecar HTTP service (e.g., `"http://127.0.0.1:4000"`). |
| `client` | `httpx.AsyncClient \| None` | `None` | An optional existing `httpx` client to use. If omitted, a new client is created. |

```python
from pi_sidecar_client import SidecarClient

# Create a standalone client
client = SidecarClient("http://127.0.0.1:4000")
```

#### `close() -> None`

Closes the underlying `httpx.AsyncClient` if it was created by the `SidecarClient`. Does not close externally provided clients.

```python
await client.close()
```

#### `list_models() -> dict[str, list[str]]`

Retrieves the available models grouped by provider.

**Returns:** A dictionary where keys are provider names (e.g., `"google"`, `"acpx-cursor"`) and values are lists of model IDs.

```python
models = await client.list_models()
print(models.get("google", []))
```

#### `get_model_provider_status(provider: str) -> dict[str, Any]`

Diagnostic endpoint to check the registration and authentication status of a specific provider.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `provider` | `str` | None (Required) | The provider ID (e.g., `"google"`, `"cli-cursor"`). |

**Returns:** A dictionary containing status details:
- `registered` (`bool`): Whether the provider is registered.
- `model_count` (`int`): Number of available models.
- `authStatus` (`dict`): Authentication configuration details.
- `authCheck` (`dict`): The result of checking the auth credentials.

> **Note:** On non-loopback binds, the sidecar redacts sensitive authentication details from `authStatus` and `authCheck`.

**Raises:** `httpx.HTTPStatusError` if the provider is not found (HTTP 404).

```python
try:
    status = await client.get_model_provider_status("google")
    print(f"Registered: {status['registered']}, Models: {status['model_count']}")
except httpx.HTTPStatusError as e:
    if e.response.status_code == 404:
        print("Provider not registered.")
```

#### `create_session(provider: str, model: str, system_prompt: str | None = None, tools: list[str] | None = None, custom_tools: list[dict[str, Any]] | None = None, cwd: str | None = None, agent_dir: str | None = None) -> str`

Creates a new AI session.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `provider` | `str` | None (Required) | The provider to use (e.g., `"google"`). |
| `model` | `str` | None (Required) | The model to use (e.g., `"gemini-2.5-flash"`). |
| `system_prompt` | `str \| None` | `None` | Optional system instructions. |
| `tools` | `list[str] \| None` | `None` | List of built-in or extension tools to enable (e.g., `["read", "subagent"]`). |
| `custom_tools` | `list[dict[str, Any]] \| None` | `None` | Definitions for custom HTTP tools. |
| `cwd` | `str \| None` | `None` | Working directory for project-level resources. |
| `agent_dir` | `str \| None` | `None` | Directory for user-level resources (skills, agents). |

**Returns:** The unique session ID string.

```python
session_id = await client.create_session(
    provider="google",
    model="gemini-2.5-flash",
    system_prompt="You are a helpful coding assistant.",
    tools=["read", "ls"]
)
```

#### `delete_session(session_id: str) -> None`

Deletes an active session and frees its resources.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `session_id` | `str` | None (Required) | The session ID to delete. |

```python
await client.delete_session(session_id)
```

#### `prompt(session_id: str, text: str) -> AIResult`

Sends a prompt to an active session.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `session_id` | `str` | None (Required) | The session ID. |
| `text` | `str` | None (Required) | The user message to send. |

**Returns:** An `AIResult` object containing the response text, usage, and any errors.

```python
result = await client.prompt(session_id, "List the files in the current directory.")
if result.error:
    print(f"Error: {result.error}")
else:
    print(result.text)
```

## Module-Level Helpers

These functions provide convenient wrappers around the `SidecarClient` for common, self-contained operations.

#### `list_models(sidecar_url: str = "http://127.0.0.1:4000") -> dict[str, list[str]]`

Discovers available models across all providers. Creates and closes a temporary client.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sidecar_url` | `str` | `"http://127.0.0.1:4000"` | The base URL of the pi-sidecar service. |

```python
from pi_sidecar_client import list_models

models = await list_models()
```

#### `call_ai_once(prompt: str, provider: str, model: str, system_prompt: str | None = None, tools: list[str] | None = None, sidecar_url: str = "http://127.0.0.1:4000") -> AIResult`

A single-shot helper that creates a session, sends one prompt, and deletes the session, handling all lifecycle management.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | `str` | None (Required) | The message to send to the AI. |
| `provider` | `str` | None (Required) | The provider ID. |
| `model` | `str` | None (Required) | The model ID. |
| `system_prompt` | `str \| None` | `None` | Optional system instructions. |
| `tools` | `list[str] \| None` | `None` | Optional list of tool names. |
| `sidecar_url` | `str` | `"http://127.0.0.1:4000"` | The base URL of the pi-sidecar service. |

```python
from pi_sidecar_client import call_ai_once

result = await call_ai_once(
    prompt="What is 2+2?",
    provider="google",
    model="gemini-2.5-flash"
)
```

## Related Pages

- [Python Integration Patterns](python-integration-patterns.html)
- [REST API Endpoints](rest-api.html)
- [Quickstart](quickstart.html)
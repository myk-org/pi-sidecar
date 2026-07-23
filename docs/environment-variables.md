# Environment Variables

This reference documents all environment variables used to configure the pi-sidecar HTTP server, model discovery rules, and extension loading behavior.

## Core Configuration

These variables control the network binding, operational mode, and observability of the sidecar.

### `PI_SIDECAR_LOG_LEVEL`

| Property | Value |
|----------|-------|
| **Type** | String (`error`, `warn`, `info`, `debug`) |
| **Default** | `info` |

Controls the verbosity of logs emitted by the sidecar server and the Python client. Use `debug` for request tracing and internal model resolution details.

```bash
export PI_SIDECAR_LOG_LEVEL=debug
```

### `SIDECAR_PORT`

| Property | Value |
|----------|-------|
| **Type** | Number |
| **Default** | `9100` |

The TCP port on which the sidecar HTTP server will listen. 

```bash
export SIDECAR_PORT=9105
```

### `SIDECAR_HOST`

| Property | Value |
|----------|-------|
| **Type** | String |
| **Default** | `127.0.0.1` |

The hostname or IP address the sidecar HTTP server binds to. By default, it restricts connections to localhost. See [Server Deployment Scenarios](server-deployment-scenarios.html) for details on network boundaries.

```bash
export SIDECAR_HOST=0.0.0.0
```

### `DEV_MODE`

| Property | Value |
|----------|-------|
| **Type** | String (`true`, `false`) |
| **Default** | `false` |

When set to `true`, forces the sidecar to bind to `0.0.0.0` (unless overridden by `SIDECAR_HOST`). It also downgrades invalid `agent_dir` parameters on non-loopback requests from a hard HTTP 400 error to a warning, ignoring the invalid value.

```bash
export DEV_MODE=true
```

### `SIDECAR_WATCHDOG_URL`

| Property | Value |
|----------|-------|
| **Type** | String (HTTP/HTTPS URL) |
| **Default** | *(None)* |

Opt-in URL for the health-check watchdog. The sidecar will periodically poll this URL. If it fails 6 consecutive times, the sidecar gracefully shuts down. 

```bash
export SIDECAR_WATCHDOG_URL="http://localhost:8000/health"
```

## Agent Discovery

These variables configure which external model providers are scanned and loaded into the shared runtime during startup.

> **Note:** Models discovered through these mechanisms populate the list returned by the sidecar. See [Configuring Model Providers](configuring-providers.html) for usage.

### `ACPX_AGENTS`

| Property | Value |
|----------|-------|
| **Type** | Comma-separated String |
| **Default** | *(None)* |

A list of agents to load via the `acpx/runtime` library. Discovered models appear under the `acpx-<agent>` provider namespace.

```bash
export ACPX_AGENTS="cursor"
```

### `CLI_AGENTS`

| Property | Value |
|----------|-------|
| **Type** | Comma-separated String |
| **Default** | *(None)* |

A list of CLI-based agents to load. Discovered models appear under the `cli-<agent>` provider namespace.

```bash
export CLI_AGENTS="cursor,claude,gemini"
```

## Extension Path Overrides

The sidecar dynamically resolves extension paths for providers and tools via standard module resolution. Use these overrides if your environment requires loading extensions from non-standard locations. 

> **Tip:** Path overrides are absolute paths pointing directly to the entry `.ts` or `.js` file for the given extension.

### `SIDECAR_ACPX_EXTENSION_PATH`

| Property | Value |
|----------|-------|
| **Type** | String (Absolute Path) |
| **Default** | Resolved dynamically |

Overrides the default resolution path for the ACPX provider extension used to handle models specified in `ACPX_AGENTS`.

```bash
export SIDECAR_ACPX_EXTENSION_PATH="/opt/extensions/acpx/index.ts"
```

### `SIDECAR_CLI_PROVIDER_EXTENSION_PATH`

| Property | Value |
|----------|-------|
| **Type** | String (Absolute Path) |
| **Default** | Resolved dynamically |

Overrides the standard path for the CLI provider extension used to handle models specified in `CLI_AGENTS`.

```bash
export SIDECAR_CLI_PROVIDER_EXTENSION_PATH="/custom/path/cli-provider/index.ts"
```

### `SIDECAR_VERTEX_EXTENSION_PATH`

| Property | Value |
|----------|-------|
| **Type** | String (Absolute Path) |
| **Default** | Resolved dynamically |

Overrides the standard path to the Google Vertex AI provider extension.

```bash
export SIDECAR_VERTEX_EXTENSION_PATH="/var/pi/extensions/vertex/index.ts"
```

### `SIDECAR_SUBAGENT_EXTENSION_PATH`

| Property | Value |
|----------|-------|
| **Type** | String (Absolute Path) |
| **Default** | Resolved dynamically |

Overrides the resolution path for the subagent tool extension. See [Orchestrating Subagents](orchestrating-subagents.html) for more about subagent behaviors.

```bash
export SIDECAR_SUBAGENT_EXTENSION_PATH="/usr/local/lib/subagent.ts"
```

## Related Pages

- [Configuring Model Providers](configuring-providers.html)
- [Server Deployment Scenarios](server-deployment-scenarios.html)
- [Runtime Architecture](runtime-architecture.html)
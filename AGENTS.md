# AGENTS.md — pi-sidecar

## Project Overview

pi-sidecar exposes the [Pi coding agent SDK](https://github.com/earendil-works/pi-coding-agent) as a lightweight HTTP service, so non-Node callers (Python, shell, CI) can create AI sessions, send prompts, and manage models over REST.

The repo ships **two packages**:

| Package | Language | Purpose |
|---------|----------|---------|
| `@myk-org/pi-sidecar` (repo root) | TypeScript (Node 22+) | HTTP server wrapping the Pi SDK — session lifecycle, model discovery, watchdog |
| `pi_sidecar_client/` | Python 3.10+ | Async client (`httpx`) with convenience helpers (`call_ai`, `call_ai_once`, `list_models`) |

---

## Repository Structure

```text
pi-sidecar/                        (repo root = npm package root)
├── package.json                    # @myk-org/pi-sidecar npm package
├── tsconfig.json                   # strict, ES2022, nodenext
├── src/
│   ├── server.ts                   # CLI entry point — imports and calls startSidecar()
│   ├── index.ts                    # HTTP server, routing, JSON helpers, startSidecar()
│   ├── sessions.ts                 # SessionStore — create/prompt/abort/delete sessions, model discovery, error surfacing
│   └── watchdog.ts                 # Health-check poller; kills sidecar when backend is unresponsive
├── tests/
│   ├── test_ts/                    # TypeScript sidecar tests
│   │   ├── parse-body.test.ts     # Body parser tests
│   │   ├── route-match.test.ts    # URL route matching tests
│   │   └── watchdog.test.ts       # Health check watchdog tests
│   └── test_python/                # Python client tests
│       ├── conftest.py            # Shared test fixtures
│       └── test_sidecar_client.py # Client unit tests
├── pi_sidecar_client/              # Python client library
│   └── __init__.py                 # SidecarClient, AIResult, call_ai, call_ai_once, list_models
├── examples/
│   ├── basic_prompt.py             # Single-shot AI call
│   ├── multi_turn.py               # Multi-turn conversation with session reuse
│   ├── list_models.py              # Discover available models
│   ├── health_check.py             # Check sidecar availability
│   ├── parallel_tasks.py           # Parallel AI calls with concurrency limit
│   ├── usage_tracking.py           # Pluggable usage recording
│   └── start-sidecar.ts            # Programmatic sidecar startup (TypeScript)
├── pyproject.toml                  # pi-sidecar-client — requires httpx, Python ≥3.10
├── tox.toml
├── AGENTS.md                       # ← you are here
└── README.md
```

---

## Coding Standards

### TypeScript (`src/`)

- **Strict mode** — `tsconfig.json` has `"strict": true`.
- **Target** — ES2022, `"module": "nodenext"`, `"moduleResolution": "nodenext"`.
- **No default exports** — use named exports only (`export function …`, `export class …`).
- **Module type** — ESM (`"type": "module"` in `package.json`); imports use `.js` extensions.
- **Node built-ins** — prefix with `node:` (e.g. `import { createServer } from "node:http"`).

### Python (`pi_sidecar_client/`)

- **Python 3.10+** — use `X | Y` union syntax, not `Union[X, Y]`.
- **Dataclasses** for data carriers (`AIResult`, `AITokenUsage`).
- **Type hints** on all public function signatures.
- **Async/await** — the client is fully async (`httpx.AsyncClient`).
- **`__all__`** — explicitly declared in `__init__.py`.

---

## Naming Conventions

| Element | TypeScript | Python |
|---------|-----------|--------|
| Files | `kebab-case.ts` | `snake_case.py` |
| Classes | `PascalCase` | `PascalCase` |
| Functions / methods | `camelCase` | `snake_case` |
| Constants | `UPPER_SNAKE_CASE` | `UPPER_SNAKE_CASE` |
| Interfaces / types | `PascalCase` (prefix with `I` only when ambiguous) | — |

---

## Import Ordering

Group imports in this order, separated by a blank line:

1. **Node built-ins** — `node:http`, `node:crypto`, `node:child_process`
2. **External packages** — `@earendil-works/pi-coding-agent`, `httpx`
3. **Local imports** — `./sessions.js`, `./watchdog.js`

---

## Logging Standards

All code paths **must** have appropriate logging. Silent failures are bugs.

### Log Levels

| Level | When to use | Examples |
|-------|-------------|----------|
| `error` | Operation failed, caller is affected | Prompt rejected, session not found, model not found, AI returned errors |
| `warn` | Something unexpected but recoverable | Validation 400s, empty AI response, cleanup failures, extension not found |
| `info` | Significant lifecycle events | Server started, session created/deleted/aborted, model discovery complete, request completed with timing |
| `debug` | Request tracing and internal details | Model resolution, provider mapping, request entry, response details |

### TypeScript (`src/`)

- Use `console.error`, `console.warn`, `console.info`, `console.log`, `console.debug`
- Prefix all messages with `[sidecar]` (or `[watchdog]` for watchdog)
- Format: `[sidecar] ACTION: key=value, key=value`
- Log timing on all mutating operations: `POST /sessions 201 10ms session=...`
- Log full error object (not just message) for 500 errors — preserves stack trace
- Never log sensitive data (API keys, tokens). Sanitize URLs before logging.

### Python (`pi_sidecar_client/`)

- Use the module logger: `logger.error()`, `logger.warning()`, `logger.info()`, `logger.debug()`
- Log level is controlled by `PI_SIDECAR_LOG_LEVEL` env var (default: `INFO`)
- Use `exc_info=True` on exception handlers for full stack traces
- Use `%s` formatting (not f-strings) for lazy evaluation at debug level

### Error Surfacing Rules

- **Never hide errors from callers.** If the AI returns an error, surface it via the `error` field.
- All failure paths must populate `AIResult.error` (Python) or include `error` in the response JSON (TypeScript).
- Log every error at `error` level with enough context to debug (session ID, status code, error message).

---

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat: add model refresh endpoint
fix: handle missing provider in session creation
docs: update AGENTS.md with branch naming
chore: bump pi-coding-agent to 0.75
refactor: extract route matching into helper
```

---

## Branch Naming

```text
feat/issue-42-model-discovery
fix/issue-17-watchdog-timeout
docs/issue-5-agents-md
chore/issue-99-dep-bump
```

Pattern: `<type>/issue-<N>-<short-description>`

---

## Key Design Decisions

### 1. Extracted from myk-org/rootcoz — copy, don't rewrite

The sidecar code was lifted from an existing monorepo. When porting code, **copy the working implementation verbatim** and adapt imports. Do not redesign APIs or refactor prematurely.

### 2. Tools are pluggable via `customTools`, not hardcoded

Sessions accept an optional `custom_tools` array at creation time. The default tool set (`read`, `grep`, `find`, `ls`, `bash`) is intentionally minimal. Callers extend it per-session — never add domain-specific tools to the sidecar itself.

### 3. Watchdog is opt-in

`startWatchdog()` monitors a companion backend's health endpoint. It waits a 60 s grace period before starting checks, then polls every 30 s and shuts down the sidecar after 6 consecutive failures (~3 min). All timings are configurable via `WatchdogOptions` (`intervalMs`, `timeoutMs`, `maxFailures`, `startDelayMs`). It is **opt-in** — activated only when a `watchdogUrl` parameter is passed to `startSidecar()` or the `SIDECAR_WATCHDOG_URL` environment variable is set. Standalone usage works without a watchdog. Consumers with companion backends (like rootcoz) opt in by providing the health URL (e.g. `http://localhost:8000/health`).

### 4. Localhost-only by default (trust model)

The HTTP server binds to `127.0.0.1` unless `DEV_MODE=true` (which opens `0.0.0.0`). There is **no authentication** on the sidecar API — security relies on the network boundary. Do not add auth; instead, keep the server local and use the Python client from the same host.

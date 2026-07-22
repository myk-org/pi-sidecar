# AGENTS.md — pi-sidecar

## Project Overview

pi-sidecar exposes the [Pi coding agent SDK](https://github.com/earendil-works/pi-coding-agent) as a lightweight HTTP service, so non-Node callers (Python, shell, CI) can create AI sessions, send prompts, and manage models over REST.

The repo ships **two packages**:

| Package | Language | Purpose |
|---------|----------|---------|
| `@myk-org/pi-sidecar` (repo root) | TypeScript (Node ≥22.19) | HTTP server wrapping the Pi SDK — session lifecycle, model discovery, watchdog |
| `pi_sidecar_client/` | Python 3.10+ | Async client (`httpx`) with convenience helpers (`call_ai`, `call_ai_once`, `list_models`) plus `SidecarClient.get_model_provider_status()` for per-provider diagnostics |

Requires `@earendil-works/pi-coding-agent` ≥ 0.81.1 (see `src/pi-version.ts` — enforced at startup via `assertPiVersionFloor()`).

### Live e2e (only when the user explicitly asks)

Do **not** run live e2e unless the user asks. They are excluded from default pytest and tox (`-m "not e2e"`).

When asked to run them:

```bash
uv run --group tests pytest -m e2e -n auto
```

(`-n auto` = pytest-xdist; one shared sidecar, parallel cases — faster than serial.)

---

## Repository Structure

```text
pi-sidecar/                        (repo root = npm package root)
├── package.json                    # @myk-org/pi-sidecar npm package
├── tsconfig.json                   # strict, ES2022, nodenext
├── src/
│   ├── server.ts                   # CLI entry point — clears process.argv[1] for subagent compat, starts sidecar
│   ├── index.ts                    # HTTP server, routing, JSON helpers, startSidecar()
│   ├── resolve-extension-path.ts   # Extension path resolution with ESM fallback for strict exports
│   ├── pi-version.ts               # MIN_PI_VERSION floor check — assertPiVersionFloor() called at startup
│   ├── sessions.ts                 # SessionStore — internal AgentSessionRuntime, user sessions, model discovery, error surfacing
│   ├── http-tool-executor.ts       # HTTP-backed custom tool executor with parameter interpolation
│   ├── logger.ts                   # Log-level-aware logger wrapping console.* APIs (gated by PI_SIDECAR_LOG_LEVEL)
│   └── watchdog.ts                 # Health-check poller; kills sidecar when backend is unresponsive
├── scripts/
│   ├── start-sidecar.sh            # Sidecar startup script (canonical location). Prefers dist/server.js (published package); falls back to npx tsx src/server.ts for local checkout. .dev/start-sidecar.sh, if present locally, is a gitignored (.dev/ is untracked) exec shim kept only for individual devs' muscle memory — it is not part of the published package.
│   └── enforce-protobufjs-floor.mjs # postinstall: replace shrinkwrap-sealed nested protobufjs below CVE floor
├── tests/
│   ├── test_ts/                    # TypeScript sidecar tests
│   │   ├── acpx-provider-integration.test.ts # ACPX extension path resolution and discoverAcpxModels tests
│   │   ├── agent-dir-integration.test.ts # agent_dir validation and agentDir fallback tests
│   │   ├── cli-provider-integration.test.ts # CLI provider extension path resolution and discoverCliModels tests
│   │   ├── http-tool-executor.test.ts # HTTP tool executor tests (interpolation, security, timeout)
│   │   ├── message-boundary.test.ts # Multi-message newline separator tests
│   │   ├── parse-body.test.ts     # Body parser tests
│   │   ├── pi-version.test.ts     # compareVersions, getInstalledPiVersion, assertPiVersionFloor tests
│   │   ├── provider-status-redact.test.ts # isLoopbackBindHost / redactProviderStatusAuth coverage
│   │   ├── route-match.test.ts    # URL route matching tests, incl. /models/:provider/status
│   │   ├── session-store.test.ts             # SessionStore lifecycle (fully mocked runtime)
│   │   ├── snapshot-agent-source.test.ts # snapshotAgentSource() modelRuntime-vs-fallback branch coverage (mocked)
│   │   ├── subagent-integration.test.ts # Subagent extension resolution and env var override tests
│   │   ├── tools-config.test.ts   # DEFAULT_TOOLS, tools config, and agent_dir validation tests
│   │   └── watchdog.test.ts       # Health check watchdog tests
│   ├── test_python/                # Python client unit tests
│   │   ├── conftest.py            # Shared unit fixtures
│   │   └── test_sidecar_client.py # Client unit tests
│   └── e2e/                        # Live e2e (opt-in only; never default/tox — see “Live e2e” below)
│       ├── conftest.py            # Sidecar lifecycle + working_models fixtures
│       ├── test_live_battery.py   # Live HTTP tests via pi_sidecar_client
│       └── README.md              # How to run on demand
├── pi_sidecar_client/              # Python client library
│   └── __init__.py                 # SidecarClient (incl. get_model_provider_status), AIResult, call_ai, call_ai_once, list_models
├── examples/
│   ├── basic_prompt.py             # Single-shot AI call
│   ├── multi_turn.py               # Multi-turn conversation with session reuse
│   ├── list_models.py              # Discover available models
│   ├── health_check.py             # Check sidecar availability
│   ├── parallel_tasks.py           # Parallel AI calls with concurrency limit
│   ├── usage_tracking.py           # Pluggable usage recording
│   ├── provider_status.py          # Per-provider registration/auth diagnostics via SidecarClient.get_model_provider_status()
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

- Use `logger.*` from `src/logger.ts` (wraps `console.*` with `PI_SIDECAR_LOG_LEVEL` gating)
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

Sessions accept an optional `custom_tools` array at creation time. Each entry must be a plain object (not an array) with a non-empty string `name` property; entries failing this check are rejected with a 400. The default builtin tool set is defined by `DEFAULT_TOOLS` (`read`, `grep`, `find`, `ls`, `bash`). Callers can override the builtin tools by passing a `tools` array in `POST /sessions`, or extend with custom tools via `custom_tools`. Never add domain-specific tools to the sidecar itself.

Custom tools with an `http` property are automatically wrapped with the HTTP tool executor (`src/http-tool-executor.ts`), which interpolates `{paramName}` placeholders in URLs, headers, query params, and body templates. The executor includes security hardening: URI-encoding in URL paths (path traversal / URL injection mitigation), URL scheme validation (http/https only), CRLF stripping in headers, JSON-escaping in object body templates, request timeouts (30s default), and response size limits (1MB). Note: host allowlisting and private-network blocking are not implemented — callers are responsible for restricting target hosts if needed.

### 3. Watchdog is opt-in

`startWatchdog()` monitors a companion backend's health endpoint. It waits a 60 s grace period before starting checks, then polls every 30 s and shuts down the sidecar after 6 consecutive failures (~3 min). All timings are configurable via `WatchdogOptions` (`intervalMs`, `timeoutMs`, `maxFailures`, `startDelayMs`). It is **opt-in** — activated only when a `watchdogUrl` parameter is passed to `startSidecar()` or the `SIDECAR_WATCHDOG_URL` environment variable is set. Standalone usage works without a watchdog. Consumers with companion backends (like rootcoz) opt in by providing the health URL (e.g. `http://localhost:8000/health`).

### 4. Localhost-only by default (trust model)

The HTTP server binds to `127.0.0.1` unless overridden by `startSidecar({ host })`, `SIDECAR_HOST`, or `DEV_MODE=true` (which opens `0.0.0.0`). Precedence is options → `SIDECAR_HOST` → `DEV_MODE` → localhost. There is **no authentication** on the sidecar API — security relies on the network boundary. Do not add auth; instead, keep the server local and use the Python client from the same host.

`GET /models/:provider/status` is an intentional diagnostic endpoint under this same trust model: it returns registration state, model count, and raw `checkAuth()`/`getProviderAuthStatus()` output for a provider — including auth-configuration detail beyond a simple boolean — so operators can debug "why isn't provider X showing models" without grepping logs. On loopback binds this is deliberate: any caller who can reach the endpoint could already create sessions and use every configured provider's models, so the diagnostic detail doesn't cross a new trust boundary. When the bind host is non-loopback (`SIDECAR_HOST` / `DEV_MODE=true` / `startSidecar({ host })`), `authStatus`/`authCheck` are redacted to `{ configured }` / `{ type }` only (no `source`/`label`) before the response is sent.

### 5. ACPX model discovery uses `acpx/runtime` library, not CLI

Model discovery for ACPX agents (e.g., Cursor) uses the `acpx/runtime` library API (`createAcpRuntime` → `ensureSession` → `getStatus`) instead of spawning `acpx --model __list__` as a subprocess and parsing stderr. The library approach is more reliable (no text parsing), provides proper error handling, and returns model IDs with their full bracket-notation options (e.g. `gpt-5.4[context=272k,reasoning=medium]`). Discovery has a 30 s timeout per agent. Enabled via `ACPX_AGENTS`. Models appear under provider `acpx-<agent>`. Builtin placeholder models whose base IDs match ACPX discoveries are filtered out (ACPX wins); providers are never merged with `cli-*`.

### 5b. CLI provider discovery (`cli-*`) via pi-config cli-provider

Parallel to ACPX: set `CLI_AGENTS` (e.g. `cursor` or `claude,gemini,cursor`) to discover and expose `cli-*` providers. Sidecar loads `extensions/cli-provider/index.ts` from `pi-orchestrator-config` (≥ v3.16.0) into the internal `AgentSessionRuntime` (see Key Design Decision 11); models are primarily read off the live `cli-<agent>` provider on the shared `ModelRuntime` via `snapshotExtensionModels()`, with the extension's exported `discoverCliModels()` (loaded at runtime with jiti) as a fallback when the provider isn't registered yet.

**Caller selects source via `provider`:**
| Source | Env | Provider id | Example |
|--------|-----|-------------|---------|
| Builtin / API | — | `google`, `litellm`, … | `provider=google`, `model=gemini-2.5-flash` |
| ACPX | `ACPX_AGENTS` | `acpx-<agent>` | `provider=acpx-cursor`, `model=cursor:…[…]` |
| CLI | `CLI_AGENTS` | `cli-<agent>` | `provider=cli-cursor`, `model=cursor:composer-2.5` |

`GET /models` returns three groups (builtins after ACPX base-ID placeholder dedup, then acpx, then cli). No acpx↔cli merge. `cli-*` model ids are CLI `--model` values; `acpx-*` ids use bracket notation — never cross-feed. Listing awaits ModelRuntime init so builtins are not empty during startup races.

Override the extension path with `SIDECAR_CLI_PROVIDER_EXTENSION_PATH`. Fallback discovery loads `discoverCliModels` via jiti from that same entry (not a private sibling module).

### 6. Resource loading via `cwd` and `agent_dir`

The Pi SDK's `DefaultResourceLoader` loads project-level resources from `{cwd}/.pi/` (skills, prompts, extensions, themes) and `AGENTS.md` from `{cwd}/`. Callers control this by setting `cwd` in `POST /sessions`. The optional `agent_dir` parameter provides a **per-session** user-level resource directory for that loader (skills, prompts, `{agentDir}/agents/` for subagent discovery); it defaults to `/tmp/pi-sidecar-agent` when omitted. Validation requires `agent_dir` to be an absolute path pointing to an existing directory. In `DEV_MODE`, `agent_dir` is type-checked but path validation is skipped and the value is discarded with a warning log, preventing remote callers from steering resource loading.

`agent_dir` does **not** reconfigure the process-wide internal registrar runtime or shared `ModelRuntime` (ACPX/CLI provider registration). That runtime always uses a fixed `INTERNAL_AGENT_DIR` (`/tmp/pi-sidecar-agent`) because ACPX/CLI extensions hold module-level state that must load once per process (see Key Design Decision 11).

### 7. Subagent tool loaded as an SDK extension

The `subagent` tool delegates tasks to specialized agents by spawning isolated `pi --mode json` subprocesses. It supports single, parallel (max 8, 4 concurrent), and chain modes with `{previous}` placeholder interpolation.

The tool is **not a built-in** — it ships as a Pi extension at `@earendil-works/pi-coding-agent/examples/extensions/subagent/index.ts` and is loaded via `additionalExtensionPaths` (same mechanism as ACPX, CLI, and Vertex extensions). The SDK's jiti-based extension loader transpiles it at runtime and resolves all imports (`@earendil-works/pi-tui`, `typebox`, etc.) via virtual modules. The TUI rendering methods (`renderCall`/`renderResult`) are optional and never called in headless mode.

The extension is loaded for all sessions. Callers make the tool available to the AI by including `"subagent"` in the `tools` array at session creation. Session creation rejects with a 400 error if `"subagent"` is in the `tools` array but the extension could not be loaded. Agents are discovered from markdown files with YAML frontmatter in `{agentDir}/agents/` (user-level) and `{cwd}/.pi/agents/` (project-level, requires `agentScope: "both"`).

Override the extension path with the `SIDECAR_SUBAGENT_EXTENSION_PATH` environment variable.

### 8. Subagent subprocess compatibility (`process.argv[1]` and PATH)

The sidecar applies two fixes to ensure the subagent extension spawns `pi` correctly:

1. **`process.argv[1] = ""`** — Applied in `src/server.ts` (CLI entry point only, not `startSidecar()`) to avoid clobbering `argv[1]` for programmatic consumers. The subagent extension's `getPiInvocation()` checks `process.argv[1]` — if it exists as a file, it runs `node <that-file> --mode json ...` instead of `pi --mode json ...`. In the sidecar context, `argv[1]` points to the sidecar's own entry script (`src/server.ts` or `dist/server.js`), which would re-run the sidecar. Clearing it forces the fallback to `{ command: "pi", args }`.

2. **PATH filtering** — Applied in `startSidecar()` in `src/index.ts`. The sidecar's `node_modules/.bin/` contains a local `pi` binary from its `@earendil-works/pi-coding-agent` dependency, which may be a different version than the globally installed `pi`. If the local version is older, the spawned subprocess will fail with extension loading errors (e.g., missing APIs). The fix derives the sidecar's install root from `import.meta.url` (not `process.cwd()`) and conditionally strips `node_modules/.bin` directories from PATH — both the sidecar's own `.bin` and any ancestor `node_modules/.bin` directories containing a hoisted `pi` binary. The strip is guarded by checking whether a `pi` binary exists as a file in any of the remaining PATH directories (accounting for platform-specific names like `pi.cmd`/`pi.exe` on Windows) — if `pi` would not be reachable after removal, the local entries are kept to avoid breaking subagent invocations entirely (logged as `PATH_FILTER_SKIPPED`).

### 9. Extension path resolution with ESM fallback

`resolveExtensionPath()` locates extension entry files by finding a package's root directory. The primary strategy uses `require.resolve('pkg/package.json')`, which works for CJS packages. For ESM-only packages with strict `exports` (like `@earendil-works/pi-coding-agent`), this throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. The fallback uses `require.resolve.paths()` to get `node_modules` search directories, then walks them to find `package.json` without triggering exports validation. Extensions (ACPX, CLI provider, Vertex, Subagent) support path overrides via `SIDECAR_ACPX_EXTENSION_PATH`, `SIDECAR_CLI_PROVIDER_EXTENSION_PATH`, `SIDECAR_VERTEX_EXTENSION_PATH`, and `SIDECAR_SUBAGENT_EXTENSION_PATH` environment variables.

### 10. Root `package.json` overrides pin CVE floors

Sidecar root `package.json` `overrides` pin CVE floors:

- `brace-expansion` `>=5.0.7 <6` — sidecar-owned (from `pi-coding-agent`)
- `adm-zip` `0.6.0` and `protobufjs` `7.6.5` — root mirrors of `pi-orchestrator-config` ≥3.16.0 pins

npm only honors overrides from the **root** `package.json`; overrides inside `pi-orchestrator-config` do not apply to the sidecar install tree. Do not use nested `onnxruntime-node` stubs — root overrides are the supported approach.

**Known gap — `@earendil-works/pi-coding-agent`'s vendored `npm-shrinkwrap.json` seals its `protobufjs` pin against root overrides.** `@earendil-works/pi-coding-agent` ships its own `npm-shrinkwrap.json`, which npm treats as authoritative for that package's entire dependency subtree — **neither** the flat `protobufjs` override **nor** a nested `"@earendil-works/pi-coding-agent": { "protobufjs": "7.6.5" }` override can reach into it (verified: both `npm install` and `npm audit fix` leave `node_modules/@earendil-works/pi-coding-agent/node_modules/protobufjs` at the vendor-shrinkwrapped `7.6.4`, which is one patch behind the `7.5.0–7.6.4` DoS advisory [GHSA-j3f2-48v5-ccww](https://github.com/advisories/GHSA-j3f2-48v5-ccww)). Hand-editing `package-lock.json`'s entry for that nested path does **not** fix this either — `npm ci` re-derives shrinkwrapped subtrees from the vendor's shrinkwrap at install time regardless of what the parent lockfile says, so a hand-edit only makes `npm audit` report clean while the vulnerable version is still what actually gets installed. **Do not hand-edit that lockfile entry** — it creates a false-negative audit signal. The nested override stays in `package.json` as forward-compatible documentation (it will start working automatically if `pi-coding-agent` ever drops its shrinkwrap or bumps its own pin) but currently has no effect on npm's resolver.

**Mitigation — `scripts/enforce-protobufjs-floor.mjs` (postinstall):** after every `npm install`/`npm ci`, replace the nested sealed `protobufjs` copy with the root override version (`7.6.5`) when it is still below the floor. This does not change npm's lockfile story, but it does make the on-disk tree match the CVE floor the override declares. Re-check on every `@earendil-works/pi-coding-agent` bump; drop the script once upstream's shrinkwrap pins `>=7.6.5`.

This remains low-risk for the sidecar: the DoS requires parsing an attacker-supplied `.proto` file with malicious option definitions, and the sidecar never parses user-supplied `.proto` schemas — `protobufjs` is pulled in transitively via `@google/genai`'s Vertex/Gemini plumbing.

### 11. Persistent internal `AgentSessionRuntime` for extension/model lifecycle

`SessionStore` maintains a single, lazily-created `internalRuntime: AgentSessionRuntime` (via `createAgentSessionRuntime`) that loads ACPX, CLI provider, Vertex, and Subagent extensions **once** per process. This is required because ACPX and CLI provider extensions hold module-level state (an `agents` Map) that would be corrupted by concurrent or repeated loads — never instantiate more than one runtime that loads these extensions.

- **Model discovery**: `refreshModels()` ensures the internal runtime exists (first call triggers extension load + discovery), then on subsequent calls runs `modelRuntime.refresh({ force: true })` and re-snapshots. `snapshotExtensionModels()` reads live models off each `acpx-<agent>` / `cli-<agent>` provider on the shared `ModelRuntime` into the `acpxModels` / `cliModels` caches used by `getModels()` and `create()`. A jiti-based fallback (`discoverAcpxModels` / `discoverCliModels`, loaded from the extension's own exports — never inlined) covers the case where a provider isn't registered yet.
- **User sessions**: created against `this.modelRuntime` (shared with the internal runtime) and resolve ACPX/CLI models via `modelRuntime.getModel(provider, id)` **without** reloading ACPX/CLI extensions. User sessions only load Subagent (+ Vertex) extensions themselves.
- **Dispose vs. `session_shutdown`**: `AgentSessionRuntime.dispose()` emits a `session_shutdown` event that ACPX/CLI extensions listen for to clear their module-level state. A plain `session.dispose()` (used for user sessions) does **not** emit this event and is safe only because user sessions never own ACPX/CLI `AgentState`. Never rely on a bare session dispose to reset the internal registrar.
- **Shutdown order**: `disposeAll()` is `async` — it disposes all user sessions first, then `await`s `internalRuntime.dispose()` last, then clears refs. `close()` in `src/index.ts` and the watchdog's `onDead` callback both `await` `disposeAll()`.
- **`getProviderStatus(provider)`**: returns registration/auth status (`checkAuth`, `getProviderAuthStatus`) plus a model count sourced from the ACPX/CLI cache (extension providers) or the live provider (builtins). Exposed via `GET /models/:provider/status` (**404** when the provider is not registered on the shared `ModelRuntime`; **200** when it is). Store method returns full auth detail; the HTTP layer applies §4 redaction on non-loopback binds (`authStatus`/`authCheck` → `{ configured }` / `{ type }` only). Mirrored in the Python client as `SidecarClient.get_model_provider_status()` (not a module-level helper like `call_ai`/`list_models` — call it via the client instance/singleton; raises on HTTP 404 via httpx).

### 12. Pi SDK version floor is enforced fail-fast; `peerDependencies` mirror it as documentation

`src/pi-version.ts` defines `MIN_PI_VERSION` (currently `0.81.1`) and `assertPiVersionFloor()`, called at the very start of `startSidecar()` (before the PATH fix or server creation). It resolves the *installed* `@earendil-works/pi-coding-agent` version via `resolveExtensionPathDetailed()` (see Key Design Decision 9 — plain `require.resolve` would throw on this ESM-only package) and **throws** if the version can't be resolved or is below the floor. This is intentionally fail-fast: a stale SDK install would otherwise surface as confusing runtime errors much later (e.g. `createProvider()`-based ACPX/CLI providers silently failing to register), rather than a clear startup error naming the exact required version. It also does a best-effort, warn-only check of the `pi` binary on `PATH` (see Key Design Decision 8) since a stale global `pi` breaks subagent subprocess calls independently of the sidecar's own dependency version.

`package.json` declares matching `peerDependencies` (`@earendil-works/pi-coding-agent`/`@earendil-works/pi-ai` `>=0.81.1`) alongside the pinned `dependencies` (`^0.81.1`). The two ranges serve different purposes and are not a mismatch: `dependencies` pins what this package installs and tests against (caret range — accepts non-breaking updates); `peerDependencies` documents the *minimum* a host application embedding `startSidecar()` programmatically must provide, matching `MIN_PI_VERSION` exactly so `npm install` warns loudly if a consumer's own SDK version is too old — `assertPiVersionFloor()` is the runtime enforcement, `peerDependencies` is the install-time signal.

## Generated Documentation

The `docs/` directory contains AI-generated documentation from docsfy.
**NEVER edit these files manually.** To update documentation, regenerate using docsfy.

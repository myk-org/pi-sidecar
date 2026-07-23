# Runtime Architecture

The Pi Sidecar is a lightweight HTTP wrapper around the Pi Coding Agent SDK, but internally it manages complex state, dynamically loaded extensions, and isolated subprocesses. Understanding the sidecar's runtime architecture helps you optimize performance, avoid state-leakage pitfalls, and debug issues with model discovery or subagent execution.

## The Big Picture

When an HTTP request arrives, it doesn't just blindly instantiate an SDK object. It navigates a layered architecture designed to keep transient user data isolated while sharing heavy provider extensions across the process.

| Layer | Scope | Responsibility |
|---|---|---|
| **HTTP Server** | Process | Receives requests, enforces loopback-only trust boundaries, and parses JSON payloads. |
| **Session Store** | Process | Manages the lifecycle of transient user sessions and routes requests to the correct runtime. |
| **Internal Runtime & Shared ModelRuntime** | Process (Singleton) | Loads stateful extensions (ACPX, CLI, Vertex) exactly once. Caches available models globally. |
| **User Sessions** | Transient (Per-conversation) | Houses isolated conversation histories, custom tools, and session-specific resource directories. |

## Key Concepts

### The Shared Internal Runtime
The sidecar relies on a singleton internal runtime. Extensions for ACPX (like Cursor) and CLI providers hold module-level state—such as maps of active agents or authenticated backend connections. If the sidecar loaded these extensions from scratch on every request, this state would be corrupted, duplicated, or race against itself. 

Instead, the sidecar lazily creates one internal runtime on the first request (or when the models endpoint is queried). This runtime uses a fixed internal directory and acts as the single source of truth for provider discovery.

> **Note:** Do not attempt to reset provider state by simply deleting a user session. The shared ModelRuntime persists across all user sessions until the entire sidecar process shuts down.

### Module Caching and Extension Loading
Extensions are transpiled and loaded at runtime using an internal module loader. Because these extensions are cached in memory:
1. **Global vs. Local State:** User sessions connect to the shared `ModelRuntime` to resolve models *without* reloading extensions, keeping session startup virtually instantaneous.
2. **Shutdown Sequences:** When the server shuts down, an explicit `session_shutdown` event is emitted. This signals the cached ACPX/CLI extensions to cleanly flush their module-level state. A standard user session disposal does *not* trigger this flush.

### Subagent Process Handling
When a user session utilizes the `subagent` tool, the sidecar does not run the subagent in the same memory space. It delegates the task by spawning a completely isolated `pi --mode json` subprocess. 

The sidecar ensures this works reliably across different environments through two architectural interventions:
* **Subprocess Entrypoint Masking:** The sidecar deliberately clears the `process.argv[1]` variable during startup. If left intact, the subagent would mistakenly try to execute the sidecar's own entry script instead of the default `pi` CLI binary.
* **PATH Filtering:** The sidecar dynamically filters the `PATH` environment variable. It strips out local `node_modules/.bin` directories that might contain an older, incompatible version of the `pi` binary, ensuring the subagent executes the correct system-level agent.

## How it Affects the User

* **Resource Paths:** Because the internal runtime is a singleton, provider configurations (like ACPX and CLI models) are loaded once from a fixed system directory. However, you can still supply a custom `agent_dir` in your session requests to strictly isolate user-level prompts, custom tools, and skills per conversation.
* **Performance:** Multi-turn conversations and parallel session creations are extremely fast. The heavy lifting of transpiling extensions and polling ACPX backends happens asynchronously in the shared runtime, not during your blocking HTTP request.
* **Trust Boundary:** The architecture assumes a local trust model. There is no built-in authentication layer on the API because the HTTP server restricts operations to the local loopback interface by default. 

## Related Pages

* See [Configuring Model Providers](configuring-providers.html) for details on how the shared runtime exposes ACPX and CLI models.
* See [Orchestrating Subagents](orchestrating-subagents.html) for configuring the isolated subprocesses and delegating tasks.
* See [Managing AI Conversations](managing-conversations.html) for handling transient user sessions and isolating resource directories.

## Related Pages

- [Server Deployment Scenarios](server-deployment-scenarios.html)
- [Configuring Model Providers](configuring-providers.html)
- [Orchestrating Subagents](orchestrating-subagents.html)
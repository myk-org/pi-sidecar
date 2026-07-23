# Orchestrating Subagents

Delegate parallel or chained tasks to specialized agents. This allows a primary AI session to break down complex workloads and spawn isolated subprocesses to handle specific domains automatically.

## Prerequisites

- Python 3.10+
- The `pi_sidecar_client` library installed (see [Quickstart](quickstart.html))
- At least one specialized agent definition file (Markdown with YAML frontmatter)

## Quick Example

First, define a specialized agent in your agent directory (e.g., `/tmp/pi-sidecar-agent/agents/reviewer.md`):

```markdown
---
name: reviewer
description: Reviews code for security issues.
---
# Reviewer Agent
You are a strict security reviewer. Identify any vulnerabilities in the provided code snippet.
```

Then, enable the `subagent` tool when initializing an AI call using the Python client:

```python
import asyncio
from pi_sidecar_client import call_ai_once

async def main():
    result = await call_ai_once(
        prompt="Ask the 'reviewer' agent to review this code: `console.log(password)`",
        tools=["subagent"],
        agent_dir="/tmp/pi-sidecar-agent"
    )
    print(result.text)

if __name__ == "__main__":
    asyncio.run(main())
```

## Step-by-Step Guide

1. **Define Subagents:** Create Markdown files with YAML frontmatter in your global agent directory (`{agentDir}/agents/`) or your project directory (`{cwd}/.pi/agents/`). The `name` and `description` in the frontmatter help the primary agent understand what the subagent can do. (Note: Project-level agents require configuring `agentScope: "both"`).
2. **Enable the Subagent Tool:** When initializing an AI conversation, include `"subagent"` in the `tools` array. If the extension is unavailable, the sidecar will reject the session creation.
3. **Prompt the Primary Agent:** Ask your primary AI session to delegate tasks in plain text. The AI will automatically determine whether to spawn a single subagent, parallel instances, or chained subagents based on your instructions.
4. **Subprocess Isolation:** The sidecar automatically spawns an isolated process for each subagent, ensuring the execution context remains completely separated from the primary session.

## Advanced Usage

### Parallel Execution

The subagent tool supports spawning multiple agents simultaneously to speed up independent tasks. It can handle a maximum of 8 subagents per batch, with 4 running concurrently. 

```python
result = await call_ai_once(
    prompt="Ask the 'reviewer' agent to review 'auth.js' and the 'linter' agent to check 'styles.css' at the same time.",
    tools=["subagent"]
)
```

### Chained Execution

You can instruct the primary AI to chain subagents together. The output of one subagent becomes the input of another using a `{previous}` placeholder interpolation mechanism handled by the tool.

```python
result = await call_ai_once(
    prompt="Have the 'researcher' agent summarize the topic, then pass its output to the 'writer' agent to draft a blog post.",
    tools=["subagent"]
)
```

### Extension Path Overrides

If you need to load the subagent extension from a custom location instead of relying on the default package resolution, set the `SIDECAR_SUBAGENT_EXTENSION_PATH` environment variable before starting the sidecar. See [Environment Variables](environment-variables.html) for more details.

## Troubleshooting

- **Tool 'subagent' was requested but the extension could not be loaded:** The sidecar failed to locate the built-in subagent extension. Ensure your SDK installation is intact. If you are overriding the path, verify your environment variables.
- **Subagents are failing to spawn or returning errors:** Ensure the sidecar has access to a compatible CLI binary. The sidecar manages internal path filtering to ensure the correct binary is invoked, but if subagents fail immediately, check your system's path and ensure your global CLI installation isn't outdated compared to the sidecar dependencies.

## Related Pages

- [Extending Capabilities with Tools](extending-with-tools.html)
- [Python Integration Patterns](python-integration-patterns.html)
- [Runtime Architecture](runtime-architecture.html)
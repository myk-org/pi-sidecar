// Clear process.argv[1] so the subagent extension's getPiInvocation() falls
// through to `{ command: "pi", args }` instead of re-running the sidecar.
// Without this, it would try `node src/server.ts --mode json ...` which fails.
// TODO(#45): Remove if getPiInvocation() gains an override or sidecar detection.
process.argv[1] = "";

// Strip the sidecar's own node_modules/.bin from PATH so the subagent extension
// spawns the globally installed `pi` binary, not the local dependency (which may
// be a different version and cause extension loading errors in the subprocess).
if (process.env.PATH) {
  const cwd = process.cwd();
  const parts = process.env.PATH.split(":"); // Unix-only; sidecar targets Linux/Docker containers
  const kept = parts.filter((p) => !p.startsWith(cwd + "/node_modules/.bin"));
  const stripped = parts.length - kept.length;
  if (stripped > 0) {
    // eslint-disable-next-line no-console
    console.debug(`[sidecar] Stripped ${stripped} local node_modules/.bin entries from PATH`);
  }
  process.env.PATH = kept.join(":");
}

import { startSidecar } from "./index.js";
const handle = startSidecar();

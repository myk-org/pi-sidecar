import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accessSync } from "node:fs";

import { resolveExtensionPath } from "../../src/sessions.js";

describe("subagent extension integration", () => {
  it("resolves the subagent extension path from @earendil-works/pi-coding-agent", () => {
    const extPath = resolveExtensionPath(
      "UNUSED_ENV_" + Date.now(),
      "@earendil-works/pi-coding-agent",
      "examples/extensions/subagent/index.ts",
    );
    assert.ok(extPath.length > 0, "extension path should resolve");
    assert.ok(
      extPath.replaceAll("\\", "/").endsWith("examples/extensions/subagent/index.ts"),
      `should end with extension entry file, got: ${extPath}`,
    );
    // Verify the file actually exists on disk
    assert.doesNotThrow(() => accessSync(extPath), `extension file should exist at: ${extPath}`);
  });

  it("resolves the agents.ts companion module alongside the extension", () => {
    const extPath = resolveExtensionPath(
      "UNUSED_ENV_" + Date.now(),
      "@earendil-works/pi-coding-agent",
      "examples/extensions/subagent/agents.ts",
    );
    assert.ok(extPath.length > 0, "agents.ts path should resolve");
    assert.doesNotThrow(() => accessSync(extPath), `agents.ts should exist at: ${extPath}`);
  });

  it("respects SIDECAR_SUBAGENT_EXTENSION_PATH env var override", () => {
    const envVar = "SIDECAR_SUBAGENT_EXTENSION_PATH";
    const original = process.env[envVar];
    try {
      process.env[envVar] = "/custom/override/path.ts";
      const result = resolveExtensionPath(envVar, "@earendil-works/pi-coding-agent", "examples/extensions/subagent/index.ts");
      assert.equal(result, "/custom/override/path.ts", "should use env var when set");
    } finally {
      if (original !== undefined) {
        process.env[envVar] = original;
      } else {
        delete process.env[envVar];
      }
    }
  });

  it("rejects session with subagent tool when extension path is empty", async () => {
    // This tests the validation logic indirectly — when SUBAGENT_EXTENSION resolves
    // to "" (package not found), and the caller requests tools: ["subagent"],
    // session creation should throw.
    // We can't easily test this without mocking the module-level constant,
    // so we verify the resolveExtensionPath returns "" for a nonexistent package.
    const result = resolveExtensionPath(
      "UNUSED_ENV_" + Date.now(),
      "nonexistent-package-that-will-never-exist-12345",
      "index.ts",
    );
    assert.equal(result, "", "nonexistent package should return empty string");
  });
});

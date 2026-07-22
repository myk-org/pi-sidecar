import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accessSync } from "node:fs";
import { dirname, join } from "node:path";

import { createJiti } from "jiti";

import { resolveExtensionPath } from "../../src/resolve-extension-path.js";

describe("cli-provider extension integration", () => {
  it("resolves the cli-provider extension path from pi-orchestrator-config", () => {
    const extPath = resolveExtensionPath(
      "UNUSED_ENV_" + Date.now(),
      "pi-orchestrator-config",
      "extensions/cli-provider/index.ts",
    );
    assert.ok(extPath.length > 0, "extension path should resolve");
    assert.ok(
      extPath.replaceAll("\\", "/").endsWith("extensions/cli-provider/index.ts"),
      `should end with extension entry file, got: ${extPath}`,
    );
    assert.doesNotThrow(() => accessSync(extPath), `extension file should exist at: ${extPath}`);
  });

  it("resolves discover.ts alongside the extension entry", () => {
    const extPath = resolveExtensionPath(
      "UNUSED_ENV_" + Date.now(),
      "pi-orchestrator-config",
      "extensions/cli-provider/index.ts",
    );
    const discoverPath = join(dirname(extPath), "discover.ts");
    assert.doesNotThrow(() => accessSync(discoverPath), `discover.ts should exist at: ${discoverPath}`);
  });

  it("respects SIDECAR_CLI_PROVIDER_EXTENSION_PATH-style env override", () => {
    const envVar = "TEST_CLI_PROVIDER_EXT_PATH_" + Date.now();
    try {
      process.env[envVar] = "/custom/override/cli-provider/index.ts";
      const result = resolveExtensionPath(envVar, "pi-orchestrator-config", "extensions/cli-provider/index.ts");
      assert.equal(result, "/custom/override/cli-provider/index.ts", "should use env var when set");
    } finally {
      delete process.env[envVar];
    }
  });

  it("exports discoverCliModels from discover.ts (no live CLI discovery in unit tests)", () => {
    const discoverPath = resolveExtensionPath(
      "UNUSED_ENV_" + Date.now(),
      "pi-orchestrator-config",
      "extensions/cli-provider/discover.ts",
    );
    assert.ok(discoverPath.length > 0, "discover.ts should resolve");

    // Load the module only to assert the export shape — do NOT call
    // discoverCliModels() here (that would spawn/query real CLI agents).
    const jiti = createJiti(import.meta.url);
    const mod = jiti(discoverPath) as {
      discoverCliModels?: (agent: string) => Promise<Array<{ id: string; name: string; provider: string }>>;
      default?: { discoverCliModels: (agent: string) => Promise<Array<{ id: string; name: string; provider: string }>> };
    };
    const discoverCliModels = mod.discoverCliModels ?? mod.default?.discoverCliModels;
    assert.equal(typeof discoverCliModels, "function", "discoverCliModels should be exported");
  });
});

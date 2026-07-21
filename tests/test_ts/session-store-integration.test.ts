import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { SessionStore } from "../../src/sessions.js";

/**
 * Real (non-mocked) integration tests for SessionStore's internal-runtime
 * lifecycle. ACPX_AGENTS/CLI_AGENTS are cleared for the duration of this
 * file so results are hermetic regardless of the host environment — the
 * acpx/cli-provider-integration test files cover live agent discovery.
 *
 * This still exercises the real @earendil-works/pi-coding-agent SDK
 * (createAgentSessionRuntime, ModelRuntime, DefaultResourceLoader loading the
 * Vertex/Subagent extensions), so it is slower than the rest of the suite.
 */
describe("SessionStore internal runtime integration", () => {
  let savedAcpxAgents: string | undefined;
  let savedCliAgents: string | undefined;
  let store: SessionStore;

  before(() => {
    savedAcpxAgents = process.env.ACPX_AGENTS;
    savedCliAgents = process.env.CLI_AGENTS;
    delete process.env.ACPX_AGENTS;
    delete process.env.CLI_AGENTS;
    store = new SessionStore();
  });

  after(async () => {
    await store.disposeAll();
    if (savedAcpxAgents !== undefined) process.env.ACPX_AGENTS = savedAcpxAgents;
    if (savedCliAgents !== undefined) process.env.CLI_AGENTS = savedCliAgents;
  });

  it("is not ready before any discovery has run", () => {
    assert.equal(store.ready, false);
    assert.equal(store.discoveryError, null);
    assert.equal(store.count(), 0);
  });

  it("refreshModels() creates the internal runtime and lists builtin models", async () => {
    const models = await store.refreshModels();
    assert.ok(Array.isArray(models));
    assert.ok(models.length > 0, "should list at least the builtin catalog");
    assert.ok(models.some((m) => m.provider === "google"), "should include google builtins");
    // No agents configured — acpx-*/cli-* sources must be empty.
    assert.ok(!models.some((m) => m.provider.startsWith("acpx-")));
    assert.ok(!models.some((m) => m.provider.startsWith("cli-")));

    assert.equal(store.ready, true);
    assert.equal(store.discoveryError, null);
  });

  it("refreshModels() can be called again without recreating the internal runtime", async () => {
    const first = await store.refreshModels();
    const second = await store.refreshModels();
    assert.equal(second.length, first.length);
    assert.equal(store.discoveryError, null);
  });

  it("getModels() matches the most recent refreshModels() snapshot", async () => {
    const refreshed = await store.refreshModels();
    const listed = await store.getModels();
    assert.deepEqual(
      listed.map((m) => m.id).sort(),
      refreshed.map((m) => m.id).sort(),
    );
  });

  it("getProviderStatus() reports a registered builtin provider with a positive model count", async () => {
    await store.refreshModels();
    const status = await store.getProviderStatus("google");
    assert.equal(status.provider, "google");
    assert.equal(status.registered, true);
    assert.ok(status.modelCount > 0);
    assert.ok(status.authStatus && typeof status.authStatus.configured === "boolean");
  });

  it("getProviderStatus() reports registered=false and modelCount=0 for an unknown provider", async () => {
    const status = await store.getProviderStatus("totally-unknown-provider-xyz");
    assert.equal(status.registered, false);
    assert.equal(status.modelCount, 0);
  });

  it("getProviderStatus() reports zero models for acpx-*/cli-* providers when no agents are configured", async () => {
    await store.refreshModels();
    const acpxStatus = await store.getProviderStatus("acpx-cursor");
    const cliStatus = await store.getProviderStatus("cli-cursor");
    assert.equal(acpxStatus.modelCount, 0);
    assert.equal(cliStatus.modelCount, 0);
  });

  it("create() rejects an acpx-* model when ACPX_AGENTS is not configured", async () => {
    await store.refreshModels();
    await assert.rejects(
      () => store.create({ provider: "acpx-cursor", model: "cursor:default[]", systemPrompt: "test", cwd: "/tmp" }),
      /not found for provider 'acpx-cursor'/,
    );
  });

  it("create() rejects an unknown builtin model", async () => {
    await store.refreshModels();
    await assert.rejects(
      () => store.create({ provider: "google", model: "not-a-real-model-xyz", systemPrompt: "test", cwd: "/tmp" }),
      /not found for provider 'google'/,
    );
  });

  describe("concurrent sessions interleaved with refresh", () => {
    it("keeps the model catalog stable while sessions are created/deleted concurrently with refreshModels()", async () => {
      const baseline = await store.refreshModels();
      const googleModel = baseline.find((m) => m.provider === "google");
      assert.ok(googleModel, "precondition: at least one google builtin model must be available");
      const baselineIds = baseline.map((m) => `${m.provider}/${m.id}`).sort();

      // Fire create()/refreshModels()/getModels() concurrently — the internal
      // runtime must not be recreated or corrupted by interleaved access, and
      // refreshModels() calls must not race create()'s reads of the acpx/cli
      // caches (see the internalRuntime field docstring in src/sessions.ts).
      const concurrentCreates = Array.from({ length: 5 }, () =>
        store.create({ provider: "google", model: googleModel!.id, systemPrompt: "concurrent test", cwd: "/tmp" }),
      );
      const concurrentRefreshes = Array.from({ length: 3 }, () => store.refreshModels());

      const [sessionIds, refreshResults] = await Promise.all([
        Promise.all(concurrentCreates),
        Promise.all(concurrentRefreshes),
      ]);

      assert.equal(sessionIds.length, 5);
      assert.equal(new Set(sessionIds).size, 5, "all created session ids must be unique");
      assert.equal(store.count(), 5);
      for (const refreshed of refreshResults) {
        assert.deepEqual(
          refreshed.map((m) => `${m.provider}/${m.id}`).sort(),
          baselineIds,
          "every concurrent refreshModels() call must return the same stable catalog",
        );
      }

      // Interleave deletes for a subset of sessions with one more refresh.
      const [idsToDelete, idsToKeep] = [sessionIds.slice(0, 3), sessionIds.slice(3)];
      const [deleteResults, finalRefresh] = await Promise.all([
        Promise.all(idsToDelete.map((id) => store.delete(id))),
        store.refreshModels(),
      ]);

      assert.deepEqual(deleteResults, [true, true, true]);
      assert.equal(store.count(), idsToKeep.length);
      assert.deepEqual(
        finalRefresh.map((m) => `${m.provider}/${m.id}`).sort(),
        baselineIds,
        "catalog must remain stable after interleaved deletes + refresh",
      );

      const finalCatalog = await store.getModels();
      assert.deepEqual(
        finalCatalog.map((m) => `${m.provider}/${m.id}`).sort(),
        baselineIds,
        "getModels() must match the stable baseline after all concurrent activity",
      );

      // Clean up the surviving sessions so later tests in this file start clean.
      for (const id of idsToKeep) {
        assert.equal(store.delete(id), true);
      }
      assert.equal(store.count(), 0);
    });
  });
});

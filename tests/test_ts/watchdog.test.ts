import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// We need to mock fetch and setInterval before importing startWatchdog.
// Since startWatchdog uses globals directly, we mock them on globalThis.

describe("startWatchdog", () => {
  let intervalCallbacks: Array<() => void>;
  let originalSetInterval: typeof globalThis.setInterval;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    intervalCallbacks = [];
    originalSetInterval = globalThis.setInterval;
    originalFetch = globalThis.fetch;

    // Replace setInterval to capture callbacks without actually scheduling
    (globalThis as any).setInterval = (cb: () => void, _ms: number) => {
      intervalCallbacks.push(cb);
      return 999 as unknown as NodeJS.Timeout;
    };
  });

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.fetch = originalFetch;
  });

  // Re-import the module each time so it picks up our mocked globals
  async function loadWatchdog() {
    // Dynamic import with cache-busting query to get fresh module evaluation
    // is not reliable in Node. Instead, we inline the function logic since
    // startWatchdog captures setInterval at call time.
    //
    // Actually, startWatchdog calls setInterval directly in the function body,
    // so our globalThis mock will be captured when we call it.
    const { startWatchdog } = await import("../../src/watchdog.js");
    return startWatchdog;
  }

  it("calls onDead after MAX_FAILURES (3) consecutive failures", async () => {
    // Mock fetch to always reject
    globalThis.fetch = mock.fn(async () => {
      throw new Error("Connection refused");
    }) as any;

    const onDead = mock.fn();
    const startWatchdog = await loadWatchdog();
    startWatchdog("http://localhost:8000/health", onDead);

    assert.equal(intervalCallbacks.length, 1);
    const tick = intervalCallbacks[0];

    // Tick 1: failure #1
    await tick();
    assert.equal(onDead.mock.callCount(), 0);

    // Tick 2: failure #2
    await tick();
    assert.equal(onDead.mock.callCount(), 0);

    // Tick 3: failure #3 → onDead called
    await tick();
    assert.equal(onDead.mock.callCount(), 1);
  });

  it("resets failure count on successful health check", async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(async () => {
      callCount++;
      // Fail on calls 1 and 2, succeed on call 3, then fail again
      if (callCount <= 2) throw new Error("Connection refused");
      if (callCount === 3) return { ok: true } as Response;
      throw new Error("Connection refused");
    }) as any;

    const onDead = mock.fn();
    const startWatchdog = await loadWatchdog();
    startWatchdog("http://localhost:8000/health", onDead);

    const tick = intervalCallbacks[0];

    // Tick 1: failure #1
    await tick();
    assert.equal(onDead.mock.callCount(), 0);

    // Tick 2: failure #2
    await tick();
    assert.equal(onDead.mock.callCount(), 0);

    // Tick 3: success → resets counter
    await tick();
    assert.equal(onDead.mock.callCount(), 0);

    // Tick 4: failure #1 (reset)
    await tick();
    assert.equal(onDead.mock.callCount(), 0);

    // Tick 5: failure #2
    await tick();
    assert.equal(onDead.mock.callCount(), 0);

    // Still not dead — only 2 consecutive failures after reset
    assert.equal(onDead.mock.callCount(), 0);
  });

  it("handles non-OK responses as failures", async () => {
    globalThis.fetch = mock.fn(async () => {
      return { ok: false, status: 500 } as Response;
    }) as any;

    const onDead = mock.fn();
    const startWatchdog = await loadWatchdog();
    startWatchdog("http://localhost:8000/health", onDead);

    const tick = intervalCallbacks[0];

    // 3 non-OK responses should trigger onDead
    await tick();
    assert.equal(onDead.mock.callCount(), 0);

    await tick();
    assert.equal(onDead.mock.callCount(), 0);

    await tick();
    assert.equal(onDead.mock.callCount(), 1);
  });
});

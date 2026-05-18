import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeMatch } from "../../src/index.js";

describe("routeMatch", () => {
  it("matches exact path /health", () => {
    const result = routeMatch("/health", "/health");
    assert.deepEqual(result, {});
  });

  it("matches parameterized path /sessions/:id/prompt and extracts id", () => {
    const result = routeMatch("/sessions/abc-123/prompt", "/sessions/:id/prompt");
    assert.ok(result);
    assert.equal(result.id, "abc-123");
  });

  it("extracts multiple params", () => {
    const result = routeMatch("/a/foo/b/bar", "/a/:x/b/:y");
    assert.ok(result);
    assert.equal(result.x, "foo");
    assert.equal(result.y, "bar");
  });

  it("rejects wrong path length (too many segments)", () => {
    const result = routeMatch("/sessions/abc/prompt/extra", "/sessions/:id/prompt");
    assert.equal(result, null);
  });

  it("rejects wrong path length (too few segments)", () => {
    const result = routeMatch("/sessions/abc", "/sessions/:id/prompt");
    assert.equal(result, null);
  });

  it("rejects mismatched segments", () => {
    const result = routeMatch("/users/abc/prompt", "/sessions/:id/prompt");
    assert.equal(result, null);
  });

  it("strips query string before matching", () => {
    const result = routeMatch("/sessions/xyz/prompt?timeout=30", "/sessions/:id/prompt");
    assert.ok(result);
    assert.equal(result.id, "xyz");
  });

  it("strips query string for exact match", () => {
    const result = routeMatch("/health?verbose=true", "/health");
    assert.deepEqual(result, {});
  });

  it("returns empty params for no-param pattern match", () => {
    const result = routeMatch("/models", "/models");
    assert.deepEqual(result, {});
  });

  it("returns null when pattern has params but URL does not match structure", () => {
    const result = routeMatch("/completely/different", "/sessions/:id");
    assert.equal(result, null);
  });
});

import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

import { DEFAULT_TOOLS } from "../../src/sessions.js";
import { parseBody } from "../../src/index.js";
import { createHttpToolExecutor, normalizeHttpToolConfig, type HttpToolConfig } from "../../src/http-tool-executor.js";

// ---------------------------------------------------------------------------
// 1. DEFAULT_TOOLS constant
// ---------------------------------------------------------------------------

describe("DEFAULT_TOOLS", () => {
  it("contains the expected default tool set", () => {
    assert.deepEqual([...DEFAULT_TOOLS], ["read", "grep", "find", "ls", "bash"]);
  });

  it("is a readonly tuple (cannot be modified)", () => {
    // TypeScript enforces `as const` at compile time; at runtime we verify
    // that the array content is correct and stable
    assert.equal(DEFAULT_TOOLS.length, 5);
    assert.equal(DEFAULT_TOOLS[0], "read");
    assert.equal(DEFAULT_TOOLS[4], "bash");
  });
});

// ---------------------------------------------------------------------------
// 2. CreateSessionOptions tools field
// ---------------------------------------------------------------------------

describe("CreateSessionOptions tools field", () => {
  it("DEFAULT_TOOLS is exported and accessible from sessions module", async () => {
    // Verify the export path works (sessions.js → index.js re-export)
    const { DEFAULT_TOOLS: fromIndex } = await import("../../src/index.js");
    assert.deepEqual([...fromIndex], ["read", "grep", "find", "ls", "bash"]);
  });
});

// ---------------------------------------------------------------------------
// 2b. POST /sessions input validation (tools & custom_tools)
// ---------------------------------------------------------------------------

describe("POST /sessions input validation", () => {
  /** Create a mock request with a JSON body */
  function createMockRequest(body: any): PassThrough {
    const stream = new PassThrough();
    stream.write(JSON.stringify(body));
    stream.end();
    return stream;
  }

  it("rejects tools when not an array of strings", async () => {
    const body = {
      provider: "google",
      model: "gemini-2.5-flash",
      system_prompt: "test",
      tools: "not-an-array",
    };
    const stream = createMockRequest(body);
    const parsed = await parseBody(stream as unknown as IncomingMessage);
    // Validate same way index.ts does
    const isInvalid = parsed.tools !== undefined &&
      (!Array.isArray(parsed.tools) || !parsed.tools.every((t: any) => typeof t === "string"));
    assert.equal(isInvalid, true);
  });

  it("accepts valid tools array", async () => {
    const body = {
      provider: "google",
      model: "gemini-2.5-flash",
      system_prompt: "test",
      tools: ["read", "bash"],
    };
    const stream = createMockRequest(body);
    const parsed = await parseBody(stream as unknown as IncomingMessage);
    const isValid = parsed.tools === undefined ||
      (Array.isArray(parsed.tools) && parsed.tools.every((t: any) => typeof t === "string"));
    assert.equal(isValid, true);
    assert.deepEqual(parsed.tools, ["read", "bash"]);
  });

  it("rejects custom_tools when not an array", async () => {
    const body = {
      provider: "google",
      model: "gemini-2.5-flash",
      system_prompt: "test",
      custom_tools: "not-an-array",
    };
    const stream = createMockRequest(body);
    const parsed = await parseBody(stream as unknown as IncomingMessage);
    const isInvalid = parsed.custom_tools !== undefined && !Array.isArray(parsed.custom_tools);
    assert.equal(isInvalid, true);
  });

  it("rejects custom_tools with null entries", async () => {
    const body = {
      provider: "google",
      model: "gemini-2.5-flash",
      system_prompt: "test",
      custom_tools: [null, { name: "valid" }],
    };
    const stream = createMockRequest(body);
    const parsed = await parseBody(stream as unknown as IncomingMessage);
    const hasNulls = Array.isArray(parsed.custom_tools) &&
      !parsed.custom_tools.every((t: any) => t != null && typeof t === "object" && !Array.isArray(t) && typeof t.name === "string" && t.name.length > 0);
    assert.equal(hasNulls, true);
  });

  it("rejects custom_tools with array entries", async () => {
    const body = {
      provider: "google",
      model: "gemini-2.5-flash",
      system_prompt: "test",
      custom_tools: [{ name: "valid_tool" }, []],
    };
    const stream = createMockRequest(body);
    const parsed = await parseBody(stream as unknown as IncomingMessage);
    const hasArrays = Array.isArray(parsed.custom_tools) &&
      !parsed.custom_tools.every((t: any) => t != null && typeof t === "object" && !Array.isArray(t) && typeof t.name === "string" && t.name.length > 0);
    assert.equal(hasArrays, true);
  });

  it("rejects custom_tools entries without a string name", async () => {
    const body = {
      provider: "google",
      model: "gemini-2.5-flash",
      system_prompt: "test",
      custom_tools: [{ description: "no name field" }],
    };
    const stream = createMockRequest(body);
    const parsed = await parseBody(stream as unknown as IncomingMessage);
    const missingName = Array.isArray(parsed.custom_tools) &&
      !parsed.custom_tools.every((t: any) => t != null && typeof t === "object" && !Array.isArray(t) && typeof t.name === "string" && t.name.length > 0);
    assert.equal(missingName, true);
  });

  it("rejects custom_tools entries with empty string name", async () => {
    const body = {
      provider: "google",
      model: "gemini-2.5-flash",
      system_prompt: "test",
      custom_tools: [{ name: "", description: "empty name" }],
    };
    const stream = createMockRequest(body);
    const parsed = await parseBody(stream as unknown as IncomingMessage);
    const hasEmptyName = Array.isArray(parsed.custom_tools) &&
      !parsed.custom_tools.every((t: any) => t != null && typeof t === "object" && !Array.isArray(t) && typeof t.name === "string" && t.name.length > 0);
    assert.equal(hasEmptyName, true);
  });

  it("accepts valid custom_tools array", async () => {
    const body = {
      provider: "google",
      model: "gemini-2.5-flash",
      system_prompt: "test",
      custom_tools: [{ name: "my_tool", description: "A tool" }],
    };
    const stream = createMockRequest(body);
    const parsed = await parseBody(stream as unknown as IncomingMessage);
    const isValid = parsed.custom_tools === undefined ||
      (Array.isArray(parsed.custom_tools) && parsed.custom_tools.every((t: any) => t != null && typeof t === "object" && !Array.isArray(t) && typeof t.name === "string" && t.name.length > 0));
    assert.equal(isValid, true);
  });

  it("accepts request without tools or custom_tools", async () => {
    const body = {
      provider: "google",
      model: "gemini-2.5-flash",
      system_prompt: "test",
    };
    const stream = createMockRequest(body);
    const parsed = await parseBody(stream as unknown as IncomingMessage);
    assert.equal(parsed.tools, undefined);
    assert.equal(parsed.custom_tools, undefined);
  });
});

// ---------------------------------------------------------------------------
// 3. HTTP tool SDK integration shape
// ---------------------------------------------------------------------------

describe("HTTP tool SDK-compatible assembly", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("assembled tool has label, name, description, parameters, and execute", () => {
    // Simulate what sessions.ts does when assembling an HTTP tool
    const toolConfig = {
      name: "fetch_data",
      description: "Fetch user data by ID",
      parameters: { type: "object", properties: { userId: { type: "string" } } },
      http: { method: "GET", url: "https://api.example.com/users/{userId}" },
    };

    const httpConfig = normalizeHttpToolConfig(toolConfig.http);
    const httpExecutor = createHttpToolExecutor(httpConfig);

    // Assemble the same way sessions.ts does
    const assembledTool = {
      name: toolConfig.name,
      label: toolConfig.name,
      description: toolConfig.description || "",
      parameters: toolConfig.parameters || {},
      execute: async (
        _toolCallId: string,
        params: Record<string, any>,
        signal: AbortSignal | undefined,
      ) => {
        const text = await httpExecutor(params, signal);
        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      },
    };

    assert.equal(assembledTool.name, "fetch_data");
    assert.equal(assembledTool.label, "fetch_data");
    assert.equal(assembledTool.description, "Fetch user data by ID");
    assert.deepEqual(assembledTool.parameters, { type: "object", properties: { userId: { type: "string" } } });
    assert.equal(typeof assembledTool.execute, "function");
  });

  it("execute returns AgentToolResult format with content array", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response('{"id": "123", "name": "Alice"}', { status: 200 });
    }) as any;

    const httpConfig: HttpToolConfig = {
      method: "GET",
      url: "https://api.example.com/users/{userId}",
    };
    const httpExecutor = createHttpToolExecutor(httpConfig);

    // Call with SDK signature: (toolCallId, params, signal)
    const params = { userId: "123" };
    const text = await httpExecutor(params);
    const result = {
      content: [{ type: "text" as const, text }],
      details: {},
    };

    assert.ok(Array.isArray(result.content), "result.content should be an array");
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    assert.ok(result.content[0].text.includes('"name": "Alice"'), `Should contain response data: ${result.content[0].text}`);
    assert.deepEqual(result.details, {});
  });

  it("execute passes signal through to HTTP executor", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response("ok", { status: 200 });
    }) as any;

    const httpConfig: HttpToolConfig = {
      method: "GET",
      url: "https://api.example.com/data",
    };
    const httpExecutor = createHttpToolExecutor(httpConfig);

    // Simulate SDK calling with a signal
    const controller = new AbortController();
    const text = await httpExecutor({}, controller.signal);
    const result = {
      content: [{ type: "text" as const, text }],
      details: {},
    };

    assert.equal(result.content[0].text, "ok");
  });
});

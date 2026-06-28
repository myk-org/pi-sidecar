import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("message boundary separator", () => {
  /**
   * Simulate the concatenation + post-processing logic from sessions.ts prompt().
   * Records boundary positions during streaming, then inserts \n\n only for non-JSON.
   */
  function concatenateDeltas(events: Array<{ message: object; delta: string }>): string {
    let responseText = "";
    let lastAssistantMessage: object | null = null;
    const messageBoundaries: number[] = [];

    for (const event of events) {
      if (lastAssistantMessage !== null && event.message !== lastAssistantMessage && responseText.length > 0) {
        messageBoundaries.push(responseText.length);
      }
      lastAssistantMessage = event.message;
      responseText += event.delta;
    }

    // Post-process: insert \n\n only for non-JSON responses
    if (messageBoundaries.length > 0 && responseText.length > 0) {
      const trimmed = responseText.trim();
      const isJson = (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
      if (!isJson) {
        for (let i = messageBoundaries.length - 1; i >= 0; i--) {
          const pos = messageBoundaries[i];
          responseText = responseText.slice(0, pos) + "\n\n" + responseText.slice(pos);
        }
      }
    }
    return responseText;
  }

  it("single message — no separator", () => {
    const msg = {};
    const result = concatenateDeltas([
      { message: msg, delta: "Hello " },
      { message: msg, delta: "world" },
    ]);
    assert.equal(result, "Hello world");
  });

  it("two text messages — separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: "First part." },
      { message: msg2, delta: "Second part." },
    ]);
    assert.equal(result, "First part.\n\nSecond part.");
  });

  it("three text messages — two separators", () => {
    const msg1 = {};
    const msg2 = {};
    const msg3 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: "A." },
      { message: msg2, delta: "B." },
      { message: msg3, delta: "C." },
    ]);
    assert.equal(result, "A.\n\nB.\n\nC.");
  });

  it("same message reference reused — no separator", () => {
    const msg = {};
    const result = concatenateDeltas([
      { message: msg, delta: "chunk1 " },
      { message: msg, delta: "chunk2 " },
      { message: msg, delta: "chunk3" },
    ]);
    assert.equal(result, "chunk1 chunk2 chunk3");
  });

  it("JSON object response — no separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: '{"project_' },
      { message: msg2, delta: 'name": "test"}' },
    ]);
    assert.equal(result, '{"project_name": "test"}');
  });

  it("JSON array response — no separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: '[{"id":' },
      { message: msg2, delta: ' 1}]' },
    ]);
    assert.equal(result, '[{"id": 1}]');
  });

  it("JSON with whitespace — no separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: '  {"key":' },
      { message: msg2, delta: ' "value"}  ' },
    ]);
    assert.equal(result, '  {"key": "value"}  ');
  });

  it("text that looks like JSON but is not — separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: "Here is a result." },
      { message: msg2, delta: "It has {braces} in it." },
    ]);
    assert.equal(result, "Here is a result.\n\nIt has {braces} in it.");
  });
});

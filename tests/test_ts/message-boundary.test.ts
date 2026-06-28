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
      const looksLikeJson = (trimmed.charCodeAt(0) === 123 && trimmed.charCodeAt(trimmed.length - 1) === 125) ||
                            (trimmed.charCodeAt(0) === 91 && trimmed.charCodeAt(trimmed.length - 1) === 93);
      let isJson = false;
      if (looksLikeJson) {
        try {
          JSON.parse(responseText);
          isJson = true;
        } catch {
          // Not valid JSON
        }
      }
      if (!isJson) {
        const parts: string[] = [];
        let prev = 0;
        for (const pos of messageBoundaries) {
          parts.push(responseText.slice(prev, pos));
          prev = pos;
        }
        parts.push(responseText.slice(prev));
        responseText = parts.join("\n\n");
      }
    }
    return responseText;
  }

  // ===== TEXT RESPONSES (separators inserted) =====

  it("single text message — no separator", () => {
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

  it("text with braces in middle — separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: "Here is a result." },
      { message: msg2, delta: "It has {braces} in it." },
    ]);
    assert.equal(result, "Here is a result.\n\nIt has {braces} in it.");
  });

  it("malformed JSON with braces — separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: "{invalid" },
      { message: msg2, delta: " json}" },
    ]);
    assert.equal(result, "{invalid\n\n json}");
  });

  it("text starting with [ but not JSON — separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: "[INFO] Starting process." },
      { message: msg2, delta: "Process complete." },
    ]);
    assert.equal(result, "[INFO] Starting process.\n\nProcess complete.");
  });

  it("markdown with JSON fence — separator inserted (not valid JSON)", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: '```json\n{"key": "value"}\n```' },
      { message: msg2, delta: "Here is the explanation." },
    ]);
    assert.equal(result, '```json\n{"key": "value"}\n```\n\nHere is the explanation.');
  });

  it("text with square brackets wrapping — separator inserted (not valid JSON array)", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: "[note: this is" },
      { message: msg2, delta: " not json]" },
    ]);
    assert.equal(result, "[note: this is\n\n not json]");
  });

  // ===== JSON RESPONSES (no separators) =====

  it("JSON object — no separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: '{"project_' },
      { message: msg2, delta: 'name": "test"}' },
    ]);
    assert.equal(result, '{"project_name": "test"}');
    // Verify it's actually valid JSON
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it("JSON array — no separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: '[{"id":' },
      { message: msg2, delta: ' 1}]' },
    ]);
    assert.equal(result, '[{"id": 1}]');
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it("JSON with leading/trailing whitespace — no separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: '  {"key":' },
      { message: msg2, delta: ' "value"}  ' },
    ]);
    assert.equal(result, '  {"key": "value"}  ');
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it("nested JSON object — no separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const msg3 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: '{"nav": [{"group":' },
      { message: msg2, delta: ' "Overview", "pages":' },
      { message: msg3, delta: ' []}]}' },
    ]);
    assert.equal(result, '{"nav": [{"group": "Overview", "pages": []}]}');
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it("empty JSON object — no separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: "{" },
      { message: msg2, delta: "}" },
    ]);
    assert.equal(result, "{}");
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it("JSON array of strings — no separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: '["hello",' },
      { message: msg2, delta: ' "world"]' },
    ]);
    assert.equal(result, '["hello", "world"]');
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it("JSON with newlines inside — no separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: '{\n  "key":' },
      { message: msg2, delta: ' "value"\n}' },
    ]);
    assert.equal(result, '{\n  "key": "value"\n}');
    assert.doesNotThrow(() => JSON.parse(result));
  });

  // ===== EDGE CASES =====

  it("single-message JSON — no boundaries, passes through unchanged", () => {
    const msg = {};
    const result = concatenateDeltas([
      { message: msg, delta: '{"name": "test", "version": "1.0.0"}' },
    ]);
    assert.equal(result, '{"name": "test", "version": "1.0.0"}');
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it("empty response — no processing", () => {
    const result = concatenateDeltas([]);
    assert.equal(result, "");
  });

  it("no leading separator when first message has no prior text", () => {
    const msg = {};
    const result = concatenateDeltas([
      { message: msg, delta: "Only message" },
    ]);
    assert.equal(result, "Only message");
  });

  it("multi-chunk text with many boundaries — all separators inserted", () => {
    const msgs = [{}, {}, {}, {}, {}];
    const result = concatenateDeltas([
      { message: msgs[0], delta: "One." },
      { message: msgs[1], delta: "Two." },
      { message: msgs[2], delta: "Three." },
      { message: msgs[3], delta: "Four." },
      { message: msgs[4], delta: "Five." },
    ]);
    assert.equal(result, "One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.");
  });
});

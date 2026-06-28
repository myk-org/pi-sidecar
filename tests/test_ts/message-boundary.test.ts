import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("message boundary separator", () => {
  // Simulate the exact concatenation logic from sessions.ts prompt()
  function concatenateDeltas(events: Array<{ message: object; delta: string }>): string {
    let responseText = "";
    let lastAssistantMessage: object | null = null;

    for (const event of events) {
      if (lastAssistantMessage !== null && event.message !== lastAssistantMessage && responseText.length > 0) {
        responseText += "\n\n";
      }
      lastAssistantMessage = event.message;
      responseText += event.delta;
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

  it("two messages — separator inserted", () => {
    const msg1 = {};
    const msg2 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: "First part." },
      { message: msg2, delta: "Second part." },
    ]);
    assert.equal(result, "First part.\n\nSecond part.");
  });

  it("three messages — two separators", () => {
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

  it("no leading separator when first message has no prior text", () => {
    const msg1 = {};
    const result = concatenateDeltas([
      { message: msg1, delta: "Only message" },
    ]);
    assert.equal(result, "Only message");
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
});

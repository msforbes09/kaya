import { describe, expect, it } from "vitest";
import { summarizeTool } from "./summarize.js";

describe("summarizeTool", () => {
  it("describes the memory tools in plain words", () => {
    expect(summarizeTool("mcp__kaya__remember", { subject: "editor" })).toBe("Remembering: editor");
    expect(summarizeTool("mcp__kaya__recall", { query: "editor" })).toBe('Recalling "editor"');
    expect(summarizeTool("mcp__kaya__forget", { query: "editor" })).toBe('Forgetting "editor"');
  });
});

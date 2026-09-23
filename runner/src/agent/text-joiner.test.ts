import { describe, expect, it } from "vitest";
import { TextJoiner } from "./text-joiner.js";

describe("TextJoiner", () => {
  it("inserts a space when a new text block starts right after punctuation", () => {
    const j = new TextJoiner();
    expect(j.delta("Storing that now.")).toBe("Storing that now.");
    j.blockStart();
    expect(j.delta("Done.")).toBe(" Done.");
    expect(j.text).toBe("Storing that now. Done.");
  });

  it("adds nothing when the previous block already ended in whitespace or nothing came before", () => {
    const j = new TextJoiner();
    j.blockStart();
    expect(j.delta("Hi")).toBe("Hi");
    expect(j.delta(" there\n")).toBe(" there\n");
    j.blockStart();
    expect(j.delta("Next")).toBe("Next");
  });
});

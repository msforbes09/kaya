import { describe, expect, it } from "vitest";
import { shouldForwardTranscript } from "./mic-gate";

describe("shouldForwardTranscript", () => {
  it("drops what the mic hears while Kaya is speaking, so her own voice never becomes a turn", () => {
    expect(shouldForwardTranscript("speaking", "hello")).toBe(false);
  });
  it("forwards speech in every other state and drops blanks", () => {
    expect(shouldForwardTranscript("idle", "hello")).toBe(true);
    expect(shouldForwardTranscript("thinking", "hello")).toBe(true);
    expect(shouldForwardTranscript("idle", "   ")).toBe(false);
  });
});

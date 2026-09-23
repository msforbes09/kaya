import { describe, expect, it } from "vitest";
import { KAYA_SYSTEM_PROMPT } from "./prompt.js";

describe("KAYA_SYSTEM_PROMPT", () => {
  it("tells the agent which ports belong to Kaya", () => {
    const p = KAYA_SYSTEM_PROMPT("/w", [5173, 8787]);
    expect(p).toContain("5173");
    expect(p).toContain("8787");
    expect(p).toMatch(/never (start|bind|run).*5173/i);
  });
});

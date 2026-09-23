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

describe("KAYA_SYSTEM_PROMPT name", () => {
  it("addresses the member by the name the cloud sends and never by a hardcoded one", () => {
    const p = KAYA_SYSTEM_PROMPT("/w", [5173], "arnel");
    expect(p).toContain("arnel");
    expect(p).not.toContain("Blackbox");
  });

  it("falls back to a neutral form of address when no name is known", () => {
    const p = KAYA_SYSTEM_PROMPT("/w", [5173], "");
    expect(p).not.toContain("Blackbox");
    expect(p).not.toMatch(/Address the developer as\s*\./);
  });

  it("tells the agent it can forget on request", () => {
    expect(KAYA_SYSTEM_PROMPT("/w")).toMatch(/`forget`/);
  });
});

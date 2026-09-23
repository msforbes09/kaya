import { describe, expect, it } from "vitest";
import { MODELS, isModelChoice } from "./models.js";

describe("model choices", () => {
  it("offers the three Claude tiers and accepts null for the runner default", () => {
    expect(MODELS).toEqual(["sonnet", "opus", "haiku"]);
    expect(isModelChoice("opus")).toBe(true);
    expect(isModelChoice(null)).toBe(true);
    expect(isModelChoice("gpt-5")).toBe(false);
    expect(isModelChoice(undefined)).toBe(false);
  });
});

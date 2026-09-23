import { describe, expect, it } from "vitest";
import { nextBackoffMs } from "./backoff.js";

describe("nextBackoffMs", () => {
  it("doubles from one second and caps at thirty when the jitter is neutral", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((a) => nextBackoffMs(a, () => 0.5))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it("spreads each wait between three quarters and five quarters of the base", () => {
    expect(nextBackoffMs(2, () => 0)).toBe(3000);
    expect(nextBackoffMs(2, () => 1)).toBe(5000);
  });
});

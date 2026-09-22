import { describe, expect, it } from "vitest";
import { nextBackoffMs } from "./backoff.js";

describe("nextBackoffMs", () => {
  it("doubles from one second and caps at thirty", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(nextBackoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

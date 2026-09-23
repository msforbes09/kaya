import { describe, expect, it } from "vitest";
import { labelFor } from "./models";

describe("labelFor", () => {
  it("names the runner default and capitalizes model ids", () => {
    expect(labelFor(null)).toBe("Runner default");
    expect(labelFor("sonnet")).toBe("Sonnet");
  });
});

import { describe, expect, it } from "vitest";
import { reconnectDelayMs, shouldReconnect } from "./reconnect";

describe("phone reconnect", () => {
  it("retries after a dropped socket but not after a sign-out close or a deliberate close", () => {
    expect(shouldReconnect({ code: 1006, deliberate: false })).toBe(true);
    expect(shouldReconnect({ code: 4401, deliberate: false })).toBe(false);
    expect(shouldReconnect({ code: 1006, deliberate: true })).toBe(false);
  });
  it("backs off from one second to fifteen", () => {
    expect([0, 1, 2, 3, 4, 9].map((a) => reconnectDelayMs(a, () => 0.5))).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
  });
});

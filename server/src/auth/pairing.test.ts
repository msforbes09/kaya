import { describe, expect, it } from "vitest";
import { hashRunnerToken, newPairingCode, newRunnerToken, pairingExpired, pairingExpiresAt, runnerTokenMatches } from "./pairing.js";

describe("pairing", () => {
  it("pairing codes are six digits", () => {
    expect(newPairingCode()).toMatch(/^\d{6}$/);
  });

  it("codes expire ten minutes after creation", () => {
    const now = 1_000_000;
    const exp = pairingExpiresAt(now);
    expect(pairingExpired(exp, now + 9 * 60_000)).toBe(false);
    expect(pairingExpired(exp, now + 10 * 60_000 + 1)).toBe(true);
  });

  it("runner tokens are 64 hex chars and verify only against their own hash", () => {
    const t = newRunnerToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(runnerTokenMatches(t, hashRunnerToken(t))).toBe(true);
    expect(runnerTokenMatches(newRunnerToken(), hashRunnerToken(t))).toBe(false);
  });
});

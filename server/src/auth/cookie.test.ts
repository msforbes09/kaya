import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./cookie.js";

const SECRET = "test-secret-0123456789";

describe("session cookie", () => {
  it("verifies a value it signed", () => {
    const v = signSession("member-1", SECRET, 1_000_000);
    expect(verifySession(v, SECRET, 1_000_001)).toBe("member-1");
  });

  it("rejects a tampered member id", () => {
    const good = signSession("member-1", SECRET, 1_000_000);
    const other = signSession("member-2", SECRET, 1_000_000);
    const tampered = [other.split(".")[0], ...good.split(".").slice(1)].join(".");
    expect(verifySession(tampered, SECRET, 1_000_001)).toBeNull();
  });

  it("rejects the wrong secret and missing values", () => {
    const v = signSession("member-1", SECRET, 1_000_000);
    expect(verifySession(v, "other", 1_000_001)).toBeNull();
    expect(verifySession(undefined, SECRET)).toBeNull();
  });

  it("expires after 30 days", () => {
    const v = signSession("member-1", SECRET, 0);
    expect(verifySession(v, SECRET, 30 * 86_400_000 + 1)).toBeNull();
  });

  it("handles member ids containing dots", () => {
    const v = signSession("a.b", SECRET, 1_000_000);
    expect(verifySession(v, SECRET, 1_000_001)).toBe("a.b");
  });
});

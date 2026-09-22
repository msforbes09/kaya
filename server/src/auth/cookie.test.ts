import { describe, expect, it } from "vitest";
import { clearPendingCookieHeader, pendingCookieHeader, signPending, signSession, verifyPending, verifySession } from "./cookie.js";

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

describe("pending signup cookie", () => {
  const pending = { githubId: 42, login: "octo", avatarUrl: "https://a/x.png" };

  it("verifies a value it signed", () => {
    const v = signPending(pending, SECRET, 1_000_000);
    expect(verifyPending(v, SECRET, 1_000_001)).toEqual({ ...pending, iat: 1_000_000 });
  });

  it("rejects tampering, the wrong secret and missing values", () => {
    const v = signPending(pending, SECRET, 1_000_000);
    expect(verifyPending(v, "other", 1_000_001)).toBeNull();
    expect(verifyPending(undefined, SECRET)).toBeNull();
    expect(verifyPending(`${signPending({ ...pending, login: "evil" }, SECRET, 1_000_000).split(".")[0]}.${v.split(".").slice(1).join(".")}`, SECRET, 1_000_001)).toBeNull();
  });

  it("expires after 5 minutes", () => {
    const v = signPending(pending, SECRET, 0);
    expect(verifyPending(v, SECRET, 300_000)).toEqual({ ...pending, iat: 0 });
    expect(verifyPending(v, SECRET, 300_001)).toBeNull();
  });

  it("builds a Max-Age=300 cookie header and a clearing header", () => {
    expect(pendingCookieHeader("v", true)).toContain("kaya_pending=v");
    expect(pendingCookieHeader("v", true)).toContain("Max-Age=300");
    expect(pendingCookieHeader("v", true)).toContain("Secure");
    expect(pendingCookieHeader("v", false)).not.toContain("Secure");
    expect(clearPendingCookieHeader()).toContain("Max-Age=0");
  });
});

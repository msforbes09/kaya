import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({ getMember: vi.fn() }));
import * as repo from "../db/repo.js";
import { signSession } from "./cookie.js";
import { authorizeSession } from "./session.js";

const SECRET = "test-secret-0123456789";

describe("authorizeSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the member when the cookie verifies and its epoch matches the row", async () => {
    vi.mocked(repo.getMember).mockResolvedValue({ id: "m1", githubLogin: "a", sessionEpoch: 2 } as never);
    const m = await authorizeSession(signSession("m1", SECRET, Date.now(), 2), SECRET);
    expect(m?.id).toBe("m1");
  });

  it("rejects a cookie from before a sign-out-everywhere, and a deleted member", async () => {
    vi.mocked(repo.getMember).mockResolvedValue({ id: "m1", sessionEpoch: 3 } as never);
    expect(await authorizeSession(signSession("m1", SECRET, Date.now(), 2), SECRET)).toBeNull();
    vi.mocked(repo.getMember).mockResolvedValue(undefined as never);
    expect(await authorizeSession(signSession("m1", SECRET, Date.now(), 3), SECRET)).toBeNull();
  });

  it("never touches the database for a cookie that does not verify", async () => {
    expect(await authorizeSession("garbage", SECRET)).toBeNull();
    expect(repo.getMember).not.toHaveBeenCalled();
  });
});

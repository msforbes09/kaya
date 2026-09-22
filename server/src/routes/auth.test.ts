import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({
  findMemberByGithubId: vi.fn(),
  createMember: vi.fn(),
  getMember: vi.fn(),
  inviteIsUnused: vi.fn(),
  redeemInvite: vi.fn(),
}));

import * as repo from "../db/repo.js";
import { signSession } from "../auth/cookie.js";
import { authRoutes } from "./auth.js";

const cfg = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "sec", COOKIE_SECRET: "0123456789abcdef0123456789abcdef", PUBLIC_URL: "http://localhost:5173", isProd: false };
const exchange = vi.fn(async () => ({ githubId: 42, login: "octo", avatarUrl: "https://a/x.png" }));
const app = () => authRoutes({ config: cfg, exchange });
const stateCookie = "kaya_oauth_state=st4te";

describe("auth routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to GitHub with a state cookie", async () => {
    const res = await app().request("/auth/github");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("https://github.com/login/oauth/authorize?");
    expect(res.headers.get("set-cookie")).toContain("kaya_oauth_state=");
  });

  it("signs in an existing member and sets the session cookie", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue({ id: "m1", githubId: 42 } as never);
    const res = await app().request("/auth/github/callback?code=abc&state=st4te", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain("kaya_session=");
  });

  it("asks a new member for an invite code", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue(undefined as never);
    const res = await app().request("/auth/github/callback?code=abc&state=st4te", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('name="invite"');
    expect(repo.createMember).not.toHaveBeenCalled();
  });

  it("creates the member and burns the invite when the code is valid", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue(undefined as never);
    vi.mocked(repo.inviteIsUnused).mockResolvedValue(true);
    vi.mocked(repo.createMember).mockResolvedValue({ id: "m9" } as never);
    vi.mocked(repo.redeemInvite).mockResolvedValue(true);
    const res = await app().request("/auth/github/callback?code=abc&state=st4te&invite=ABCDEFGHJKLM", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(302);
    expect(repo.createMember).toHaveBeenCalledWith({ githubId: 42, login: "octo", avatarUrl: "https://a/x.png" });
    expect(repo.redeemInvite).toHaveBeenCalledWith("ABCDEFGHJKLM", "m9");
  });

  it("rejects a used or unknown invite", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue(undefined as never);
    vi.mocked(repo.inviteIsUnused).mockResolvedValue(false);
    const res = await app().request("/auth/github/callback?code=abc&state=st4te&invite=NOPE", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(403);
    expect(repo.createMember).not.toHaveBeenCalled();
  });

  it("rejects a state mismatch", async () => {
    const res = await app().request("/auth/github/callback?code=abc&state=other", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(400);
  });

  it("GET /api/me needs a valid session cookie", async () => {
    expect((await app().request("/api/me")).status).toBe(401);
    vi.mocked(repo.getMember).mockResolvedValue({ id: "m1", githubLogin: "octo", avatarUrl: "https://a/x.png" } as never);
    const res = await app().request("/api/me", { headers: { cookie: `kaya_session=${signSession("m1", cfg.COOKIE_SECRET)}` } });
    expect(await res.json()).toEqual({ id: "m1", login: "octo", avatarUrl: "https://a/x.png" });
  });

  it("POST /auth/logout clears the cookie", async () => {
    const res = await app().request("/auth/logout", { method: "POST" });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

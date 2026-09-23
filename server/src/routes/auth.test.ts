import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({
  findMemberByGithubId: vi.fn(),
  createMember: vi.fn(),
  getMember: vi.fn(),
  redeemInvite: vi.fn(),
  deleteMember: vi.fn(),
}));

import * as repo from "../db/repo.js";
import { signPending, signSession } from "../auth/cookie.js";
import { authRoutes } from "./auth.js";

const cfg = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "sec", COOKIE_SECRET: "0123456789abcdef0123456789abcdef", PUBLIC_URL: "http://localhost:5173", isProd: false };
const exchange = vi.fn(async () => ({ githubId: 42, login: "octo", avatarUrl: "https://a/x.png" }));
const app = () => authRoutes({ config: cfg, exchange });
const stateCookie = "kaya_oauth_state=st4te";
const pendingCookie = (iat = Date.now()) =>
  `kaya_pending=${signPending({ githubId: 42, login: "octo", avatarUrl: "https://a/x.png" }, cfg.COOKIE_SECRET, iat)}`;

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

  it("asks a new member for an invite code, posting to /auth/invite with a pending cookie instead of replaying the OAuth code", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue(undefined as never);
    const res = await app().request("/auth/github/callback?code=abc&state=st4te", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('name="invite"');
    expect(body).toContain('method="post"');
    expect(body).toContain('action="/auth/invite"');
    expect(body).not.toContain('name="code"');
    expect(res.headers.get("set-cookie")).toContain("kaya_pending=");
    expect(repo.createMember).not.toHaveBeenCalled();
  });

  it("renders a 502 page when the GitHub exchange fails, without leaking details", async () => {
    exchange.mockRejectedValueOnce(new Error("bad_verification_code for client cid"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app().request("/auth/github/callback?code=abc&state=st4te", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain("GitHub sign-in failed");
    expect(body).not.toContain("bad_verification_code");
  });

  it("escapes an untrusted GitHub login in the invite page", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue(undefined as never);
    exchange.mockResolvedValueOnce({ githubId: 42, login: "<img src=x onerror=alert(1)>", avatarUrl: "https://a/x.png" });
    const res = await app().request("/auth/github/callback?code=abc&state=st4te", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("<img");
    expect(body).toContain("&lt;img");
  });

  it("POST /auth/invite creates the member and burns the invite when the pending cookie and code are valid", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue(undefined as never);
    vi.mocked(repo.createMember).mockResolvedValue({ id: "m9" } as never);
    vi.mocked(repo.redeemInvite).mockResolvedValue(true);
    const res = await app().request("/auth/invite", { method: "POST", body: "invite=abcdefghjklm", headers: { origin: "http://localhost:5173", "content-type": "application/x-www-form-urlencoded", cookie: pendingCookie() } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(repo.createMember).toHaveBeenCalledWith({ githubId: 42, login: "octo", avatarUrl: "https://a/x.png" });
    expect(repo.redeemInvite).toHaveBeenCalledWith("ABCDEFGHJKLM", "m9");
    const cookies = res.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("kaya_session=");
    expect(cookies).toContain("kaya_pending=;");
  });

  it("POST /auth/invite rejects a used or unknown invite and undoes the member it created", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue(undefined as never);
    vi.mocked(repo.createMember).mockResolvedValue({ id: "m9" } as never);
    vi.mocked(repo.redeemInvite).mockResolvedValue(false);
    vi.mocked(repo.deleteMember).mockResolvedValue(undefined);
    const res = await app().request("/auth/invite", { method: "POST", body: "invite=NOPE", headers: { origin: "http://localhost:5173", "content-type": "application/x-www-form-urlencoded", cookie: pendingCookie() } });
    expect(res.status).toBe(403);
    expect(repo.deleteMember).toHaveBeenCalledWith("m9");
    expect(res.headers.get("set-cookie") ?? "").not.toContain("kaya_session=");
  });

  it("POST /auth/invite signs in a member that already exists instead of creating them twice", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue({ id: "m9", githubId: 42 } as never);
    const res = await app().request("/auth/invite", { method: "POST", body: "invite=ABCDEFGHJKLM", headers: { origin: "http://localhost:5173", "content-type": "application/x-www-form-urlencoded", cookie: pendingCookie() } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(repo.createMember).not.toHaveBeenCalled();
    expect(repo.redeemInvite).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toContain("kaya_session=");
  });

  it("POST /auth/invite still refuses the sign-in when undoing the member fails", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue(undefined as never);
    vi.mocked(repo.createMember).mockResolvedValue({ id: "m9" } as never);
    vi.mocked(repo.redeemInvite).mockResolvedValue(false);
    vi.mocked(repo.deleteMember).mockRejectedValue(new Error("db down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app().request("/auth/invite", { method: "POST", body: "invite=NOPE", headers: { origin: "http://localhost:5173", "content-type": "application/x-www-form-urlencoded", cookie: pendingCookie() } });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("kaya_session=");
    expect(errors).toHaveBeenCalledWith("invite cleanup failed");
    errors.mockRestore();
  });

  it("POST /auth/invite needs a live pending cookie", async () => {
    const missing = await app().request("/auth/invite", { method: "POST", body: "invite=ABCDEFGHJKLM", headers: { origin: "http://localhost:5173", "content-type": "application/x-www-form-urlencoded" } });
    expect(missing.status).toBe(400);
    const expired = await app().request("/auth/invite", { method: "POST", body: "invite=ABCDEFGHJKLM", headers: { origin: "http://localhost:5173", "content-type": "application/x-www-form-urlencoded", cookie: pendingCookie(Date.now() - 300_001) } });
    expect(expired.status).toBe(400);
    expect(repo.createMember).not.toHaveBeenCalled();
  });

  it("rejects a state mismatch", async () => {
    const res = await app().request("/auth/github/callback?code=abc&state=other", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(400);
  });

  it("GET /api/me needs a valid session cookie", async () => {
    expect((await app().request("/api/me")).status).toBe(401);
    vi.mocked(repo.getMember).mockResolvedValue({ id: "m1", githubLogin: "octo", avatarUrl: "https://a/x.png", sessionEpoch: 0 } as never);
    const res = await app().request("/api/me", { headers: { cookie: `kaya_session=${signSession("m1", cfg.COOKIE_SECRET)}` } });
    expect(await res.json()).toEqual({ id: "m1", login: "octo", avatarUrl: "https://a/x.png" });
  });

  it("POST /auth/logout clears the cookie", async () => {
    const res = await app().request("/auth/logout", { method: "POST", headers: { origin: "http://localhost:5173" } });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("cookie-authenticated POSTs refuse a cross-site origin", async () => {
    const logout = await app().request("/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } });
    expect(logout.status).toBe(403);
    expect(logout.headers.get("set-cookie")).toBeNull();
    const invite = await app().request("/auth/invite", { method: "POST", body: "invite=ABCDEFGHJKLM", headers: { "content-type": "application/x-www-form-urlencoded", cookie: pendingCookie() } });
    expect(invite.status).toBe(403);
    expect(repo.createMember).not.toHaveBeenCalled();
  });

  it("GET /api/me refuses a cookie issued before a sign-out-everywhere", async () => {
    vi.mocked(repo.getMember).mockResolvedValue({ id: "m1", githubLogin: "octo", sessionEpoch: 1 } as never);
    const res = await app().request("/api/me", { headers: { cookie: `kaya_session=${signSession("m1", cfg.COOKIE_SECRET, Date.now(), 0)}` } });
    expect(res.status).toBe(401);
  });
});

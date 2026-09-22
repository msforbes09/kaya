import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import {
  clearPendingCookieHeader,
  clearSessionCookieHeader,
  pendingCookieHeader,
  PENDING_COOKIE,
  sessionCookieHeader,
  signPending,
  signSession,
  SESSION_COOKIE,
  verifyPending,
  verifySession,
} from "../auth/cookie.js";
import { exchangeGithubCode, githubAuthorizeUrl } from "../auth/github.js";
import * as repo from "../db/repo.js";
import { escapeHtml } from "../html.js";

export interface AuthDeps {
  config: { GITHUB_CLIENT_ID: string; GITHUB_CLIENT_SECRET: string; COOKIE_SECRET: string; PUBLIC_URL: string; isProd: boolean };
  exchange?: typeof exchangeGithubCode;
}

const STATE_COOKIE = "kaya_oauth_state";

const page = (title: string, body: string) =>
  `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;background:#141A26;color:#e6e9f0;display:grid;place-items:center;min-height:100vh;margin:0}form,main{max-width:360px;padding:24px}input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin-top:8px;border-radius:10px;border:1px solid #334}button{background:#e6e9f0;color:#141A26}</style>${body}`;

export function authRoutes({ config, exchange = exchangeGithubCode }: AuthDeps) {
  const app = new Hono();
  const redirectUri = `${config.PUBLIC_URL}/auth/github/callback`;

  app.get("/auth/github", (c) => {
    const state = randomBytes(16).toString("hex");
    setCookie(c, STATE_COOKIE, state, { path: "/", httpOnly: true, sameSite: "Lax", maxAge: 600, secure: config.isProd });
    return c.redirect(githubAuthorizeUrl(config.GITHUB_CLIENT_ID, redirectUri, state));
  });

  app.get("/auth/github/callback", async (c) => {
    const { code, state } = c.req.query();
    if (!code || !state || state !== getCookie(c, STATE_COOKIE)) return c.text("Bad OAuth state", 400);
    setCookie(c, STATE_COOKIE, "", { path: "/", maxAge: 0 });

    // The OAuth code is single use: exchange it exactly once, here.
    let user;
    try {
      user = await exchange({ code, clientId: config.GITHUB_CLIENT_ID, clientSecret: config.GITHUB_CLIENT_SECRET });
    } catch (err) {
      console.error("github exchange failed:", err instanceof Error ? err.name : "error");
      return c.html(page("Kaya — sign-in failed", `<main><h1>GitHub sign-in failed</h1><p>Try again.</p><p><a href="/auth/github">Retry</a></p></main>`), 502);
    }

    const member = await repo.findMemberByGithubId(user.githubId);
    if (!member) {
      // No invite yet: carry the vouched-for identity in a short-lived signed
      // cookie so the invite form doesn't have to replay the OAuth code.
      c.header("Set-Cookie", pendingCookieHeader(signPending(user, config.COOKIE_SECRET), config.isProd), { append: true });
      return c.html(
        page(
          "Kaya — invite",
          `<form method="post" action="/auth/invite"><h1>Welcome, ${escapeHtml(user.login)}</h1><p>Kaya is invite only. Paste your invite code.</p><input name="invite" placeholder="Invite code" autocapitalize="characters" autocomplete="off"><button>Join</button></form>`,
        ),
      );
    }

    c.header("Set-Cookie", sessionCookieHeader(signSession(member.id, config.COOKIE_SECRET), config.isProd), { append: true });
    return c.redirect("/");
  });

  app.post("/auth/invite", async (c) => {
    const pending = verifyPending(getCookie(c, PENDING_COOKIE), config.COOKIE_SECRET);
    if (!pending) return c.html(page("Kaya — invite", `<main><h1>Sign-in expired</h1><p><a href="/auth/github">Start again</a></p></main>`), 400);

    const form = await c.req.parseBody();
    const clean = String(form.invite ?? "").trim().toUpperCase();

    // Burning the invite is the only check: redeemInvite is a conditional
    // update, so two people racing one code cannot both win it. The member has
    // to exist first to be recorded as the redeemer, so undo it if we lost.
    const member = await repo.createMember({ githubId: pending.githubId, login: pending.login, avatarUrl: pending.avatarUrl });
    if (!(await repo.redeemInvite(clean, member.id))) {
      await repo.deleteMember(member.id);
      return c.html(page("Kaya — invite", `<main><h1>Invite not valid</h1><p>That code is unknown or already used. Ask for a new one.</p></main>`), 403);
    }

    c.header("Set-Cookie", sessionCookieHeader(signSession(member.id, config.COOKIE_SECRET), config.isProd), { append: true });
    c.header("Set-Cookie", clearPendingCookieHeader(), { append: true });
    return c.redirect("/");
  });

  app.post("/auth/logout", (c) => {
    c.header("Set-Cookie", clearSessionCookieHeader());
    return c.json({ ok: true });
  });

  app.get("/api/me", async (c) => {
    const id = verifySession(getCookie(c, SESSION_COOKIE), config.COOKIE_SECRET);
    if (!id) return c.json({ error: "unauthorized" }, 401);
    const m = await repo.getMember(id);
    if (!m) return c.json({ error: "unauthorized" }, 401);
    return c.json({ id: m.id, login: m.githubLogin, avatarUrl: m.avatarUrl });
  });

  return app;
}

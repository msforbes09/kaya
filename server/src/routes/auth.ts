import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { clearSessionCookieHeader, sessionCookieHeader, signSession, SESSION_COOKIE, verifySession } from "../auth/cookie.js";
import { exchangeGithubCode, githubAuthorizeUrl } from "../auth/github.js";
import * as repo from "../db/repo.js";

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
    const { code, state, invite } = c.req.query();
    if (!code || !state || state !== getCookie(c, STATE_COOKIE)) return c.text("Bad OAuth state", 400);

    const user = await exchange({ code, clientId: config.GITHUB_CLIENT_ID, clientSecret: config.GITHUB_CLIENT_SECRET });
    let member = await repo.findMemberByGithubId(user.githubId);

    if (!member) {
      if (!invite) {
        const action = `/auth/github/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
        return c.html(
          page("Kaya — invite", `<form method="get" action="${action}"><h1>Welcome, ${user.login}</h1><p>Kaya is invite only. Paste your invite code.</p><input name="invite" placeholder="Invite code" autocapitalize="characters" autocomplete="off"><input type="hidden" name="code" value="${code}"><input type="hidden" name="state" value="${state}"><button>Join</button></form>`),
        );
      }
      const clean = String(invite).trim().toUpperCase();
      if (!(await repo.inviteIsUnused(clean))) return c.html(page("Kaya — invite", `<main><h1>Invite not valid</h1><p>That code is unknown or already used. Ask for a new one.</p></main>`), 403);
      member = await repo.createMember({ githubId: user.githubId, login: user.login, avatarUrl: user.avatarUrl });
      await repo.redeemInvite(clean, member.id);
    }

    c.header("Set-Cookie", sessionCookieHeader(signSession(member.id, config.COOKIE_SECRET), config.isProd), { append: true });
    setCookie(c, STATE_COOKIE, "", { path: "/", maxAge: 0 });
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

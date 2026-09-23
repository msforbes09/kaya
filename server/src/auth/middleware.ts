import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { config } from "../config.js";
import { SESSION_COOKIE } from "./cookie.js";
import { authorizeSession, sessionCookieFromHeader } from "./session.js";

/** Member id for a socket upgrade, or null. */
export async function memberIdFromCookieHeader(cookieHeader: string | undefined, secret: string): Promise<string | null> {
  const m = await authorizeSession(sessionCookieFromHeader(cookieHeader), secret);
  return m?.id ?? null;
}

export type MemberEnv = { Variables: { memberId: string } };

export const requireMember: MiddlewareHandler<MemberEnv> = async (c, next) => {
  const m = await authorizeSession(getCookie(c, SESSION_COOKIE), config.COOKIE_SECRET);
  if (!m) return c.json({ error: "unauthorized" }, 401);
  c.set("memberId", m.id);
  await next();
};

/**
 * Browsers send Origin on every cross-site and same-site POST, so a cookie-
 * authenticated POST without our own origin is a forgery or a script; refuse it.
 */
export function isSameOrigin(origin: string | undefined, publicUrl: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
}

export const requireSameOrigin = (publicUrl: string): MiddlewareHandler => async (c, next) => {
  if (!isSameOrigin(c.req.header("origin"), publicUrl)) return c.json({ error: "cross-origin request refused" }, 403);
  await next();
};

import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { config } from "../config.js";
import { SESSION_COOKIE, verifySession } from "./cookie.js";

/** Pure: parse a raw Cookie header and return the member id, or null. Used by socket upgrades. */
export function memberIdFromCookieHeader(cookieHeader: string | undefined, secret: string): string | null {
  if (!cookieHeader) return null;
  const pair = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`));
  return verifySession(pair?.slice(SESSION_COOKIE.length + 1), secret);
}

export type MemberEnv = { Variables: { memberId: string } };

export const requireMember: MiddlewareHandler<MemberEnv> = async (c, next) => {
  const id = verifySession(getCookie(c, SESSION_COOKIE), config.COOKIE_SECRET);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  c.set("memberId", id);
  await next();
};

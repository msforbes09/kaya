import * as repo from "../db/repo.js";
import { SESSION_COOKIE, verifySession } from "./cookie.js";

export type Member = NonNullable<Awaited<ReturnType<typeof repo.getMember>>>;

/**
 * The full check behind every cookie-authenticated request: signature, age,
 * the member still exists, and the cookie's epoch is the row's current one.
 */
export async function authorizeSession(value: string | undefined, secret: string, now = Date.now()): Promise<Member | null> {
  const claims = verifySession(value, secret, now);
  if (!claims) return null;
  const member = await repo.getMember(claims.memberId);
  if (!member || member.sessionEpoch !== claims.epoch) return null;
  return member;
}

/** Pulls the session cookie out of a raw Cookie header (socket upgrades have no cookie helper). */
export function sessionCookieFromHeader(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const pair = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`));
  return pair?.slice(SESSION_COOKIE.length + 1);
}

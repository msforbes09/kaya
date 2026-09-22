import type { MiddlewareHandler } from "hono";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

function tokenMatches(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(config.KAYA_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Bearer-token guard for HTTP routes. */
export const requireToken: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!tokenMatches(token)) return c.json({ error: "unauthorized" }, 401);
  await next();
};

/** WebSocket upgrades can't set headers from the browser, so the token rides in the query string. */
export function wsTokenValid(url: URL): boolean {
  return tokenMatches(url.searchParams.get("token") ?? undefined);
}

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "kaya_session";
const MAX_AGE_MS = 30 * 86_400_000;

/**
 * Domain separated: a value signed for one cookie can never verify as the
 * other, whatever shape it is squeezed into.
 */
function mac(domain: "session" | "pending", payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${domain}:${payload}`).digest("base64url");
}

export interface SessionClaims {
  memberId: string;
  /** Must equal the member row's session_epoch; bumping that signs the member out everywhere. */
  epoch: number;
}

/** value = base64url(memberId).issuedAtMs.epoch.hmac */
export function signSession(memberId: string, secret: string, now = Date.now(), epoch = 0): string {
  const encodedId = Buffer.from(memberId).toString("base64url");
  const payload = `${encodedId}.${now}.${epoch}`;
  return `${payload}.${mac("session", payload, secret)}`;
}

/** Checks signature and age only. Whether the member still exists, and the epoch, is `authorizeSession`'s job. */
export function verifySession(value: string | undefined, secret: string, now = Date.now()): SessionClaims | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [encodedId, issued, epochStr, sig] = parts;
  const payload = `${encodedId}.${issued}.${epochStr}`;
  const expected = mac("session", payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const issuedAt = Number(issued);
  if (!Number.isFinite(issuedAt) || now - issuedAt > MAX_AGE_MS) return null;
  const epoch = Number(epochStr);
  if (!Number.isInteger(epoch) || epoch < 0) return null;
  return { memberId: Buffer.from(encodedId, "base64url").toString(), epoch };
}

export function sessionCookieHeader(value: string, secure: boolean): string {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE_MS / 1000}`];
  if (secure) flags.push("Secure");
  return `${SESSION_COOKIE}=${value}; ${flags.join("; ")}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export const PENDING_COOKIE = "kaya_pending";
const PENDING_MAX_AGE_MS = 5 * 60_000;

export interface PendingSignup {
  githubId: number;
  login: string;
  avatarUrl: string;
  iat: number;
}

/** value = base64url(json).hmac — a 5 minute proof that GitHub just vouched for this user. */
export function signPending(user: { githubId: number; login: string; avatarUrl: string }, secret: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ githubId: user.githubId, login: user.login, avatarUrl: user.avatarUrl, iat: now }),
  ).toString("base64url");
  return `${payload}.${mac("pending", payload, secret)}`;
}

export function verifyPending(value: string | undefined, secret: string, now = Date.now()): PendingSignup | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac("pending", payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: PendingSignup;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as PendingSignup;
  } catch {
    return null;
  }
  if (typeof parsed?.githubId !== "number" || typeof parsed?.login !== "string" || typeof parsed?.iat !== "number") return null;
  if (now - parsed.iat > PENDING_MAX_AGE_MS) return null;
  return parsed;
}

export function pendingCookieHeader(value: string, secure: boolean): string {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${PENDING_MAX_AGE_MS / 1000}`];
  if (secure) flags.push("Secure");
  return `${PENDING_COOKIE}=${value}; ${flags.join("; ")}`;
}

export function clearPendingCookieHeader(): string {
  return `${PENDING_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

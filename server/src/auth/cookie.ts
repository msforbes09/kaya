import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "kaya_session";
const MAX_AGE_MS = 30 * 86_400_000;

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** value = base64url(memberId).issuedAtMs.hmac */
export function signSession(memberId: string, secret: string, now = Date.now()): string {
  const encodedId = Buffer.from(memberId).toString("base64url");
  const payload = `${encodedId}.${now}`;
  return `${payload}.${mac(payload, secret)}`;
}

export function verifySession(value: string | undefined, secret: string, now = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [encodedId, issued, sig] = parts;
  const payload = `${encodedId}.${issued}`;
  const expected = mac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const issuedAt = Number(issued);
  if (!Number.isFinite(issuedAt) || now - issuedAt > MAX_AGE_MS) return null;
  return Buffer.from(encodedId, "base64url").toString();
}

export function sessionCookieHeader(value: string, secure: boolean): string {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE_MS / 1000}`];
  if (secure) flags.push("Secure");
  return `${SESSION_COOKIE}=${value}; ${flags.join("; ")}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

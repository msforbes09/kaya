import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PAIRING_TTL_MS = 10 * 60_000;

export function newPairingCode(random: (n: number) => Buffer = randomBytes): string {
  const n = random(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

export function pairingExpiresAt(now = Date.now()): Date {
  return new Date(now + PAIRING_TTL_MS);
}

export function pairingExpired(expiresAt: Date, now = Date.now()): boolean {
  return expiresAt.getTime() < now;
}

export function newRunnerToken(random: (n: number) => Buffer = randomBytes): string {
  return random(32).toString("hex");
}

export function hashRunnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function runnerTokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(hashRunnerToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

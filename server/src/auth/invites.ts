import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ234567"; // 30 symbols, no I/O/0/1

/** 12-character invite code from an unambiguous alphabet. */
export function generateInviteCode(random: (n: number) => Buffer = randomBytes): string {
  const bytes = random(12);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

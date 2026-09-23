import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ234567"; // 30 symbols, no I/O/0/1

/** 12-character invite code from an unambiguous alphabet. */
export function generateInviteCode(random: (n: number) => Buffer = randomBytes): string {
  let out = "";
  const MAX_ACCEPT = 240; // largest multiple of 30 below 256
  while (out.length < 12) {
    const bytes = random(1);
    const b = bytes[0];
    if (b < MAX_ACCEPT) {
      out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

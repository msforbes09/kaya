import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { randomUUID } from "node:crypto";
import { SESSION_COOKIE } from "../auth/cookie.js";
import { requireSameOrigin } from "../auth/middleware.js";
import { authorizeSession } from "../auth/session.js";
import { hashRunnerToken, newPairingCode, newRunnerToken, pairingExpired, pairingExpiresAt } from "../auth/pairing.js";
import * as repo from "../db/repo.js";

export interface PairingDeps {
  secret: string;
  publicUrl: string;
  now?: () => number;
}

const ATTEMPT_WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS_PER_MEMBER = 10;
const MAX_FAILURES_PER_CODE = 5;

export function pairingRoutes({ secret, publicUrl, now = Date.now }: PairingDeps) {
  const app = new Hono();
  const pendingMeta = new Map<string, { name: string; workspace: string; expiresAt: number }>();
  // A pairing code is six digits, so confirming one has to be rate limited:
  // per member, and per code so a code under attack dies instead of falling.
  const attempts = new Map<string, number[]>();
  const failures = new Map<string, { count: number; last: number }>();

  /** Records one attempt and reports whether the member has spent their budget. */
  const spendAttempt = (memberId: string, nowMs: number): boolean => {
    for (const [id, times] of attempts) {
      const live = times.filter((t) => nowMs - t < ATTEMPT_WINDOW_MS);
      if (live.length === 0) attempts.delete(id);
      else attempts.set(id, live);
    }
    for (const [code, f] of failures) if (nowMs - f.last >= ATTEMPT_WINDOW_MS) failures.delete(code);

    const mine = attempts.get(memberId) ?? [];
    if (mine.length >= MAX_ATTEMPTS_PER_MEMBER) return false;
    attempts.set(memberId, [...mine, nowMs]);
    return true;
  };

  const recordFailure = (code: string, nowMs: number): void => {
    failures.set(code, { count: (failures.get(code)?.count ?? 0) + 1, last: nowMs });
  };

  app.post("/api/pair/start", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; workspace?: string };
    const name = String(body.name ?? "runner").slice(0, 80);
    const workspace = String(body.workspace ?? "").slice(0, 400);
    const nowMs = now();
    for (const [id, meta] of pendingMeta) {
      if (meta.expiresAt < nowMs) pendingMeta.delete(id);
    }
    const code = newPairingCode();
    const publicId = randomUUID();
    const expiresAt = pairingExpiresAt(nowMs);
    await repo.createPairingCode(code, publicId, expiresAt);
    pendingMeta.set(publicId, { name, workspace, expiresAt: expiresAt.getTime() });
    return c.json({ code, publicId, verifyUrl: `${publicUrl}/pair?code=${code}` });
  });

  app.get("/api/pair/poll", async (c) => {
    const publicId = c.req.query("publicId") ?? "";
    const row = await repo.getPairingByPublicId(publicId);
    if (!row) return c.json({ status: "expired" });
    if (pairingExpired(row.expiresAt, now())) {
      await repo.deletePairingCode(row.code);
      pendingMeta.delete(publicId);
      return c.json({ status: "expired" });
    }
    if (!row.memberId) return c.json({ status: "pending" });

    const meta = pendingMeta.get(publicId) ?? { name: "runner", workspace: "" };
    const token = newRunnerToken();
    await repo.upsertRunner({ memberId: row.memberId, name: meta.name, tokenHash: hashRunnerToken(token), workspace: meta.workspace });
    await repo.deletePairingCode(row.code);
    pendingMeta.delete(publicId);
    return c.json({ status: "paired", token });
  });

  app.get("/api/pair/describe", async (c) => {
    const nowMs = now();
    const memberId = (await authorizeSession(getCookie(c, SESSION_COOKIE), secret, nowMs))?.id;
    if (!memberId) return c.json({ error: "unauthorized" }, 401);
    // Every lookup costs an attempt, hit or miss, and out of the same budget as
    // confirm: otherwise this endpoint is a free oracle for live codes.
    if (!spendAttempt(memberId, nowMs)) return c.json({ error: "too many attempts" }, 429);

    const code = String(c.req.query("code") ?? "").trim();
    const row = await repo.getPairingCode(code);
    if (!row || pairingExpired(row.expiresAt, nowMs)) return c.json({ error: "unknown code" }, 404);
    return c.json({ name: pendingMeta.get(row.runnerPublicId)?.name ?? "runner" });
  });

  app.post("/api/pair/confirm", requireSameOrigin(publicUrl), async (c) => {
    const nowMs = now();
    const memberId = (await authorizeSession(getCookie(c, SESSION_COOKIE), secret, nowMs))?.id;
    if (!memberId) return c.json({ error: "unauthorized" }, 401);
    if (!spendAttempt(memberId, nowMs)) return c.json({ error: "too many attempts" }, 429);

    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    const code = String(body.code ?? "").trim();

    // A code that has been missed this often is being guessed at: retire it
    // and answer exactly as an expired code would.
    if ((failures.get(code)?.count ?? 0) >= MAX_FAILURES_PER_CODE) {
      await repo.deletePairingCode(code);
      failures.delete(code);
      return c.json({ error: "expired" }, 410);
    }

    const row = await repo.getPairingCode(code);
    if (!row) {
      recordFailure(code, nowMs);
      return c.json({ error: "unknown code" }, 404);
    }
    if (pairingExpired(row.expiresAt, nowMs)) {
      recordFailure(code, nowMs);
      return c.json({ error: "expired" }, 410);
    }
    const ok = await repo.confirmPairingCode(code, memberId);
    if (!ok) {
      recordFailure(code, nowMs);
      return c.json({ error: "already confirmed" }, 409);
    }
    failures.delete(code);
    return c.json({ ok: true });
  });

  return app;
}

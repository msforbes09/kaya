import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { randomUUID } from "node:crypto";
import { SESSION_COOKIE, verifySession } from "../auth/cookie.js";
import { hashRunnerToken, newPairingCode, newRunnerToken, pairingExpired, pairingExpiresAt } from "../auth/pairing.js";
import * as repo from "../db/repo.js";

export interface PairingDeps {
  secret: string;
  publicUrl: string;
  now?: () => number;
}

export function pairingRoutes({ secret, publicUrl, now = Date.now }: PairingDeps) {
  const app = new Hono();
  const pendingMeta = new Map<string, { name: string; workspace: string }>();

  app.post("/api/pair/start", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; workspace?: string };
    const name = String(body.name ?? "runner").slice(0, 80);
    const workspace = String(body.workspace ?? "").slice(0, 400);
    const code = newPairingCode();
    const publicId = randomUUID();
    await repo.createPairingCode(code, publicId, pairingExpiresAt(now()));
    pendingMeta.set(publicId, { name, workspace });
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

  app.post("/api/pair/confirm", async (c) => {
    const memberId = verifySession(getCookie(c, SESSION_COOKIE), secret, now());
    if (!memberId) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    const code = String(body.code ?? "").trim();
    const row = await repo.getPairingCode(code);
    if (!row) return c.json({ error: "unknown code" }, 404);
    if (pairingExpired(row.expiresAt, now())) return c.json({ error: "expired" }, 410);
    const ok = await repo.confirmPairingCode(code, memberId);
    return ok ? c.json({ ok: true }) : c.json({ error: "already confirmed" }, 409);
  });

  return app;
}

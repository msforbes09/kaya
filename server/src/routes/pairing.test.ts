import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({
  createPairingCode: vi.fn(),
  getPairingCode: vi.fn(),
  getPairingByPublicId: vi.fn(),
  confirmPairingCode: vi.fn(),
  deletePairingCode: vi.fn(),
  upsertRunner: vi.fn(),
  getMember: vi.fn(),
}));

import * as repo from "../db/repo.js";
import { signSession } from "../auth/cookie.js";
import { pairingRoutes } from "./pairing.js";

const secret = "0123456789abcdef0123456789abcdef";
const app = () => pairingRoutes({ secret, publicUrl: "https://kaya.example", now: () => 1_000_000 });
const cookie = `kaya_session=${signSession("m1", secret, 1_000_000)}`;

describe("pairing routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.getMember).mockResolvedValue({ id: "m1", sessionEpoch: 0 } as never);
  });

  it("start creates a code and returns the verify url", async () => {
    const res = await app().request("/api/pair/start", {
      method: "POST",
      body: JSON.stringify({ name: "mac", workspace: "/w" }),
      headers: { "content-type": "application/json" },
    });
    const body = await res.json();
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.verifyUrl).toBe(`https://kaya.example/pair?code=${body.code}`);
    expect(repo.createPairingCode).toHaveBeenCalledWith(body.code, body.publicId, new Date(1_000_000 + 600_000));
  });

  it("poll is pending until confirmed, then hands the token once and upserts the runner", async () => {
    const a = app();
    const start = await (
      await a.request("/api/pair/start", {
        method: "POST",
        body: JSON.stringify({ name: "mac", workspace: "/w" }),
        headers: { "content-type": "application/json" },
      })
    ).json();
    vi.mocked(repo.getPairingByPublicId).mockResolvedValueOnce({
      code: start.code,
      runnerPublicId: start.publicId,
      memberId: null,
      expiresAt: new Date(1_600_000),
    } as never);
    expect(await (await a.request(`/api/pair/poll?publicId=${start.publicId}`)).json()).toEqual({ status: "pending" });

    vi.mocked(repo.getPairingByPublicId).mockResolvedValueOnce({
      code: start.code,
      runnerPublicId: start.publicId,
      memberId: "m1",
      expiresAt: new Date(1_600_000),
    } as never);
    vi.mocked(repo.upsertRunner).mockResolvedValue({ id: "r1" } as never);
    const paired = await (await a.request(`/api/pair/poll?publicId=${start.publicId}`)).json();
    expect(paired.status).toBe("paired");
    expect(paired.token).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.upsertRunner).toHaveBeenCalledWith(expect.objectContaining({ memberId: "m1", name: "mac", workspace: "/w" }));
    expect(repo.deletePairingCode).toHaveBeenCalledWith(start.code);
  });

  it("prunes abandoned pairing metadata on the next start, so a stale publicId can't be polled into a runner", async () => {
    let t = 1_000_000;
    const a = pairingRoutes({ secret, publicUrl: "https://kaya.example", now: () => t });
    const start = await (
      await a.request("/api/pair/start", {
        method: "POST",
        body: JSON.stringify({ name: "mac", workspace: "/w" }),
        headers: { "content-type": "application/json" },
      })
    ).json();

    t = 1_000_000 + 600_001;
    await a.request("/api/pair/start", {
      method: "POST",
      body: JSON.stringify({ name: "pc", workspace: "/w2" }),
      headers: { "content-type": "application/json" },
    });

    vi.mocked(repo.getPairingByPublicId).mockResolvedValueOnce({
      code: start.code,
      runnerPublicId: start.publicId,
      memberId: "m1",
      expiresAt: new Date(900_000),
    } as never);
    const polled = await (await a.request(`/api/pair/poll?publicId=${start.publicId}`)).json();
    expect(polled).toEqual({ status: "expired" });
    expect(repo.upsertRunner).not.toHaveBeenCalled();
  });

  it("poll reports expired codes", async () => {
    vi.mocked(repo.getPairingByPublicId).mockResolvedValueOnce({
      code: "1",
      runnerPublicId: "p",
      memberId: null,
      expiresAt: new Date(900_000),
    } as never);
    expect(await (await app().request("/api/pair/poll?publicId=p")).json()).toEqual({ status: "expired" });
  });

  const confirm = (a: ReturnType<typeof app>, code: string) =>
    a.request("/api/pair/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
      headers: { origin: "https://kaya.example", "content-type": "application/json", cookie },
    });

  it("confirm stops a member after 10 attempts in 10 minutes", async () => {
    const a = app();
    vi.mocked(repo.getPairingCode).mockResolvedValue(undefined as never);
    for (let i = 0; i < 10; i++) expect((await confirm(a, `10000${i}`)).status).toBe(404);
    const blocked = await confirm(a, "999999");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too many attempts" });
  });

  it("confirm burns a code that has been guessed at 5 times", async () => {
    const a = app();
    vi.mocked(repo.getPairingCode).mockResolvedValue({ code: "123456", memberId: null, expiresAt: new Date(1_600_000) } as never);
    vi.mocked(repo.confirmPairingCode).mockResolvedValue(false);
    for (let i = 0; i < 5; i++) expect((await confirm(a, "123456")).status).toBe(409);
    expect(repo.deletePairingCode).not.toHaveBeenCalled();
    const sixth = await confirm(a, "123456");
    expect(sixth.status).toBe(410);
    expect(repo.deletePairingCode).toHaveBeenCalledWith("123456");
  });

  it("describe names the runner behind a live code, for signed-in members only", async () => {
    const a = app();
    const start = await (
      await a.request("/api/pair/start", {
        method: "POST",
        body: JSON.stringify({ name: "mac", workspace: "/w" }),
        headers: { "content-type": "application/json" },
      })
    ).json();

    expect((await a.request(`/api/pair/describe?code=${start.code}`)).status).toBe(401);

    vi.mocked(repo.getPairingCode).mockResolvedValueOnce({
      code: start.code,
      runnerPublicId: start.publicId,
      memberId: null,
      expiresAt: new Date(1_600_000),
    } as never);
    const res = await a.request(`/api/pair/describe?code=${start.code}`, { headers: { origin: "https://kaya.example", cookie } });
    expect(await res.json()).toEqual({ name: "mac" });

    vi.mocked(repo.getPairingCode).mockResolvedValueOnce(undefined as never);
    expect((await a.request("/api/pair/describe?code=000000", { headers: { origin: "https://kaya.example", cookie } })).status).toBe(404);
  });

  it("describe spends an attempt even when the code is live, so codes can't be enumerated for free", async () => {
    const a = app();
    vi.mocked(repo.getPairingCode).mockResolvedValue({
      code: "123456",
      runnerPublicId: "p1",
      memberId: null,
      expiresAt: new Date(1_600_000),
    } as never);
    for (let i = 0; i < 10; i++)
      expect((await a.request(`/api/pair/describe?code=10000${i}`, { headers: { origin: "https://kaya.example", cookie } })).status).toBe(
        200,
      );

    const blockedDescribe = await a.request("/api/pair/describe?code=123456", { headers: { origin: "https://kaya.example", cookie } });
    expect(blockedDescribe.status).toBe(429);
    expect(await blockedDescribe.json()).toEqual({ error: "too many attempts" });
    expect((await confirm(a, "123456")).status).toBe(429);
  });

  it("confirm requires a session and a live code", async () => {
    expect(
      (
        await app().request("/api/pair/confirm", {
          method: "POST",
          body: JSON.stringify({ code: "123456" }),
          headers: { origin: "https://kaya.example", "content-type": "application/json" },
        })
      ).status,
    ).toBe(401);
    vi.mocked(repo.getPairingCode).mockResolvedValueOnce(undefined as never);
    expect(
      (
        await app().request("/api/pair/confirm", {
          method: "POST",
          body: JSON.stringify({ code: "123456" }),
          headers: { origin: "https://kaya.example", "content-type": "application/json", cookie },
        })
      ).status,
    ).toBe(404);
    vi.mocked(repo.getPairingCode).mockResolvedValueOnce({ code: "123456", memberId: null, expiresAt: new Date(1_600_000) } as never);
    vi.mocked(repo.confirmPairingCode).mockResolvedValueOnce(true);
    const ok = await app().request("/api/pair/confirm", {
      method: "POST",
      body: JSON.stringify({ code: "123456" }),
      headers: { origin: "https://kaya.example", "content-type": "application/json", cookie },
    });
    expect(ok.status).toBe(200);
    expect(repo.confirmPairingCode).toHaveBeenCalledWith("123456", "m1");
  });

  it("confirm refuses a POST without our own origin, before spending an attempt", async () => {
    const res = await app().request("/api/pair/confirm", {
      method: "POST",
      body: JSON.stringify({ code: "123456" }),
      headers: { "content-type": "application/json", cookie },
    });
    expect(res.status).toBe(403);
    expect(repo.getPairingCode).not.toHaveBeenCalled();
  });
});

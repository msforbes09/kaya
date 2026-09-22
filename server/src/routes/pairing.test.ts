import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({
  createPairingCode: vi.fn(),
  getPairingCode: vi.fn(),
  getPairingByPublicId: vi.fn(),
  confirmPairingCode: vi.fn(),
  deletePairingCode: vi.fn(),
  upsertRunner: vi.fn(),
}));

import * as repo from "../db/repo.js";
import { signSession } from "../auth/cookie.js";
import { pairingRoutes } from "./pairing.js";

const secret = "0123456789abcdef0123456789abcdef";
const app = () => pairingRoutes({ secret, publicUrl: "https://kaya.example", now: () => 1_000_000 });
const cookie = `kaya_session=${signSession("m1", secret, 1_000_000)}`;

describe("pairing routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("start creates a code and returns the verify url", async () => {
    const res = await app().request("/api/pair/start", { method: "POST", body: JSON.stringify({ name: "mac", workspace: "/w" }), headers: { "content-type": "application/json" } });
    const body = await res.json();
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.verifyUrl).toBe(`https://kaya.example/pair?code=${body.code}`);
    expect(repo.createPairingCode).toHaveBeenCalledWith(body.code, body.publicId, new Date(1_000_000 + 600_000));
  });

  it("poll is pending until confirmed, then hands the token once and upserts the runner", async () => {
    const a = app();
    const start = await (await a.request("/api/pair/start", { method: "POST", body: JSON.stringify({ name: "mac", workspace: "/w" }), headers: { "content-type": "application/json" } })).json();
    vi.mocked(repo.getPairingByPublicId).mockResolvedValueOnce({ code: start.code, runnerPublicId: start.publicId, memberId: null, expiresAt: new Date(1_600_000) } as never);
    expect(await (await a.request(`/api/pair/poll?publicId=${start.publicId}`)).json()).toEqual({ status: "pending" });

    vi.mocked(repo.getPairingByPublicId).mockResolvedValueOnce({ code: start.code, runnerPublicId: start.publicId, memberId: "m1", expiresAt: new Date(1_600_000) } as never);
    vi.mocked(repo.upsertRunner).mockResolvedValue({ id: "r1" } as never);
    const paired = await (await a.request(`/api/pair/poll?publicId=${start.publicId}`)).json();
    expect(paired.status).toBe("paired");
    expect(paired.token).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.upsertRunner).toHaveBeenCalledWith(expect.objectContaining({ memberId: "m1", name: "mac", workspace: "/w" }));
    expect(repo.deletePairingCode).toHaveBeenCalledWith(start.code);
  });

  it("poll reports expired codes", async () => {
    vi.mocked(repo.getPairingByPublicId).mockResolvedValueOnce({ code: "1", runnerPublicId: "p", memberId: null, expiresAt: new Date(900_000) } as never);
    expect(await (await app().request("/api/pair/poll?publicId=p")).json()).toEqual({ status: "expired" });
  });

  it("confirm requires a session and a live code", async () => {
    expect((await app().request("/api/pair/confirm", { method: "POST", body: JSON.stringify({ code: "123456" }), headers: { "content-type": "application/json" } })).status).toBe(401);
    vi.mocked(repo.getPairingCode).mockResolvedValueOnce(undefined as never);
    expect((await app().request("/api/pair/confirm", { method: "POST", body: JSON.stringify({ code: "123456" }), headers: { "content-type": "application/json", cookie } })).status).toBe(404);
    vi.mocked(repo.getPairingCode).mockResolvedValueOnce({ code: "123456", memberId: null, expiresAt: new Date(1_600_000) } as never);
    vi.mocked(repo.confirmPairingCode).mockResolvedValueOnce(true);
    const ok = await app().request("/api/pair/confirm", { method: "POST", body: JSON.stringify({ code: "123456" }), headers: { "content-type": "application/json", cookie } });
    expect(ok.status).toBe(200);
    expect(repo.confirmPairingCode).toHaveBeenCalledWith("123456", "m1");
  });
});

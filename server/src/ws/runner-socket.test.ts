import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({
  findRunnerByTokenHash: vi.fn(),
  touchRunner: vi.fn(),
}));

import * as repo from "../db/repo.js";
import { runnerSocket } from "./runner-socket.js";

/** The real upgradeWebSocket wraps the handler factory; here we just call it. */
const fakeUpgrade = ((fn: unknown) => fn) as never;
const ctx = (auth?: string) => ({ req: { header: (n: string) => (n === "authorization" ? auth : undefined) } });
const ws = { send: vi.fn(), close: vi.fn() } as never;

const stubHub = () => ({ attach: vi.fn(), detach: vi.fn(), handleMessage: vi.fn(async () => {}) });

const open = async (auth?: string, hub: unknown = stubHub()) => {
  const factory = runnerSocket(hub as never, fakeUpgrade) as unknown as (c: unknown) => Promise<{
    onOpen(evt: unknown, ws: unknown): void;
    onMessage?(evt: unknown): void;
    onClose?(): void;
  }>;
  return factory(ctx(auth));
};

describe("runnerSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.touchRunner).mockResolvedValue(undefined);
  });

  it("closes the socket when the bearer token is unknown", async () => {
    vi.mocked(repo.findRunnerByTokenHash).mockResolvedValue(undefined as never);
    const handlers = await open("Bearer nope");
    handlers.onOpen({}, ws);
    expect(vi.mocked(ws.close)).toHaveBeenCalledWith(4401, "unauthorized");
  });

  it("logs, without the message body, when handling a runner message rejects", async () => {
    vi.mocked(repo.findRunnerByTokenHash).mockResolvedValue({ id: "r1", memberId: "m1", name: "mac" } as never);
    const hub = { attach: vi.fn(), detach: vi.fn(), handleMessage: vi.fn(async () => { throw new Error("hub blew up"); }) };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const factory = runnerSocket(hub as never, fakeUpgrade) as unknown as (c: unknown) => Promise<{
      onOpen(evt: unknown, ws: unknown): void;
      onMessage(evt: unknown): void;
    }>;
    const handlers = await factory(ctx("Bearer good"));
    handlers.onOpen({}, ws);
    handlers.onMessage({ data: JSON.stringify({ type: "text_delta", turnId: "t1", text: "secret" }) });
    await new Promise((r) => setTimeout(r, 0));

    expect(errors).toHaveBeenCalledWith("runner socket:", expect.any(Error));
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret");
    errors.mockRestore();
  });

  it("logs instead of rejecting when touching the runner fails", async () => {
    vi.mocked(repo.findRunnerByTokenHash).mockResolvedValue({ id: "r1", memberId: "m1", name: "mac" } as never);
    vi.mocked(repo.touchRunner).mockRejectedValue(new Error("db down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = await open("Bearer good");
    handlers.onOpen({}, ws);
    await new Promise((r) => setTimeout(r, 0));

    expect(errors).toHaveBeenCalledWith("runner socket:", expect.any(Error));
    errors.mockRestore();
  });
});

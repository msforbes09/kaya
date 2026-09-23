import { describe, expect, it, vi } from "vitest";
import { RunnerClient } from "./client.js";

const fakeSocket = () => {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const s = {
    sent: [] as string[],
    headers: {} as Record<string, string>,
    send: (d: string) => s.sent.push(d),
    close: vi.fn(),
    on: (ev: string, cb: (...a: unknown[]) => void) => { handlers[ev] = cb; },
    emit: (ev: string, ...a: unknown[]) => handlers[ev]?.(...a),
  };
  return s;
};

describe("RunnerClient", () => {
  it("connects with the bearer token and reconnects with backoff after close", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const sleeps: number[] = [];
    const client = new RunnerClient(
      { cloudUrl: "https://k.example", token: "tok", workspace: "/w" },
      {
        makeSocket: (url, headers) => { const s = fakeSocket(); s.headers = headers; sockets.push(s); expect(url).toBe("wss://k.example/runner"); return s; },
        sleep: async (ms) => { sleeps.push(ms); },
        log: () => {},
        mcpServer: {} as never,
      },
    );
    client.start();
    expect(sockets[0].headers).toEqual({ Authorization: "Bearer tok" });
    sockets[0].emit("open");
    sockets[0].emit("close");
    await new Promise((r) => setTimeout(r, 0));
    expect(sleeps).toEqual([1000]);
    expect(sockets.length).toBe(2);
    client.stop();
  });

  it("routes memory_result to the bridge and cancel to the running turn", async () => {
    const s = fakeSocket();
    const client = new RunnerClient(
      { cloudUrl: "https://k.example", token: "tok", workspace: "/w" },
      { makeSocket: () => s, sleep: async () => {}, log: () => {}, mcpServer: {} as never, runAgent: () => (async function* () { await new Promise(() => {}); })() as never },
    );
    client.start();
    s.emit("open");
    s.emit("message", JSON.stringify({ type: "turn_start", turnId: "t1", conversationId: "c1", text: "hi", resumeSessionId: null }));
    const p = client.bridge.call("recall", { query: "x" });
    const callId = JSON.parse(s.sent[0]).callId;
    s.emit("message", JSON.stringify({ type: "memory_result", callId, result: "ok" }));
    await expect(p).resolves.toBe("ok");
    s.emit("message", JSON.stringify({ type: "cancel", turnId: "t1" }));
    expect(client.currentTurnId()).toBeNull();
    client.stop();
  });

  it("rejects a pending bridge.call when the socket emits close", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const client = new RunnerClient(
      { cloudUrl: "https://k.example", token: "tok", workspace: "/w" },
      {
        makeSocket: () => { const s = fakeSocket(); sockets.push(s); return s; },
        sleep: async () => {},
        log: () => {},
        mcpServer: {} as never,
      },
    );
    client.start();
    sockets[0].emit("open");
    const p = client.bridge.call("recall", { query: "x" });
    sockets[0].emit("close");
    await expect(p).rejects.toThrow("runner disconnected");
    client.stop();
  });

  it("does not send on the old socket after close, and only reconnects after sleep resolves", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const sleeps: number[] = [];
    let resolveSleep: () => void = () => {};
    const client = new RunnerClient(
      { cloudUrl: "https://k.example", token: "tok", workspace: "/w" },
      {
        makeSocket: () => { const s = fakeSocket(); sockets.push(s); return s; },
        sleep: (ms) => { sleeps.push(ms); return new Promise<void>((r) => { resolveSleep = r; }); },
        log: () => {},
        mcpServer: {} as never,
      },
    );
    client.start();
    sockets[0].emit("open");
    sockets[0].emit("close");

    expect(() => client.bridge.call("recall", { query: "x" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(sockets[0].sent).toEqual([]);
    expect(sleeps).toEqual([1000]);
    expect(sockets.length).toBe(1);

    resolveSleep();
    await new Promise((r) => setTimeout(r, 0));
    expect(sockets.length).toBe(2);
    client.stop();
  });
});

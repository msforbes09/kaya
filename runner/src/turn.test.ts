import { describe, expect, it, vi } from "vitest";
import { executeTurn, PermissionBroker } from "./turn.js";

async function* fakeAgent() {
  yield { type: "text_delta" as const, text: "Hi" };
  yield { type: "tool_start" as const, name: "Bash", input: { command: "ls" } };
  yield { type: "done" as const, sessionId: "s1", costUsd: 0.1, fullText: "Hi" };
}

describe("executeTurn", () => {
  it("maps agent events to runner protocol messages", async () => {
    const send = vi.fn();
    const broker = new PermissionBroker(
      send,
      () => "t1",
      () => "p1",
    );
    const t = executeTurn({
      turn: { turnId: "t1", conversationId: "c1", text: "hello" },
      workspace: "/w",
      model: "sonnet",
      mcpServer: {} as never,
      send,
      permissions: broker,
      runAgent: () => fakeAgent() as never,
    });
    await t.done;
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: "text_delta", turnId: "t1", text: "Hi" },
      { type: "tool_start", turnId: "t1", name: "Bash", summary: "Running: ls" },
      { type: "turn_done", turnId: "t1", sessionId: "s1", costUsd: 0.1, fullText: "Hi" },
    ]);
  });

  it("closes the agent event stream when the turn is aborted", async () => {
    let closed = 0;
    let delivered = 0;
    const events = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        delivered++;
        return { value: { type: "text_delta" as const, text: "Hi" }, done: false };
      },
      async return(value?: unknown) {
        closed++;
        return { value, done: true as const };
      },
    };
    const send = vi.fn();
    const broker = new PermissionBroker(
      send,
      () => "t1",
      () => "p1",
    );
    const t = executeTurn({
      turn: { turnId: "t1", conversationId: "c1", text: "hello" },
      workspace: "/w",
      model: "sonnet",
      mcpServer: {} as never,
      send,
      permissions: broker,
      runAgent: () => events as never,
    });
    t.abort();
    await t.done;
    expect(closed).toBe(1);
    expect(delivered).toBeLessThan(3);
  });

  it("permission broker sends a request and resolves on the answer", async () => {
    const send = vi.fn();
    const broker = new PermissionBroker(
      send,
      () => "t1",
      () => "p1",
    );
    const p = broker.ask("Run it?", "rm -rf x");
    expect(send).toHaveBeenCalledWith({ type: "permission_request", turnId: "t1", id: "p1", question: "Run it?", detail: "rm -rf x" });
    broker.answer("p1", true);
    await expect(p).resolves.toBe(true);
  });
});

describe("executeTurn cost log", () => {
  it("logs one line per turn with cost, cache reads, and resume state", async () => {
    async function* agent() {
      yield {
        type: "done" as const,
        sessionId: "s1",
        costUsd: 0.0123,
        fullText: "",
        usage: { costUsd: 0.0123, cacheReadTokens: 5000, cacheWriteTokens: 200, inputTokens: 10, outputTokens: 40, resumed: true },
      };
    }
    const send = vi.fn();
    const log = vi.fn();
    const broker = new PermissionBroker(
      send,
      () => "t1",
      () => "p1",
    );
    await executeTurn({
      turn: { turnId: "t1", conversationId: "c1", text: "hello", resumeSessionId: "s1" },
      workspace: "/w",
      model: "sonnet",
      mcpServer: {} as never,
      send,
      permissions: broker,
      log,
      runAgent: () => agent() as never,
    }).done;
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain("session $0.0123");
    expect(line).toContain("cache read 5000");
    expect(line).toContain("resumed");
  });
});

describe("executeTurn model", () => {
  const run = async (model: string | null | undefined) => {
    let seen: string | undefined;
    async function* agent(o: { model: string }) {
      seen = o.model;
      yield { type: "done" as const, sessionId: "s", fullText: "" };
    }
    const send = vi.fn();
    await executeTurn({
      turn: { turnId: "t1", conversationId: "c1", text: "hi", model },
      workspace: "/w",
      model: "sonnet",
      mcpServer: {} as never,
      send,
      permissions: new PermissionBroker(send, () => "t1"),
      runAgent: ((o: { model: string }) => agent(o)) as never,
    }).done;
    return seen;
  };
  it("prefers the member's choice from the cloud over the runner's default", async () => {
    expect(await run("opus")).toBe("opus");
    expect(await run(null)).toBe("sonnet");
    expect(await run(undefined)).toBe("sonnet");
  });
});

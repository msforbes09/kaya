import { describe, expect, it, vi } from "vitest";
import { RunnerHub, type RunnerLink, type TurnHandlers } from "./runner-hub.js";

const link = () => {
  const sent: string[] = [];
  const l: RunnerLink & { sent: string[]; closed: number[] } = { sent, closed: [], send: (d) => sent.push(d), close: (c) => l.closed.push(c ?? 1000) };
  return l;
};
const handlers = (): TurnHandlers & Record<string, ReturnType<typeof vi.fn>> => ({
  onDelta: vi.fn(), onTool: vi.fn(), onPermission: vi.fn(), onDone: vi.fn(), onError: vi.fn(),
});
const memory = { remember: vi.fn(async () => "Remembered (1)."), recall: vi.fn(async () => "Nothing stored about that.") };

describe("RunnerHub", () => {
  it("returns null and reports offline when the member has no runner", () => {
    const hub = new RunnerHub(memory);
    expect(hub.status("m1")).toEqual({ online: false });
    expect(hub.startTurn("m1", { conversationId: "c1", text: "hi" }, handlers())).toBeNull();
  });

  it("sends turn_start to the runner and routes its events to the handlers", async () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const l = link();
    hub.attach("m1", "r1", "mac", l);
    const h = handlers();
    const t = hub.startTurn("m1", { conversationId: "c1", text: "hi", resumeSessionId: null }, h)!;
    expect(JSON.parse(l.sent[0])).toEqual({ type: "turn_start", turnId: "turn-1", conversationId: "c1", text: "hi", resumeSessionId: null });

    await hub.handleMessage("m1", JSON.stringify({ type: "text_delta", turnId: "turn-1", text: "He" }));
    await hub.handleMessage("m1", JSON.stringify({ type: "tool_start", turnId: "turn-1", name: "Bash", summary: "Running: ls" }));
    await hub.handleMessage("m1", JSON.stringify({ type: "permission_request", turnId: "turn-1", id: "p1", question: "Run?", detail: "rm" }));
    t.answerPermission("p1", true);
    await hub.handleMessage("m1", JSON.stringify({ type: "turn_done", turnId: "turn-1", sessionId: "s1", costUsd: 0.2, fullText: "Hello" }));

    expect(h.onDelta).toHaveBeenCalledWith("He");
    expect(h.onTool).toHaveBeenCalledWith("Bash", "Running: ls");
    expect(h.onPermission).toHaveBeenCalledWith("p1", "Run?", "rm");
    expect(JSON.parse(l.sent[1])).toEqual({ type: "permission_response", id: "p1", allow: true });
    expect(h.onDone).toHaveBeenCalledWith({ sessionId: "s1", costUsd: 0.2, fullText: "Hello" });
  });

  it("answers memory_call with memory_result scoped to the member", async () => {
    const hub = new RunnerHub(memory);
    const l = link();
    hub.attach("m1", "r1", "mac", l);
    await hub.handleMessage("m1", JSON.stringify({ type: "memory_call", turnId: "x", callId: "c9", tool: "recall", args: { query: "etravel" } }));
    expect(memory.recall).toHaveBeenCalledWith("m1", { query: "etravel" });
    expect(JSON.parse(l.sent[0])).toEqual({ type: "memory_result", callId: "c9", result: "Nothing stored about that." });
  });

  it("fails pending turns and reports offline when the runner disconnects", () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const l = link();
    hub.attach("m1", "r1", "mac", l);
    const h = handlers();
    hub.startTurn("m1", { conversationId: "c1", text: "hi" }, h);
    hub.detach("m1", l);
    expect(h.onError).toHaveBeenCalledWith("runner disconnected");
    expect(hub.status("m1")).toEqual({ online: false });
  });

  it("replaces an older runner link for the same member and notifies status listeners", () => {
    const hub = new RunnerHub(memory);
    const seen: boolean[] = [];
    hub.onStatusChange("m1", (s) => seen.push(s.online));
    const a = link();
    const b = link();
    hub.attach("m1", "r1", "mac", a);
    hub.attach("m1", "r2", "desk", b);
    expect(a.closed).toEqual([4409]);
    expect(hub.status("m1")).toEqual({ online: true, name: "desk", runnerId: "r2" });
    hub.detach("m1", a); // stale detach must not clear the current link
    expect(hub.status("m1").online).toBe(true);
    expect(seen).toEqual([true, true]);
  });

  it("cancel sends cancel to the runner", () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const l = link();
    hub.attach("m1", "r1", "mac", l);
    hub.startTurn("m1", { conversationId: "c1", text: "hi" }, handlers())!.cancel();
    expect(JSON.parse(l.sent[1])).toEqual({ type: "cancel", turnId: "turn-1" });
  });
});

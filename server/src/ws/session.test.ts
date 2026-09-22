import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  addMessage: vi.fn(),
  setAgentSession: vi.fn(),
}));

import * as repo from "../db/repo.js";
import { RunnerHub } from "./runner-hub.js";
import { Session } from "./session.js";

const fakeWs = () => {
  const sent: string[] = [];
  const raw: Uint8Array[] = [];
  const ws = { send: (d: string | Uint8Array) => (typeof d === "string" ? sent.push(d) : raw.push(d)) } as never;
  return { sent, raw, ws, json: () => sent.map((s) => JSON.parse(s)) };
};
const speaker = { speak: vi.fn(async () => new Uint8Array([1, 2, 3])) };
const memory = { remember: vi.fn(async () => ""), recall: vi.fn(async () => "") };
const runnerLink = () => {
  const sent: string[] = [];
  return { sent, send: (d: string) => sent.push(d), close: () => {} };
};

describe("Session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.createConversation).mockResolvedValue({ id: "c1", memberId: "m1", runnerId: null, agentSessionId: null } as never);
  });

  it("reports a thrown error to the client instead of swallowing it", async () => {
    vi.mocked(repo.createConversation).mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ws, json } = fakeWs();
    await new Session(ws, "m1", new RunnerHub(memory), speaker).handle(JSON.stringify({ type: "hello" }));
    expect(json()).toContainEqual({ type: "error", message: "db down" });
  });

  it("hello sends ready and the runner status", async () => {
    const { ws, json } = fakeWs();
    await new Session(ws, "m1", new RunnerHub(memory), speaker).handle(JSON.stringify({ type: "hello" }));
    expect(json()).toEqual([
      { type: "ready", conversationId: "c1" },
      { type: "runner_status", online: false },
    ]);
  });

  it("with no runner online, user_text speaks a fallback and stores nothing", async () => {
    const { ws, json } = fakeWs();
    const s = new Session(ws, "m1", new RunnerHub(memory), speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));
    expect(repo.addMessage).not.toHaveBeenCalled();
    expect(json()).toContainEqual({ type: "status", text: "Your runner isn't connected. Start kaya-runner on your machine." });
    expect(speaker.speak).toHaveBeenCalledWith("Your runner isn't connected. Start kaya-runner on your machine.", expect.anything());
  });

  it("routes a turn through the runner and stores both sides", async () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws, json, raw } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));

    expect(JSON.parse(link.sent[0])).toMatchObject({ type: "turn_start", turnId: "turn-1", conversationId: "c1", text: "hi", resumeSessionId: null });
    expect(repo.addMessage).toHaveBeenCalledWith("c1", "user", "hi");

    await hub.handleMessage("m1", JSON.stringify({ type: "text_delta", turnId: "turn-1", text: "Hello there." }));
    await hub.handleMessage("m1", JSON.stringify({ type: "turn_done", turnId: "turn-1", sessionId: "s1", costUsd: 0.1, fullText: "Hello there." }));
    await new Promise((r) => setTimeout(r, 0));

    expect(json()).toContainEqual({ type: "assistant_delta", text: "Hello there." });
    expect(json()).toContainEqual({ type: "assistant_done", text: "Hello there.", costUsd: 0.1 });
    expect(repo.addMessage).toHaveBeenCalledWith("c1", "assistant", "Hello there.", { costUsd: 0.1 });
    expect(repo.setAgentSession).toHaveBeenCalledWith("c1", "s1", "r1");
    expect(raw.length).toBeGreaterThan(0);
    expect(json().at(-1)).toEqual({ type: "speak_end" });
  });

  it("only resumes an agent session created on the same runner", async () => {
    vi.mocked(repo.getConversation).mockResolvedValue({ id: "c1", memberId: "m1", runnerId: "r-old", agentSessionId: "s-old" } as never);
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r-new", "mac", link);
    const { ws } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello", conversationId: "c1" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));
    expect(JSON.parse(link.sent[0]).resumeSessionId).toBeNull();
  });

  it("forwards a permission request and relays the answer", async () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws, json } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "delete it" }));
    await hub.handleMessage("m1", JSON.stringify({ type: "permission_request", turnId: "turn-1", id: "p1", question: "Run it?", detail: "rm -rf x" }));
    expect(json()).toContainEqual({ type: "permission_request", id: "p1", question: "Run it?", detail: "rm -rf x" });
    await s.handle(JSON.stringify({ type: "permission_response", id: "p1", allow: false }));
    expect(JSON.parse(link.sent[1])).toEqual({ type: "permission_response", id: "p1", allow: false });
  });
});

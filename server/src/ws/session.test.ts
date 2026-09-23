import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({
  getMember: vi.fn(),
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  addMessage: vi.fn(),
  setAgentSession: vi.fn(),
}));
vi.mock("../voice/tts.js", () => ({ ElevenLabsSpeaker: class { speak = vi.fn() } }));

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

  it("drops turn events that arrive after the turn was cancelled", async () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws, json } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));

    await s.handle(JSON.stringify({ type: "cancel" }));

    await hub.handleMessage("m1", JSON.stringify({ type: "text_delta", turnId: "turn-1", text: "Hello there." }));
    await hub.handleMessage("m1", JSON.stringify({ type: "turn_done", turnId: "turn-1", sessionId: "s1", costUsd: 0.1, fullText: "Hello there." }));
    await new Promise((r) => setTimeout(r, 0));

    expect(json()).not.toContainEqual({ type: "assistant_delta", text: "Hello there." });
    expect(json()).not.toContainEqual({ type: "assistant_done", text: "Hello there.", costUsd: 0.1 });
    expect(repo.addMessage).not.toHaveBeenCalledWith("c1", "assistant", "Hello there.", { costUsd: 0.1 });
  });

  it("closes out a cancelled turn with speak_end and nothing else", async () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws, json } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));

    await s.handle(JSON.stringify({ type: "cancel" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(json().at(-1)).toEqual({ type: "speak_end" });
    expect(json().filter((m) => m.type === "assistant_done")).toEqual([]);
  });

  it("logs instead of rejecting when storing a tool message fails", async () => {
    vi.mocked(repo.addMessage).mockImplementation(async (_conversationId, role) => {
      if (role === "tool") throw new Error("db down");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));

    await hub.handleMessage("m1", JSON.stringify({ type: "tool_start", turnId: "turn-1", name: "Bash", summary: "Running: ls" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(errors).toHaveBeenCalledWith("session: storing a tool message failed:", expect.any(Error));
    errors.mockRestore();
  });

  it("reports an error and still sends speak_end when storing the assistant message fails", async () => {
    vi.mocked(repo.addMessage).mockImplementation(async (_conversationId, role) => {
      if (role === "assistant") throw new Error("db down");
    });
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws, json } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));

    await hub.handleMessage("m1", JSON.stringify({ type: "turn_done", turnId: "turn-1", sessionId: "s1", costUsd: 0.1, fullText: "Hello there." }));
    await new Promise((r) => setTimeout(r, 0));

    expect(json()).toContainEqual({ type: "error", message: "db down" });
    expect(json().at(-1)).toEqual({ type: "speak_end" });
  });

  it("queues a second utterance while a turn is running and starts it after the turn finishes", async () => {
    let n = 0;
    const hub = new RunnerHub(memory, () => `turn-${++n}`);
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws, json } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "first" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "second" }));

    const runnerTypes = link.sent.map((m) => JSON.parse(m).type);
    expect(runnerTypes).toEqual(["turn_start"]);
    expect(json()).toContainEqual({ type: "status", text: "Queued. Kaya is still working on the last one." });

    await hub.handleMessage("m1", JSON.stringify({ type: "turn_done", turnId: "turn-1", sessionId: "s1", fullText: "Done one." }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(link.sent.map((m) => JSON.parse(m))).toContainEqual(expect.objectContaining({ type: "turn_start", turnId: "turn-2", text: "second" }));
    expect(json()).toContainEqual({ type: "user_echo", text: "second" });
  });

  it("cancel stops the running turn and drops anything queued", async () => {
    let n = 0;
    const hub = new RunnerHub(memory, () => `turn-${++n}`);
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "first" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "second" }));
    await s.handle(JSON.stringify({ type: "cancel" }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const types = link.sent.map((m) => JSON.parse(m).type);
    expect(types).toEqual(["turn_start", "cancel"]);
  });

  it("recreates the conversation when its row is gone and tells the phone the new id", async () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws, json } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    vi.mocked(repo.createConversation).mockResolvedValueOnce({ id: "c2", memberId: "m1", runnerId: null, agentSessionId: null } as never);
    vi.mocked(repo.addMessage).mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "23503" }));

    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));

    expect(json()).toContainEqual({ type: "ready", conversationId: "c2" });
    expect(repo.addMessage).toHaveBeenCalledWith("c2", "user", "hi");
    expect(JSON.parse(link.sent[0])).toMatchObject({ type: "turn_start", conversationId: "c2", text: "hi" });
    expect(json().filter((m) => m.type === "error")).toEqual([]);
  });

  it("sends the member's GitHub login with every turn so the agent can greet them", async () => {
    vi.mocked(repo.getMember).mockResolvedValue({ id: "m1", githubLogin: "arnel" } as never);
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));
    expect(JSON.parse(link.sent[0])).toMatchObject({ type: "turn_start", userName: "arnel" });
  });
});

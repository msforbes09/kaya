import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  addMessage: vi.fn(),
  setAgentSession: vi.fn(),
}));
vi.mock("../voice/tts.js", () => ({ ElevenLabsSpeaker: class { speak = vi.fn() } }));
vi.mock("../agent/runner.js", () => ({ runAgentTurn: vi.fn() }));

import * as repo from "../db/repo.js";
import { Session } from "./session.js";

const fakeWs = () => {
  const sent: string[] = [];
  return { sent, ws: { send: (d: string) => sent.push(d) } as never };
};

describe("Session.handle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports a thrown error to the client instead of swallowing it", async () => {
    vi.mocked(repo.createConversation).mockRejectedValueOnce(new Error("db down"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sent, ws } = fakeWs();

    await new Session(ws).handle(JSON.stringify({ type: "hello" }));

    const msgs = sent.map((s) => JSON.parse(s));
    expect(msgs).toContainEqual({ type: "error", message: "db down" });
    expect(errorLog).toHaveBeenCalled();
  });
});

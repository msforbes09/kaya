import { describe, expect, it } from "vitest";
import { parseCloudMessage, parseRunnerMessage, type RunnerToCloud, type CloudToRunner } from "./runner-protocol.js";

describe("runner protocol", () => {
  it("round-trips every runner→cloud message through JSON", () => {
    const msgs: RunnerToCloud[] = [
      { type: "text_delta", turnId: "t1", text: "Hi" },
      { type: "tool_start", turnId: "t1", name: "Bash", summary: "Running: ls" },
      { type: "permission_request", turnId: "t1", id: "p1", question: "Run it?", detail: "rm -rf x" },
      { type: "memory_call", turnId: "t1", callId: "c1", tool: "recall", args: { query: "x" } },
      { type: "turn_done", turnId: "t1", sessionId: "s1", costUsd: 0.1, fullText: "Hi" },
      { type: "turn_error", turnId: "t1", message: "boom" },
    ];
    for (const m of msgs) expect(parseRunnerMessage(JSON.stringify(m))).toEqual(m);
  });

  it("round-trips every cloud→runner message through JSON", () => {
    const msgs: CloudToRunner[] = [
      { type: "turn_start", turnId: "t1", conversationId: "c1", text: "hello", resumeSessionId: null },
      { type: "permission_response", id: "p1", allow: true },
      { type: "cancel", turnId: "t1" },
      { type: "memory_result", callId: "c1", result: "Nothing stored." },
    ];
    for (const m of msgs) expect(parseCloudMessage(JSON.stringify(m))).toEqual(m);
  });

  it("drops unknown types and malformed JSON", () => {
    expect(parseRunnerMessage('{"type":"nope"}')).toBeNull();
    expect(parseRunnerMessage("not json")).toBeNull();
    expect(parseCloudMessage('{"type":"nope"}')).toBeNull();
  });
});

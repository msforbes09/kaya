import { describe, expect, it } from "vitest";
import { buildQueryOptions, MAX_TURNS, resultEvents, summarizeResult } from "./runner.js";

describe("buildQueryOptions", () => {
  it("pins the model and resumes the previous session", () => {
    const o = buildQueryOptions({ workspace: "/w", resumeSessionId: "s1", model: "sonnet", mcpServer: {} as never, ask: async () => true });
    expect(o.model).toBe("sonnet");
    expect(o.resume).toBe("s1");
    expect(o.cwd).toBe("/w");
  });

  it("puts the member's name into the system prompt", () => {
    const o = buildQueryOptions({
      workspace: "/w",
      resumeSessionId: null,
      model: "sonnet",
      userName: "arnel",
      mcpServer: {} as never,
      ask: async () => true,
    });
    expect(String(o.systemPrompt)).toContain("arnel");
  });

  it("registers the secrets gate as a PreToolUse hook that matches every tool", () => {
    const o = buildQueryOptions({
      workspace: "/w",
      resumeSessionId: null,
      model: "sonnet",
      userName: "",
      mcpServer: {} as never,
      ask: async () => true,
    });
    const pre = o.hooks?.PreToolUse ?? [];
    expect(pre.length).toBe(1);
    expect(pre[0].matcher).toBeUndefined();
    expect(pre[0].hooks.length).toBe(1);
  });

  it("never loads the workspace's own settings, so its allow rules cannot bypass the gate", () => {
    const o = buildQueryOptions({
      workspace: "/w",
      resumeSessionId: null,
      model: "sonnet",
      userName: "",
      mcpServer: {} as never,
      ask: async () => true,
    });
    expect(o.settingSources).toBeUndefined();
  });

  it("starts fresh when there is no session to resume", () => {
    const o = buildQueryOptions({ workspace: "/w", resumeSessionId: null, model: "sonnet", mcpServer: {} as never, ask: async () => true });
    expect(o.resume).toBeUndefined();
  });
});

describe("summarizeResult", () => {
  it("reports cost, cache reads, and whether the session was reused", () => {
    const r = {
      total_cost_usd: 0.0123,
      session_id: "s1",
      usage: { input_tokens: 10, cache_read_input_tokens: 5000, cache_creation_input_tokens: 200, output_tokens: 40 },
    };
    expect(summarizeResult(r, "s1")).toEqual({
      costUsd: 0.0123,
      cacheReadTokens: 5000,
      cacheWriteTokens: 200,
      inputTokens: 10,
      outputTokens: 40,
      resumed: true,
    });
    expect(summarizeResult(r, null).resumed).toBe(false);
    expect(summarizeResult(r, "other").resumed).toBe(false);
  });

  it("tolerates a result without usage", () => {
    expect(summarizeResult({ session_id: "s1" }, "s1")).toEqual({
      costUsd: undefined,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      resumed: true,
    });
  });
});

describe("resultEvents", () => {
  it("turns a max-turns stop into a spoken line and a normal done, not an error", () => {
    const ev = resultEvents({ subtype: "error_max_turns", is_error: true, session_id: "s1" }, "s1", "Partial reply.", null);
    expect(ev.map((e) => e.type)).toEqual(["text_delta", "done"]);
    expect((ev[0] as { text: string }).text).toMatch(/step limit/i);
    expect((ev[0] as { text: string }).text).toMatch(/continue/i);
    expect((ev[1] as { fullText: string }).fullText).toContain("step limit");
  });

  it("still reports other failures as errors", () => {
    const ev = resultEvents({ subtype: "error_during_execution", is_error: true, result: "boom", session_id: "s1" }, "s1", "", null);
    expect(ev.map((e) => e.type)).toEqual(["error", "done"]);
    expect((ev[0] as { message: string }).message).toBe("boom");
  });

  it("gives a real task room: the cap is well above forty", () => {
    expect(MAX_TURNS).toBeGreaterThanOrEqual(150);
    expect(
      buildQueryOptions({
        workspace: "/w",
        resumeSessionId: null,
        model: "sonnet",
        userName: "",
        mcpServer: {} as never,
        ask: async () => true,
      }).maxTurns,
    ).toBe(MAX_TURNS);
  });
});

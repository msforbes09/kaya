import { describe, expect, it } from "vitest";
import { buildQueryOptions, summarizeResult } from "./runner.js";

describe("buildQueryOptions", () => {
  it("pins the model and resumes the previous session", () => {
    const o = buildQueryOptions({ workspace: "/w", resumeSessionId: "s1", model: "sonnet", mcpServer: {} as never, ask: async () => true });
    expect(o.model).toBe("sonnet");
    expect(o.resume).toBe("s1");
    expect(o.cwd).toBe("/w");
  });

  it("starts fresh when there is no session to resume", () => {
    const o = buildQueryOptions({ workspace: "/w", resumeSessionId: null, model: "sonnet", mcpServer: {} as never, ask: async () => true });
    expect(o.resume).toBeUndefined();
  });
});

describe("summarizeResult", () => {
  it("reports cost, cache reads, and whether the session was reused", () => {
    const r = { total_cost_usd: 0.0123, session_id: "s1", usage: { input_tokens: 10, cache_read_input_tokens: 5000, cache_creation_input_tokens: 200, output_tokens: 40 } };
    expect(summarizeResult(r, "s1")).toEqual({ costUsd: 0.0123, cacheReadTokens: 5000, cacheWriteTokens: 200, inputTokens: 10, outputTokens: 40, resumed: true });
    expect(summarizeResult(r, null).resumed).toBe(false);
    expect(summarizeResult(r, "other").resumed).toBe(false);
  });

  it("tolerates a result without usage", () => {
    expect(summarizeResult({ session_id: "s1" }, "s1")).toEqual({ costUsd: undefined, cacheReadTokens: 0, cacheWriteTokens: 0, inputTokens: 0, outputTokens: 0, resumed: true });
  });
});

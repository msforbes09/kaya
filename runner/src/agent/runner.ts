import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { KAYA_SYSTEM_PROMPT } from "./prompt.js";
import { KAYA_TOOL_NAMES, createKayaMcpServer } from "./tools.js";
import { AUTO_ALLOWED, buildCanUseTool, type PermissionAsk } from "./permissions.js";
import { buildAgentEnv } from "./env.js";

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string; input: unknown }
  | { type: "status"; text: string }
  | { type: "done"; sessionId: string; costUsd?: number; fullText: string }
  | { type: "error"; message: string };

export interface RunOptions {
  prompt: string;
  resumeSessionId?: string | null;
  ask: PermissionAsk;
  signal?: AbortSignal;
}

/**
 * Runs one turn of the agent and yields events as they happen.
 * Text arrives token by token via `text_delta`, which the caller feeds to TTS.
 */
export async function* runAgentTurn(
  opts: RunOptions & { workspace: string; mcpServer: ReturnType<typeof createKayaMcpServer> },
): AsyncGenerator<AgentEvent> {
  const abort = new AbortController();
  opts.signal?.addEventListener("abort", () => abort.abort());

  let sessionId = opts.resumeSessionId ?? "";
  let fullText = "";

  const stream = query({
    prompt: opts.prompt,
    options: {
      cwd: opts.workspace,
      resume: opts.resumeSessionId ?? undefined,
      systemPrompt: KAYA_SYSTEM_PROMPT(opts.workspace),
      includePartialMessages: true,
      mcpServers: { kaya: opts.mcpServer },
      allowedTools: [...AUTO_ALLOWED, ...KAYA_TOOL_NAMES],
      canUseTool: buildCanUseTool(opts.ask),
      abortController: abort,
      maxTurns: 40,
      env: buildAgentEnv(process.env, process.env.ANTHROPIC_API_KEY),
    },
  });

  try {
    for await (const msg of stream as AsyncIterable<SDKMessage>) {
      const m = msg as Record<string, any>;
      if (m.session_id) sessionId = m.session_id;

      switch (m.type) {
        case "stream_event": {
          const ev = m.event;
          if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            fullText += ev.delta.text;
            yield { type: "text_delta", text: ev.delta.text };
          }
          break;
        }
        case "assistant": {
          const blocks = m.message?.content ?? [];
          for (const b of blocks) {
            if (b.type === "tool_use") yield { type: "tool_start", name: b.name, input: b.input };
          }
          break;
        }
        case "result": {
          if (m.subtype !== "success" && m.is_error) {
            yield { type: "error", message: m.result ?? `Agent ended with ${m.subtype}` };
          }
          yield { type: "done", sessionId, costUsd: m.total_cost_usd, fullText };
          break;
        }
      }
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

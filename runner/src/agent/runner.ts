import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { KAYA_PORTS, KAYA_SYSTEM_PROMPT } from "./prompt.js";
import { TextJoiner } from "./text-joiner.js";
import { KAYA_TOOL_NAMES, createKayaMcpServer } from "./tools.js";
import { AUTO_ALLOWED, buildCanUseTool, preToolUseGate, type PermissionAsk } from "./permissions.js";
import { buildAgentEnv } from "./env.js";

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string; input: unknown }
  | { type: "status"; text: string }
  | { type: "done"; sessionId: string; costUsd?: number; fullText: string; usage?: TurnUsage }
  | { type: "error"; message: string };

export interface RunOptions {
  prompt: string;
  resumeSessionId?: string | null;
  /** Claude model alias or id. The SDK default is the top model, which costs about a dollar a turn. */
  model: string;
  /** How the agent addresses the member. Empty when unknown. */
  userName: string;
  ask: PermissionAsk;
  signal?: AbortSignal;
}

export interface TurnUsage {
  costUsd?: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
  outputTokens: number;
  /** True when the SDK continued the session we asked it to resume. */
  resumed: boolean;
}

type QueryInputs = Pick<RunOptions, "resumeSessionId" | "model" | "ask" | "userName"> & {
  workspace: string;
  mcpServer: ReturnType<typeof createKayaMcpServer>;
  abortController?: AbortController;
};

/** Everything passed to the SDK for one turn, kept pure so the model and resume wiring can be tested. */
export function buildQueryOptions(o: QueryInputs): Options {
  return {
    cwd: o.workspace,
    model: o.model,
    resume: o.resumeSessionId ?? undefined,
    systemPrompt: KAYA_SYSTEM_PROMPT(o.workspace, KAYA_PORTS, o.userName),
    includePartialMessages: true,
    mcpServers: { kaya: o.mcpServer },
    allowedTools: [...AUTO_ALLOWED, ...KAYA_TOOL_NAMES],
    canUseTool: buildCanUseTool(o.ask),
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input) => {
              const i = input as { tool_name?: string; tool_input?: unknown };
              return preToolUseGate(String(i.tool_name ?? ""), i.tool_input);
            },
          ],
        },
      ],
    },
    abortController: o.abortController,
    maxTurns: MAX_TURNS,
    env: buildAgentEnv(process.env, process.env.ANTHROPIC_API_KEY),
  };
}

/** Tool calls one turn may make. Hit in practice at 40 by a screenshot-heavy browser check; the thread stays resumable either way. */
export const MAX_TURNS = 200;

const STEP_LIMIT_LINE = " I reached my step limit for one turn, so I stopped there. Say continue and I will pick it up.";

/**
 * Events for the SDK's final result message. A max-turns stop is not a
 * failure: the work so far is kept and the session resumes on the next turn,
 * so it is spoken as a status line rather than shown as an error.
 */
export function resultEvents(
  m: Record<string, any>,
  sessionId: string,
  fullText: string,
  resumeSessionId: string | null | undefined,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  let text = fullText;
  if (m.subtype === "error_max_turns") {
    const line = fullText.length > 0 && !/\s$/.test(fullText) ? STEP_LIMIT_LINE : STEP_LIMIT_LINE.trimStart();
    text += line;
    events.push({ type: "text_delta", text: line });
  } else if (m.subtype !== "success" && m.is_error) {
    events.push({ type: "error", message: m.result ?? `Agent ended with ${m.subtype}` });
  }
  events.push({ type: "done", sessionId, costUsd: m.total_cost_usd, fullText: text, usage: summarizeResult(m, resumeSessionId) });
  return events;
}

/** Pulls cost and cache numbers out of the SDK result message. */
export function summarizeResult(result: Record<string, any>, resumeSessionId: string | null | undefined): TurnUsage {
  const u = result.usage ?? {};
  return {
    costUsd: result.total_cost_usd,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    resumed: Boolean(resumeSessionId) && result.session_id === resumeSessionId,
  };
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
  const joiner = new TextJoiner();

  const stream = query({
    prompt: opts.prompt,
    options: buildQueryOptions({ ...opts, abortController: abort }),
  });

  try {
    for await (const msg of stream as AsyncIterable<SDKMessage>) {
      const m = msg as Record<string, any>;
      if (m.session_id) sessionId = m.session_id;

      switch (m.type) {
        case "stream_event": {
          const ev = m.event;
          if (ev?.type === "content_block_start" && ev.content_block?.type === "text") joiner.blockStart();
          if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            const text = joiner.delta(ev.delta.text);
            if (text) yield { type: "text_delta", text };
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
          for (const ev of resultEvents(m, sessionId, joiner.text, opts.resumeSessionId)) yield ev;
          break;
        }
      }
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

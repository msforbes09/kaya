import { randomUUID } from "node:crypto";
import { runAgentTurn, type AgentEvent } from "./agent/runner.js";
import { summarizeTool } from "./agent/summarize.js";
import type { createKayaMcpServer } from "./agent/tools.js";
import type { RunnerToCloud } from "./protocol.js";

/** Generates permission ids, sends the request to the cloud, and resolves when the answer comes back. */
export class PermissionBroker {
  private waiting = new Map<string, (allow: boolean) => void>();
  constructor(
    private readonly send: (m: RunnerToCloud) => void,
    private readonly currentTurnId: () => string,
    private readonly newId: () => string = randomUUID,
  ) {}
  ask(question: string, detail: string): Promise<boolean> {
    const id = this.newId();
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.send({ type: "permission_request", turnId: this.currentTurnId(), id, question, detail });
    });
  }
  answer(id: string, allow: boolean): void {
    const r = this.waiting.get(id);
    if (!r) return;
    this.waiting.delete(id);
    r(allow);
  }
  cancelAll(): void {
    for (const r of this.waiting.values()) r(false);
    this.waiting.clear();
  }
}

export interface ExecuteOptions {
  turn: { turnId: string; conversationId: string; text: string; resumeSessionId?: string | null };
  workspace: string;
  mcpServer: ReturnType<typeof createKayaMcpServer>;
  send: (m: RunnerToCloud) => void;
  permissions: PermissionBroker;
  runAgent?: typeof runAgentTurn;
}

export function executeTurn(opts: ExecuteOptions): { done: Promise<void>; abort(): void } {
  const abort = new AbortController();
  const { turnId } = opts.turn;
  const run = opts.runAgent ?? runAgentTurn;

  const done = (async () => {
    const events: AsyncGenerator<AgentEvent> = run({
      prompt: opts.turn.text,
      resumeSessionId: opts.turn.resumeSessionId ?? null,
      ask: (q, d) => opts.permissions.ask(q, d),
      signal: abort.signal,
      workspace: opts.workspace,
      mcpServer: opts.mcpServer,
    });
    for await (const ev of events) {
      if (abort.signal.aborted) break;
      switch (ev.type) {
        case "text_delta":
          opts.send({ type: "text_delta", turnId, text: ev.text });
          break;
        case "tool_start":
          opts.send({ type: "tool_start", turnId, name: ev.name, summary: summarizeTool(ev.name, ev.input) });
          break;
        case "done":
          opts.send({ type: "turn_done", turnId, sessionId: ev.sessionId, costUsd: ev.costUsd, fullText: ev.fullText });
          break;
        case "error":
          opts.send({ type: "turn_error", turnId, message: ev.message });
          break;
        case "status":
          break;
      }
    }
  })().catch((err) => opts.send({ type: "turn_error", turnId, message: err instanceof Error ? err.message : String(err) }));

  return { done, abort: () => { abort.abort(); opts.permissions.cancelAll(); } };
}

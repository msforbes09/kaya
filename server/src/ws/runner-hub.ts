import { randomUUID } from "node:crypto";
import { parseRunnerMessage, type CloudToRunner } from "./runner-protocol.js";

export interface RunnerLink {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface TurnHandlers {
  onDelta(text: string): void;
  onTool(name: string, summary: string): void;
  onPermission(id: string, question: string, detail: string): void;
  onDone(r: { sessionId: string; costUsd?: number; fullText: string }): void;
  onError(message: string): void;
}

export interface MemoryService {
  remember(memberId: string, args: Record<string, unknown>): Promise<string>;
  recall(memberId: string, args: Record<string, unknown>): Promise<string>;
}

interface Live {
  runnerId: string;
  name: string;
  link: RunnerLink;
  turns: Map<string, TurnHandlers>;
}

type StatusListener = (s: { online: boolean; name?: string }) => void;

/** Maps members to their single live runner and routes turn traffic both ways. */
export class RunnerHub {
  private live = new Map<string, Live>();
  private listeners = new Map<string, Set<StatusListener>>();

  constructor(
    private readonly memory: MemoryService,
    private readonly newId: () => string = randomUUID,
  ) {}

  attach(memberId: string, runnerId: string, name: string, link: RunnerLink): void {
    const prev = this.live.get(memberId);
    if (prev) {
      for (const h of prev.turns.values()) h.onError("runner replaced");
      prev.link.close(4409, "replaced by a newer runner");
    }
    this.live.set(memberId, { runnerId, name, link, turns: new Map() });
    this.emit(memberId);
  }

  detach(memberId: string, link: RunnerLink): void {
    const cur = this.live.get(memberId);
    if (!cur || cur.link !== link) return;
    for (const h of cur.turns.values()) h.onError("runner disconnected");
    this.live.delete(memberId);
    this.emit(memberId);
  }

  status(memberId: string): { online: boolean; name?: string; runnerId?: string } {
    const cur = this.live.get(memberId);
    return cur ? { online: true, name: cur.name, runnerId: cur.runnerId } : { online: false };
  }

  /** True while the member's runner is executing a turn for any session. */
  busy(memberId: string): boolean {
    return (this.live.get(memberId)?.turns.size ?? 0) > 0;
  }

  onStatusChange(memberId: string, cb: StatusListener): () => void {
    const set = this.listeners.get(memberId) ?? new Set();
    set.add(cb);
    this.listeners.set(memberId, set);
    return () => set.delete(cb);
  }

  startTurn(
    memberId: string,
    turn: { conversationId: string; text: string; resumeSessionId?: string | null; userName: string },
    handlers: TurnHandlers,
  ) {
    const cur = this.live.get(memberId);
    if (!cur) return null;
    // A runner executes one turn at a time and aborts the previous on a new
    // turn_start, so a second phone session must not be allowed to start one.
    if (cur.turns.size > 0) return "busy";
    const turnId = this.newId();
    cur.turns.set(turnId, handlers);
    this.push(cur, {
      type: "turn_start",
      turnId,
      conversationId: turn.conversationId,
      text: turn.text,
      resumeSessionId: turn.resumeSessionId ?? null,
      userName: turn.userName,
    });
    return {
      turnId,
      // Drop the handlers first: the runner may still be mid-turn, and nothing
      // it sends for this id afterwards belongs to the caller any more.
      cancel: () => {
        cur.turns.delete(turnId);
        this.push(cur, { type: "cancel", turnId });
      },
      answerPermission: (id: string, allow: boolean) => this.push(cur, { type: "permission_response", id, allow }),
    };
  }

  async handleMessage(memberId: string, raw: string): Promise<void> {
    const cur = this.live.get(memberId);
    const msg = parseRunnerMessage(raw);
    if (!cur || !msg) return;

    if (msg.type === "memory_call") {
      const result =
        msg.tool === "remember" ? await this.memory.remember(memberId, msg.args) : await this.memory.recall(memberId, msg.args);
      const fresh = this.live.get(memberId);
      if (fresh) {
        this.push(fresh, { type: "memory_result", callId: msg.callId, result });
      }
      return;
    }

    const h = cur.turns.get(msg.turnId);
    if (!h) return;
    switch (msg.type) {
      case "text_delta":
        return h.onDelta(msg.text);
      case "tool_start":
        return h.onTool(msg.name, msg.summary);
      case "permission_request":
        return h.onPermission(msg.id, msg.question, msg.detail);
      case "turn_done":
        cur.turns.delete(msg.turnId);
        return h.onDone({ sessionId: msg.sessionId, costUsd: msg.costUsd, fullText: msg.fullText });
      case "turn_error":
        cur.turns.delete(msg.turnId);
        return h.onError(msg.message);
    }
  }

  private push(cur: Live, msg: CloudToRunner) {
    cur.link.send(JSON.stringify(msg));
  }

  private emit(memberId: string) {
    const s = this.status(memberId);
    for (const cb of this.listeners.get(memberId) ?? []) cb({ online: s.online, name: s.name });
  }
}

import { randomUUID } from "node:crypto";

type MemoryCall = { type: "memory_call"; turnId: string; callId: string; tool: "remember" | "recall"; args: Record<string, unknown> };

/** Lets the agent's memory tools call the cloud over the runner socket and await the answer. */
export class MemoryBridge {
  private waiting = new Map<string, { resolve: (result: string) => void; reject: (err: Error) => void }>();

  constructor(
    private readonly send: (msg: MemoryCall) => void,
    private readonly currentTurnId: () => string,
    private readonly newId: () => string = randomUUID,
  ) {}

  call(tool: "remember" | "recall", args: Record<string, unknown>): Promise<string> {
    const callId = this.newId();
    return new Promise((resolve, reject) => {
      this.waiting.set(callId, { resolve, reject });
      this.send({ type: "memory_call", turnId: this.currentTurnId(), callId, tool, args });
    });
  }

  resolve(callId: string, result: string): void {
    const r = this.waiting.get(callId);
    if (!r) return;
    this.waiting.delete(callId);
    r.resolve(result);
  }

  rejectAll(reason: string): void {
    for (const r of this.waiting.values()) r.reject(new Error(reason));
    this.waiting.clear();
  }

  pending(): number {
    return this.waiting.size;
  }
}

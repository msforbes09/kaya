import { z } from "zod";
import type { MemoryService } from "./ws/runner-hub.js";

export const MEMORY_KINDS = ["fact", "decision", "preference", "project"] as const;

export const rememberArgs = z.object({
  kind: z.enum(MEMORY_KINDS),
  subject: z.string().min(1),
  content: z.string().min(1),
});

export const recallArgs = z.object({ query: z.string().min(1) });

const INVALID = "Invalid memory call.";

export interface MemoryRepo {
  remember(memberId: string, kind: (typeof MEMORY_KINDS)[number], subject: string, content: string): Promise<{ id: string }>;
  recall(memberId: string, query: string): Promise<{ kind: string; subject: string; content: string }[]>;
}

/**
 * The runner's memory tools reach the DB through here. Args come off the
 * runner socket, so they are validated before anything touches Postgres: a bad
 * call answers the agent instead of rejecting into the process.
 */
export function memoryServiceFor(repo: MemoryRepo): MemoryService {
  return {
    async remember(memberId, args) {
      const parsed = rememberArgs.safeParse(args);
      if (!parsed.success) return INVALID;
      const row = await repo.remember(memberId, parsed.data.kind, parsed.data.subject, parsed.data.content);
      return `Remembered (${row.id}).`;
    },
    async recall(memberId, args) {
      const parsed = recallArgs.safeParse(args);
      if (!parsed.success) return INVALID;
      const rows = await repo.recall(memberId, parsed.data.query);
      if (rows.length === 0) return "Nothing stored about that.";
      return rows.map((r) => `[${r.kind}] ${r.subject}: ${r.content}`).join("\n");
    },
  };
}

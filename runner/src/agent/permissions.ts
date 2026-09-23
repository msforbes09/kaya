import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

import destructivePatterns from "./destructive-patterns.json" with { type: "json" };

/**
 * Bash commands that are never auto-approved, whatever the mode.
 * Shared with the dev hook `.claude/hooks/block-dangerous-bash.js`.
 */
const DESTRUCTIVE = destructivePatterns.map((p) => new RegExp(p.source, p.flags));

/** Tools safe to run without asking. */
export const AUTO_ALLOWED = ["Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "TodoWrite"];

export type PermissionAsk = (question: string, detail: string) => Promise<boolean>;

/**
 * Builds the SDK `canUseTool` callback. Everything not in AUTO_ALLOWED lands here.
 * Edits are approved silently; Bash is screened for destructive patterns and
 * otherwise approved; anything destructive asks the human over the WebSocket.
 */
export function buildCanUseTool(ask: PermissionAsk): CanUseTool {
  return async (toolName, input) => {
    if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit" || toolName === "NotebookEdit") {
      return { behavior: "allow", updatedInput: input };
    }

    if (toolName === "Bash") {
      const cmd = String((input as { command?: string }).command ?? "");
      const destructive = DESTRUCTIVE.some((re) => re.test(cmd));
      if (!destructive) return { behavior: "allow", updatedInput: input };
      const ok = await ask("This command looks destructive. Run it?", cmd);
      return ok
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "User declined the destructive command." };
    }

    // Unknown tool: ask.
    const ok = await ask(`Allow ${toolName}?`, JSON.stringify(input).slice(0, 400));
    return ok
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: `User declined ${toolName}.` };
  };
}

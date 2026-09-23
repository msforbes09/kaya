import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

import destructivePatterns from "./destructive-patterns.json" with { type: "json" };

/**
 * Bash commands that are never auto-approved, whatever the mode.
 * Shared with the dev hook `.claude/hooks/block-dangerous-bash.js`.
 */
const DESTRUCTIVE = destructivePatterns.map((p) => new RegExp(p.source, p.flags));

/**
 * Tools safe to run without asking. Read, Grep and Glob are deliberately not
 * here: bare `allowedTools` entries skip `canUseTool`, and the gate below has
 * to see file paths to keep secrets files away from the model.
 */
export const AUTO_ALLOWED = ["LS", "WebFetch", "WebSearch", "TodoWrite"];

/** Files whose contents must never reach the model, the transcript, or TTS. */
const SECRET_FILE_PATTERNS = [
  /(^|[\/\\])\.env(\.[^\/\\]*)?$/i,
  /(^|[\/\\])id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|[\/\\])\.(netrc|npmrc|pypirc)$/,
  /(^|[\/\\])\.aws[\/\\]credentials$/,
  /(^|[\/\\])\.kaya[\/\\]runner\.json$/,
  /(^|[\/\\])\.(ssh|gnupg)[\/\\]/,
];
const NOT_SECRET = [/\.env\.example$/i, /\.env\.sample$/i, /\.env\.template$/i];

export function isSecretPath(path: string): boolean {
  if (!path) return false;
  if (NOT_SECRET.some((re) => re.test(path))) return false;
  return SECRET_FILE_PATTERNS.some((re) => re.test(path));
}

/** A shell command that names a secrets file, in any position. */
function touchesSecretFile(cmd: string): boolean {
  return cmd.split(/[\s;|&<>()'"`]+/).some((word) => isSecretPath(word));
}

const READ_TOOLS = new Set(["Read", "Grep", "Glob", "NotebookRead"]);

export type PermissionAsk = (question: string, detail: string) => Promise<boolean>;

/**
 * Builds the SDK `canUseTool` callback. Everything not in AUTO_ALLOWED lands here.
 * Edits are approved silently; Bash is screened for destructive patterns and
 * otherwise approved; anything destructive asks the human over the WebSocket.
 */
export function buildCanUseTool(ask: PermissionAsk): CanUseTool {
  return async (toolName, input) => {
    if (READ_TOOLS.has(toolName)) {
      const p = String((input as { file_path?: string; path?: string }).file_path ?? (input as { path?: string }).path ?? "");
      return isSecretPath(p)
        ? { behavior: "deny", message: "Kaya never reads secrets files." }
        : { behavior: "allow", updatedInput: input };
    }

    if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit" || toolName === "NotebookEdit") {
      return { behavior: "allow", updatedInput: input };
    }

    if (toolName === "Bash") {
      const cmd = String((input as { command?: string }).command ?? "");
      const destructive = DESTRUCTIVE.some((re) => re.test(cmd));
      const secret = touchesSecretFile(cmd);
      if (!destructive && !secret) return { behavior: "allow", updatedInput: input };
      const ok = await ask(secret ? "This command touches a secrets file. Run it?" : "This command looks destructive. Run it?", cmd);
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

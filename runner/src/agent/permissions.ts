import type { CanUseTool, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

import destructivePatterns from "./destructive-patterns.json" with { type: "json" };

/**
 * Bash commands that are never auto-approved, whatever the mode.
 * Shared with the dev hook `.claude/hooks/block-dangerous-bash.js`.
 */
const DESTRUCTIVE = destructivePatterns.map((p) => new RegExp(p.source, p.flags));

/**
 * Tools loaded and approved up front. The CLI auto-approves read-only tools and
 * read-only shell commands before `canUseTool` is ever consulted, so the secrets
 * screen lives in `preToolUseGate`, a PreToolUse hook, which the CLI runs for
 * every tool call. Read, Grep and Glob must be listed or they are left deferred
 * and the model falls back to `grep -r` in Bash.
 */
export const AUTO_ALLOWED = ["Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "TodoWrite"];

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

/** Grep glob that skips every secrets file when the model did not choose one itself. */
const SECRET_EXCLUDE_GLOB =
  "!{.env,.env.*,*.pem,*.key,*.p12,*.pfx,*.jks,*.keystore,id_rsa*,id_dsa*,id_ecdsa*,id_ed25519*,.netrc,.npmrc,.pypirc}";

const pre = (permissionDecision: "allow" | "deny" | "ask", extra: Record<string, unknown> = {}): HookJSONOutput => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, ...extra },
});

/**
 * PreToolUse gate. Verified against the CLI: read-only tools and read-only
 * shell commands (`ls`, `cat .env`) never reach `canUseTool`, but every call
 * passes through here first. Deny secrets reads, rewrite directory greps to
 * skip secrets files, and turn destructive or secrets-touching shell commands
 * into an "ask", which the CLI then routes to `canUseTool` and the human.
 */
export async function preToolUseGate(toolName: string, input: unknown): Promise<HookJSONOutput> {
  const i = (input ?? {}) as Record<string, unknown>;
  if (READ_TOOLS.has(toolName)) {
    const p = String(i.file_path ?? i.path ?? "");
    if (isSecretPath(p)) return pre("deny", { permissionDecisionReason: "Kaya never reads secrets files." });
    if (toolName === "Grep" && !i.glob) return pre("allow", { updatedInput: { ...i, glob: SECRET_EXCLUDE_GLOB } });
    return {};
  }
  if (toolName === "Bash") {
    const cmd = String(i.command ?? "");
    if (DESTRUCTIVE.some((re) => re.test(cmd))) return pre("ask", { permissionDecisionReason: "destructive command" });
    if (touchesSecretFile(cmd)) return pre("ask", { permissionDecisionReason: "touches a secrets file" });
  }
  return {};
}

export type PermissionAsk = (question: string, detail: string) => Promise<boolean>;

/**
 * Builds the SDK `canUseTool` callback. Everything not in AUTO_ALLOWED lands here.
 * Edits are approved silently; Bash is screened for destructive patterns and
 * otherwise approved; anything destructive asks the human over the WebSocket.
 */
export function buildCanUseTool(ask: PermissionAsk): CanUseTool {
  return async (toolName, input) => {
    if (READ_TOOLS.has(toolName)) {
      // Only reachable if the hook let it through; the path screen already ran there.
      return { behavior: "allow", updatedInput: input };
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
      return ok ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "User declined the destructive command." };
    }

    // Unknown tool: ask.
    const ok = await ask(`Allow ${toolName}?`, JSON.stringify(input).slice(0, 400));
    return ok ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: `User declined ${toolName}.` };
  };
}

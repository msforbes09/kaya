/**
 * Environment for the Agent SDK child process, built from an allowlist.
 *
 * The runner is often started from a developer's shell, which can carry
 * another Claude Code session's variables (messaging tokens, entrypoints, a
 * different ANTHROPIC_BASE_URL) and unrelated credentials. None of that
 * belongs in the agent's process. The child needs PATH and HOME (the `claude`
 * login lives under HOME or CLAUDE_CONFIG_DIR), the locale, and a temp dir.
 * The API key is injected only when the runner is configured with one.
 */
const PASS_THROUGH = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP", "TERM", "TZ", "CLAUDE_CONFIG_DIR"];
const PASS_THROUGH_PREFIXES = ["LANG", "LC_"];

export function buildAgentEnv(base: Record<string, string | undefined>, apiKey: string | undefined): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (PASS_THROUGH.includes(k) || PASS_THROUGH_PREFIXES.some((p) => k.startsWith(p))) env[k] = v;
  }
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  return env;
}

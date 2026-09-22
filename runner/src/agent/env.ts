/**
 * Environment for the Agent SDK child process. The API key is only injected
 * when configured; otherwise the CLI's own login (claude.ai subscription) is used.
 */
export function buildAgentEnv(
  base: Record<string, string | undefined>,
  apiKey: string | undefined,
): Record<string, string | undefined> {
  const env = { ...base };
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  return env;
}

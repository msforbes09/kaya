---
paths:
  - "server/src/agent/**"
---
# Agent layer rules

- `runner.ts` is the only place that calls the SDK `query()`. Every SDK message shape it reads (`stream_event`, `assistant`, `result`) is checked against the installed `@anthropic-ai/claude-agent-sdk` types, not memory.
- `permissions.ts` owns the tiers: auto-allowed read tools, silent edits, screened Bash, ask for everything else. Do not add allow paths elsewhere.
- Destructive Bash patterns live in `destructive-patterns.json`. The dev hook `.claude/hooks/block-dangerous-bash.js` reads the same file. Add a pattern there and a test that a sample command matches.
- `prompt.ts` is the spoken persona. Short sentences, no markdown, one clarifying question at most. Never inject env values other than the workspace path.
- Tools in `tools.ts` reach the model as `mcp__kaya__<name>`. Add the new name to `KAYA_TOOL_NAMES` and a summary case in `ws/session.ts`.
- Memory tools must never store secrets. If a value looks like a token or key, refuse and say so.

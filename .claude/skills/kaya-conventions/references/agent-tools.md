# Adding an agent tool

1. Define it in `server/src/agent/tools.ts` with `tool(name, description, zodShape, handler, annotations)`.
2. Add `mcp__kaya__<name>` to `KAYA_TOOL_NAMES` so it is auto-allowed.
3. Add a `case` in `summarizeTool` in `server/src/ws/session.ts` so the UI and TTS can say what the tool is doing in one short sentence.
4. If it writes to Postgres, put the query in `server/src/db/repo.ts`. Handlers do not touch the client directly.
5. Memory safety: reject content that looks like a credential (long hex or base64 runs, `sk-`, `key=`), and say so in the tool result.

Test first: call the handler directly with a valid input and assert on the returned `content`. Mock `repo.ts`.

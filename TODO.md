# TODO (deferred work)

- Formatter not chosen yet. Add Prettier or Biome, then wire `.claude/hooks/format-on-save.sh` into `settings.json`.
- Vitest is set up in `server/` (`npm test`). Add it to `web/` too, with a `test` script that prints only failures.
- Decide whether runtime Kaya should read the target repo's own `.claude/` folder instead of a hard-coded system prompt.
- Embeddings column exists in the schema but is unused in v1.
- SDK warns `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`: bare names in `allowedTools` bypass `canUseTool`. Intended for the read-only set, but decide whether to move gating to a PreToolUse hook so one path handles everything.
- Server crashes on an unhandled DB error inside the WebSocket `onOpen` (seen when tables were missing). Catch it, send an `error` message, close the socket.
- Token travels in the `/ws?token=` query string and the Hono logger prints it. Move to a first-message auth handshake and stop logging the URL.

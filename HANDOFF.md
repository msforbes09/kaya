# Handoff to Claude Code

This scaffold was written without network access, so nothing has been installed or run yet.
First session in Claude Code should:

1. `npm install` at the root (workspaces install server + web).
2. Fix any type errors against the real package versions — most likely spots:
   - `server/src/agent/runner.ts`: SDK message shapes (`stream_event`, `result`) — check against
     https://code.claude.com/docs/en/agent-sdk/typescript.md
   - `server/src/voice/tts.ts`: `elevenlabs.textToSpeech.stream(...)` option names and
     `tokens.singleUse.create("realtime_scribe")` return shape
   - `web/src/App.tsx`: `useScribe` callback names (`onCommittedTranscript`, `onError`)
   - `server/src/agent/permissions.ts`: `CanUseTool` return type (`updatedInput` vs plain allow)
3. Start Postgres (see README), run `npm run db:generate && npm run db:migrate`.
4. `npm run dev`, open http://localhost:5173, paste KAYA_TOKEN, type a message first
   (no mic needed) to prove the agent + TTS loop works end to end.
5. Then test the mic on desktop Chrome, then on iPhone over HTTPS.

Design decisions already made (don't relitigate unless something breaks):
- Hono, not Next.js. Long-lived WebSocket process.
- ElevenLabs for both STT (Scribe v2 Realtime, browser → ElevenLabs directly) and TTS (server side).
- Postgres + pgvector, not MariaDB. Embeddings column exists but unused in v1.
- Sentence-chunked TTS: each sentence is one request; frames carry a sequence number.
- Permission tiers live in permissions.ts; destructive Bash asks the human over the socket.

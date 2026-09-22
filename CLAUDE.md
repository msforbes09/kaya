# Kaya

Voice-first personal dev assistant. Phone mic → ElevenLabs Scribe → `/ws` → Claude Agent SDK turn → sentence-chunked ElevenLabs TTS → MP3 frames back to the phone.

## Layout

- `server/` Hono + TypeScript. WebSocket session, Agent SDK runner, TTS, Postgres via Drizzle.
- `web/` Vite + React PWA. Mic capture, audio playback, permission prompts.
- `.claude/rules/` path-scoped conventions. They load only when you touch that path.
- `.claude/sessions/` standing agreements (`RULES.md`) and dated session state. Read the newest dated file at session start.
- `docs/decisions/` design decisions already made. `docs/superpowers/` specs and plans. `TODO.md` deferred work.

## Commands

```bash
npm install                # workspaces: server + web
npm run typecheck          # both workspaces, errors only
npm test                   # vitest in server and web, dot reporter
npm run dev                # server on :8787, web on :5173
npm run db:generate && npm run db:migrate
```

Postgres: `docker run -d --name kaya-pg -e POSTGRES_USER=kaya -e POSTGRES_PASSWORD=kaya -e POSTGRES_DB=kaya -p 5432:5432 pgvector/pgvector:pg17`, then `docker exec kaya-pg psql -U kaya -c 'CREATE EXTENSION IF NOT EXISTS vector;'`.

## Hard rules

- Never edit `.env` files. Change `.env.example` and tell the user what to set.
- TDD, Red → Green → Blue. No production code without a failing test first.
- Discuss first. No code until the user says "go". Agree the todo list before implementing.
- `develop` is the working branch. Feature branch per task off `develop`, PR back into `develop`. Open the PR and stop. The user merges. `main` is release only.
- Credentials never reach logs, the TTS stream, the memory table, or a spoken reply.
- Keep this file under 80 lines. Detail belongs in `.claude/rules/` or the `kaya-conventions` skill.

## Decided, do not relitigate (see `docs/decisions/`)

Hono over Next. ElevenLabs for STT and TTS. Postgres + pgvector. Sentence-chunked TTS with sequence-numbered frames. Permission tiers in `runner/src/agent/permissions.ts`; destructive Bash asks the human over the socket.

## Token discipline

- Pipe long output through `tail`. The `truncate-output` hook does this for build, test and install commands.
- Use `Explore` subagents for broad searches. Return conclusions, not file dumps.
- One task per session. Write `.claude/sessions/YYYY-MM-DD.md` at wrap-up, then clear.

## Security checklist (self-review before every PR)

- Bearer token compared in constant time, never logged, never echoed to the client.
- Every Bash command the agent runs passes `permissions.ts`. New destructive patterns go in `runner/src/agent/destructive-patterns.json`, which the dev hook shares.
- Nothing from `process.env` reaches the model prompt, the memory table, or TTS.
- WebSocket messages are validated before use. Unknown types are dropped.

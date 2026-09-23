# Kaya

Voice-first dev assistant for a small team. Phone mic → ElevenLabs Scribe → cloud `/ws` → the member's own runner (`/runner` socket) → Claude Agent SDK turn on their machine → sentence-chunked ElevenLabs TTS in the cloud → MP3 frames back to the phone.

## Layout

- `server/` Hono + TypeScript. GitHub sign-in + invites, phone and runner sockets, TTS, Postgres via Drizzle. Never runs the agent.
- `runner/` npm package `kaya-runner`. Pairs by device code, runs Agent SDK turns in the member's workspace with their `claude` login.
- `web/` Vite + React PWA. Mic capture, audio playback, permission prompts, model select.
- `.claude/rules/` path-scoped conventions. They load only when you touch that path.
- `.claude/sessions/` standing agreements (`RULES.md`) and dated session state. Read the newest dated file at session start.
- `docs/decisions/` design decisions already made. `docs/superpowers/` specs and plans. `TODO.md` deferred work.

## Commands

```bash
npm install                # workspaces: server, web, runner
npm run typecheck          # all workspaces, errors only
npm test                   # vitest in all workspaces, dot reporter
npm run format:check       # Biome; the Edit/Write hook formats touched files
npm run dev                # cloud on :8787, web on :5173 (never bind these from the agent)
npm run dev:runner         # this machine's runner; pairs at /pair on first run
npm run db:generate && npm run db:migrate
npm run invite -w server -- --admin   # first invite; also forget, signout
```

Postgres with pgvector on the host (`CREATE EXTENSION IF NOT EXISTS vector;`), `DATABASE_URL` in `.env`.

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

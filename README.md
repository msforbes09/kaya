# Kaya

A personal, voice-first development assistant. Talk to it from a phone; it reads, edits and runs things in your workspace through the Claude Agent SDK, remembers what you tell it, and asks before doing anything destructive.

## Layout

```
server/   Hono + TypeScript cloud relay (GitHub OAuth, WebSockets, TTS, Postgres)
web/      Vite + React PWA (mic → ElevenLabs Scribe → cloud; cloud → TTS → speaker)
runner/   npm package (kaya-runner) that runs the Agent SDK on your own machine
```

How a turn flows:

1. Browser streams mic audio straight to ElevenLabs Scribe using a single-use token minted by `/api/scribe-token`.
2. Scribe commits a sentence → browser sends `{type:"user_text"}` over `/ws`.
3. The cloud relays the turn to the member's runner over `/runner`. The runner is what executes the Agent SDK turn (`resume`d per conversation) in your workspace and streams text deltas back through the cloud.
4. Text is chunked into sentences → each sentence becomes an ElevenLabs TTS request → MP3 frames go to the browser with a sequence number → played in order.
5. Destructive tool calls pause the agent on the runner and surface a Yes/No prompt in the UI (and are spoken).

## Local development

Requirements: Node 20+, a Postgres with pgvector (see below), an ElevenLabs key, and either a logged-in Claude Code CLI (`claude auth status`) or an Anthropic API key.

1. Create a GitHub OAuth app with callback `http://localhost:5173/auth/github/callback`.
2. `cp .env.example server/.env` and fill in every key it lists (client id and secret, `COOKIE_SECRET`, ElevenLabs, `DATABASE_URL`).
3. Start Postgres and migrate:

```bash
npm install
docker run -d --name kaya-pg -e POSTGRES_USER=kaya -e POSTGRES_PASSWORD=kaya -e POSTGRES_DB=kaya -p 5432:5432 pgvector/pgvector:pg17
docker exec kaya-pg psql -U kaya -c 'CREATE EXTENSION IF NOT EXISTS vector;'
npm run db:generate && npm run db:migrate
```

4. `npm run dev` (cloud + web).
5. `npm run invite -w server` prints an invite code.
6. Open http://localhost:5173, sign in with GitHub, paste the invite code.
7. Start a runner: `KAYA_CLOUD_URL=http://localhost:5173 npm run dev:runner`. It prints a pairing code and URL.
8. Open the pair URL while signed in and confirm. The runner banner disappears; tap the ring.

The mic only works over HTTPS on iPhone. For phone testing before deployment, run the Vite dev server over a tunnel (e.g. `cloudflared tunnel --url http://localhost:5173`) or on Tailscale with `tailscale cert`.

## Where to change things

- Personality and rules: `runner/src/agent/prompt.ts`
- What the agent may do without asking: `runner/src/agent/permissions.ts`
- Memory tools available to the agent: `runner/src/agent/tools.ts`
- TTS vendor: `server/src/voice/tts.ts` (one class; swap it)
- Phone ↔ cloud message shapes: `server/src/ws/protocol.ts`
- Cloud ↔ runner message shapes: `server/src/ws/runner-protocol.ts` and `runner/src/protocol.ts`

## Production

Kaya runs as three processes: the cloud (Hono API, web PWA, Postgres client),
Postgres on the host, and a runner per member's machine that connects out to
the cloud's `/runner` socket. Docker Compose builds and runs the cloud behind
Caddy, which terminates TLS. See `docs/deploy/vps.md` for the full VPS setup.

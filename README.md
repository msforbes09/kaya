# Kaya

A personal, voice-first development assistant. Talk to it from a phone; it reads, edits and runs things in your workspace through the Claude Agent SDK, remembers what you tell it, and asks before doing anything destructive.

## Layout

```
server/   Hono + TypeScript orchestrator (WebSocket, Agent SDK, TTS, Postgres)
web/      Vite + React PWA (mic → ElevenLabs Scribe → server; server → TTS → speaker)
```

How a turn flows:

1. Browser streams mic audio straight to ElevenLabs Scribe using a single-use token minted by `/api/scribe-token`.
2. Scribe commits a sentence → browser sends `{type:"user_text"}` over `/ws`.
3. Server runs one Agent SDK turn (`resume`d per conversation) and streams text deltas back.
4. Text is chunked into sentences → each sentence becomes an ElevenLabs TTS request → MP3 frames go to the browser with a sequence number → played in order.
5. Destructive tool calls pause the agent and surface a Yes/No prompt in the UI (and are spoken).

## Local development

Requirements: Node 20+, a Postgres with pgvector (see below), an ElevenLabs key, and either a logged-in Claude Code CLI (`claude auth status`) or an Anthropic API key.

```bash
cp .env.example server/.env        # fill in values
npm install
docker run -d --name kaya-pg -e POSTGRES_USER=kaya -e POSTGRES_PASSWORD=kaya -e POSTGRES_DB=kaya -p 5432:5432 pgvector/pgvector:pg17
docker exec kaya-pg psql -U kaya -c 'CREATE EXTENSION IF NOT EXISTS vector;'
npm run db:generate && npm run db:migrate
npm run dev
```

Open http://localhost:5173, paste `KAYA_TOKEN`, tap the ring.

The mic only works over HTTPS on iPhone. For phone testing before deployment, run the Vite dev server over a tunnel (e.g. `cloudflared tunnel --url http://localhost:5173`) or on Tailscale with `tailscale cert`.

## Where to change things

- Personality and rules: `server/src/agent/prompt.ts`
- What the agent may do without asking: `server/src/agent/permissions.ts`
- Memory tools available to the agent: `server/src/agent/tools.ts`
- TTS vendor: `server/src/voice/tts.ts` (one class; swap it)
- WebSocket message shapes: `server/src/ws/protocol.ts`

## Production

Build once (`npm run build`), then `NODE_ENV=production npm start` serves the PWA and the API from one origin. Deployment (Docker Compose, Caddy, TLS) is documented separately.

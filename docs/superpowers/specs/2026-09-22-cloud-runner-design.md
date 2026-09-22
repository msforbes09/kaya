# Kaya cloud relay + local runner

Date: 2026-09-22. Status: approved in chat, ready for planning.

## Goal

Run Kaya as a hosted service for one small trusted team. Each member signs in with GitHub, talks to Kaya from a phone, and Kaya works on that member's own machine through a runner they install. Voice runs on the team owner's ElevenLabs key. Claude access is the member's own: their machine's `claude` login or their own API key. The cloud never holds a Claude credential or a file.

Out of scope: public sign-up, billing, several runners per person, the hosted GitHub sandbox path.

## Architecture

Three processes.

- **Phone app** (`web/`): today's PWA, served by the cloud. One new message, `runner_status`, so it can show "no runner connected".
- **Cloud** (`server/`): Hono. GitHub sign-in with invite codes, phone sockets, Scribe tokens, TTS, conversations and memories in Postgres, routing of each turn to the member's runner.
- **Runner** (`runner/`, new workspace, npm package `kaya-runner`): today's agent code. Pairs to a member, keeps an outbound socket to the cloud, runs Agent SDK turns locally.

Turn flow: phone → cloud → runner → cloud → phone. The cloud keeps sentence chunking and TTS, fed by runner deltas. No runner online: the cloud speaks "your runner isn't connected" and stores nothing.

### Protocols

`/ws` (phone), existing `ClientMessage`/`ServerMessage` in `server/src/ws/protocol.ts`, plus `{ type: "runner_status"; online: boolean; name?: string }`.

`/runner` (runner), new `server/src/ws/runner-protocol.ts`, imported by both workspaces.

Cloud → runner:
- `{ type: "turn_start"; turnId; conversationId; text; resumeSessionId?: string | null }`
- `{ type: "permission_response"; id; allow }`
- `{ type: "cancel"; turnId }`
- `{ type: "memory_result"; callId; result: string }`

Runner → cloud:
- `{ type: "text_delta"; turnId; text }`
- `{ type: "tool_start"; turnId; name; summary }`
- `{ type: "permission_request"; turnId; id; question; detail }`
- `{ type: "memory_call"; turnId; callId; tool: "remember" | "recall"; args }`
- `{ type: "turn_done"; turnId; sessionId; costUsd?; fullText }`
- `{ type: "turn_error"; turnId; message }`

Unknown types are dropped on both sides. Runner handshake: `Authorization: Bearer <runner token>` header on the upgrade request.

## Accounts, invites, pairing

- GitHub OAuth implemented with Hono routes and `fetch`: `/auth/github` redirects, `/auth/github/callback` exchanges the code and reads the user.
- First sign-in requires an invite code entered on the callback page. A valid unused code creates the member and is burned. Later sign-ins skip this.
- Session: signed cookie (HMAC, `COOKIE_SECRET`) holding member id, 30 days, `HttpOnly`, `Secure`, `SameSite=Lax`.
- `npm run invite` on the server prints a new code. `npm run invite -- --admin` bootstraps the first member's code with `is_admin`.
- Pairing (device code): runner calls `POST /api/pair/start` → `{ code, publicId, verifyUrl }`; prints them; polls `GET /api/pair/poll?publicId=` until the member confirms at `/pair` (signed in) → cloud creates the runner row with a fresh random token (stored hashed, returned once). Runner saves `~/.kaya/runner.json` `{ token, cloudUrl, workspace }`. Codes expire after 10 minutes.
- One runner per member: pairing again replaces the row; a second live socket closes the first.

## Data model (cloud Postgres, Drizzle)

- `members`: id, github_id (unique), github_login, avatar_url, is_admin, created_at.
- `invites`: code (pk), created_by, used_by nullable, created_at, used_at nullable.
- `runners`: id, member_id (unique), name, token_hash, workspace, last_seen_at, created_at.
- `pairing_codes`: code (pk), runner_public_id, member_id nullable, expires_at.
- `conversations`: + member_id, runner_id nullable. A conversation resumed on a different runner starts a fresh agent session.
- `messages`: unchanged.
- `memories`: + member_id; index on (member_id, subject). Per member, never shared.

Not stored: Claude credentials, runner tokens in the clear, file contents, tool inputs beyond the one-line summary.

## Runner

Workspace `runner/`, TypeScript, built to `dist/`, `bin` entry `kaya-runner`. Moves from `server/src/agent/`: `runner.ts`, `permissions.ts`, `destructive-patterns.json`, `prompt.ts`, `tools.ts`, `env.ts`. The memory tools send `memory_call` and await `memory_result` instead of touching a database. The dev hook `.claude/hooks/block-dangerous-bash.js` reads the patterns file at its new path.

Start:
1. Read `~/.kaya/runner.json`. Missing → pairing flow, then ask for the workspace folder once. Refuse to start if the folder does not exist.
2. Connect to `wss://<cloud>/runner`. Reconnect with capped exponential backoff forever; one log line per state change.
3. `turn_start` → one agent turn with `cwd` = workspace, `resume` = the session id if it belongs to this runner. Stream events. Permission requests block until `permission_response`.
4. `cancel` or disconnect mid-turn → abort the turn.

Credential: `ANTHROPIC_API_KEY` from the runner's environment if set, else the machine's `claude` login. Print which, never the value.

## Cloud changes to the existing server

- Remove `KAYA_TOKEN`, `KAYA_WORKSPACE`, `ANTHROPIC_API_KEY` from config. Add `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `COOKIE_SECRET`, `PUBLIC_URL`.
- Phone socket authenticates by session cookie, not a token in the URL. Logger no longer prints full URLs.
- `Session` (phone) delegates turns to a `RunnerHub` that maps member id → live runner socket and pending turns.
- Memory tool calls from runners are served by `repo.remember`/`repo.recall` scoped to the member.

## Deployment (VPS: Ubuntu, Docker, existing Postgres, domain)

`docker-compose.yml` at the repo root: `app` (Dockerfile: `npm ci`, `npm run build`, `NODE_ENV=production npm start`, migrations on start) and `caddy` (automatic HTTPS, proxies HTTP and WebSockets to app). App reaches host Postgres via `host.docker.internal` (`extra_hosts`). The owner creates the `kaya` database and role and runs `CREATE EXTENSION vector`; Postgres must accept connections from the Docker subnet. One `.env` on the VPS written by the owner; `.env.example` updated. Ops: `docker compose logs`, nightly `pg_dump` cron, `/api/health` for an uptime pinger. Deploy = `git pull && docker compose up -d --build`.

## Testing

- Protocol: each runner message round-trips through JSON; unknown types dropped.
- Cloud routing: `Session` + `RunnerHub` with fake sockets. No runner → spoken fallback, no message row. Runner disconnect mid-turn → error to phone, turn marked failed.
- Auth: invite redemption, cookie sign/verify, pairing expiry, one-runner replacement. Pure functions with injected clocks; no real GitHub.
- Runner: memory tools resolve on `memory_result`; backoff is a pure function. The SDK is not tested.
- Manual end-to-end script in `docs/qa/`: pair, speak over HTTPS, permission round-trip, audio.

## Rollout

1. Cloud and runner on the Mac, cloud on localhost. Same audio proof as today.
2. Cloud on the VPS, runner on the Mac, test from the phone.
3. Invite the team, they install the runner.

Before step 3 (small, tracked in TODO): phone auto-reconnect, mic pause while Kaya speaks, model choice for cost.

# Cloud Relay + Local Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Kaya into a hosted cloud relay (GitHub sign-in, voice, storage) and a local runner that executes agent turns on each member's own machine.

**Architecture:** The cloud keeps the phone socket, ElevenLabs and Postgres, and routes each turn over a second WebSocket to the member's runner. The runner is a new npm workspace holding today's agent code; memory tools call back to the cloud over the same socket. Auth is GitHub OAuth gated by invite codes with a signed cookie; runners pair by device code and authenticate with a hashed bearer token.

**Tech Stack:** TypeScript, Hono + @hono/node-ws, Drizzle + postgres, Vitest, @anthropic-ai/claude-agent-sdk (runner only), `ws` (runner client), Docker Compose + Caddy.

**Spec:** `docs/superpowers/specs/2026-09-22-cloud-runner-design.md`

## Global Constraints

- TDD: every production change starts with a failing test (`npm test -w server`, `npm test -w web`, `npm test -w runner`). Tests run with `vitest run --reporter=dot`.
- Never edit `.env`. Update `.env.example` and tell the user what to set.
- Never commit to `develop` or `main`. Work stays on `feature/cloud-runner`. No Claude attribution trailer in commit messages.
- The cloud never stores or logs a Claude credential, a runner token in the clear, a file's contents, or a full request URL.
- Zod 4 (`^4.0.0`), Node >= 20, ESM (`"type": "module"`), NodeNext module resolution in server and runner, imports use `.js` suffixes.
- Path-scoped rules in `.claude/rules/` apply. Message shapes are declared once in `server/src/ws/protocol.ts` and `server/src/ws/runner-protocol.ts` and mirrored, never redeclared.
- Repo layer functions are thin; tests mock `../db/repo.js` with `vi.mock` as `server/src/ws/session.test.ts` already does. No test opens a real database.

---

## File map

Cloud (`server/`):
- Create `src/ws/runner-protocol.ts` — runner ⇄ cloud message types + `parseRunnerMessage`.
- Create `src/auth/cookie.ts` — `signSession`, `verifySession`, `sessionCookie`, `readSessionCookie`.
- Create `src/auth/github.ts` — `githubAuthorizeUrl`, `exchangeGithubCode`.
- Create `src/auth/invites.ts` — `generateInviteCode`.
- Create `src/auth/pairing.ts` — `newPairingCode`, `pairingExpired`, `newRunnerToken`, `hashRunnerToken`.
- Create `src/auth/middleware.ts` — `requireMember` (cookie → member id on context).
- Create `src/routes/auth.ts` — `/auth/github`, `/auth/github/callback`, `/auth/logout`, `/api/me`.
- Create `src/routes/pairing.ts` — `/api/pair/start`, `/api/pair/poll`, `/api/pair/confirm`.
- Create `src/ws/runner-hub.ts` — `RunnerHub`.
- Create `src/ws/runner-socket.ts` — `/runner` upgrade handler.
- Create `src/scripts/invite.ts` — `npm run invite`.
- Modify `src/config-schema.ts`, `src/db/schema.ts`, `src/db/repo.ts`, `src/ws/protocol.ts`, `src/ws/session.ts`, `src/index.ts`, `package.json`.
- Delete `src/auth.ts`, `src/agent/*` (moved to runner), `src/agent/env.test.ts` (moved).

Runner (`runner/`, new workspace):
- `package.json`, `tsconfig.json`, `src/cli.ts` (bin), `src/config.ts`, `src/pair.ts`, `src/backoff.ts`, `src/client.ts`, `src/turn.ts`, `src/memory-bridge.ts`, `src/agent/{runner,permissions,prompt,tools,env}.ts`, `src/agent/destructive-patterns.json`, tests beside sources.

Web (`web/src/`):
- Modify `App.tsx` (sign-in gate, runner banner, pair page), `useKaya.ts` (cookie auth, `runner_status`), `transcript.ts` unchanged.

Ops: `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `docs/deploy/vps.md`, `docs/qa/2026-09-22-cloud-runner-e2e.md`, `.env.example`, `.claude/hooks/block-dangerous-bash.js`, `.claude/rules/agent.md`, `CLAUDE.md`, `README.md`, `TODO.md`.

---

### Task 1: Runner protocol types

**Files:**
- Create: `server/src/ws/runner-protocol.ts`
- Test: `server/src/ws/runner-protocol.test.ts`

**Interfaces:**
- Produces: `CloudToRunner`, `RunnerToCloud` unions; `parseRunnerMessage(raw: string): RunnerToCloud | null`; `parseCloudMessage(raw: string): CloudToRunner | null`. Both return `null` for malformed JSON or unknown `type`.

- [ ] **Step 1: Write the failing test**

```ts
// server/src/ws/runner-protocol.test.ts
import { describe, expect, it } from "vitest";
import { parseCloudMessage, parseRunnerMessage, type RunnerToCloud, type CloudToRunner } from "./runner-protocol.js";

describe("runner protocol", () => {
  it("round-trips every runner→cloud message through JSON", () => {
    const msgs: RunnerToCloud[] = [
      { type: "text_delta", turnId: "t1", text: "Hi" },
      { type: "tool_start", turnId: "t1", name: "Bash", summary: "Running: ls" },
      { type: "permission_request", turnId: "t1", id: "p1", question: "Run it?", detail: "rm -rf x" },
      { type: "memory_call", turnId: "t1", callId: "c1", tool: "recall", args: { query: "x" } },
      { type: "turn_done", turnId: "t1", sessionId: "s1", costUsd: 0.1, fullText: "Hi" },
      { type: "turn_error", turnId: "t1", message: "boom" },
    ];
    for (const m of msgs) expect(parseRunnerMessage(JSON.stringify(m))).toEqual(m);
  });

  it("round-trips every cloud→runner message through JSON", () => {
    const msgs: CloudToRunner[] = [
      { type: "turn_start", turnId: "t1", conversationId: "c1", text: "hello", resumeSessionId: null },
      { type: "permission_response", id: "p1", allow: true },
      { type: "cancel", turnId: "t1" },
      { type: "memory_result", callId: "c1", result: "Nothing stored." },
    ];
    for (const m of msgs) expect(parseCloudMessage(JSON.stringify(m))).toEqual(m);
  });

  it("drops unknown types and malformed JSON", () => {
    expect(parseRunnerMessage('{"type":"nope"}')).toBeNull();
    expect(parseRunnerMessage("not json")).toBeNull();
    expect(parseCloudMessage('{"type":"nope"}')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server 2>&1 | grep -E "FAIL|Cannot find"`
Expected: FAIL, `Cannot find module './runner-protocol.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/ws/runner-protocol.ts
/** Messages between the cloud and a member's runner. Declared once, imported by both workspaces. */

export type CloudToRunner =
  | { type: "turn_start"; turnId: string; conversationId: string; text: string; resumeSessionId?: string | null }
  | { type: "permission_response"; id: string; allow: boolean }
  | { type: "cancel"; turnId: string }
  | { type: "memory_result"; callId: string; result: string };

export type RunnerToCloud =
  | { type: "text_delta"; turnId: string; text: string }
  | { type: "tool_start"; turnId: string; name: string; summary: string }
  | { type: "permission_request"; turnId: string; id: string; question: string; detail: string }
  | { type: "memory_call"; turnId: string; callId: string; tool: "remember" | "recall"; args: Record<string, unknown> }
  | { type: "turn_done"; turnId: string; sessionId: string; costUsd?: number; fullText: string }
  | { type: "turn_error"; turnId: string; message: string };

const RUNNER_TYPES = new Set(["text_delta", "tool_start", "permission_request", "memory_call", "turn_done", "turn_error"]);
const CLOUD_TYPES = new Set(["turn_start", "permission_response", "cancel", "memory_result"]);

function parse(raw: string, allowed: Set<string>): unknown {
  try {
    const m = JSON.parse(raw);
    return m && typeof m === "object" && allowed.has(String((m as { type?: unknown }).type)) ? m : null;
  } catch {
    return null;
  }
}

export const parseRunnerMessage = (raw: string) => parse(raw, RUNNER_TYPES) as RunnerToCloud | null;
export const parseCloudMessage = (raw: string) => parse(raw, CLOUD_TYPES) as CloudToRunner | null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w server 2>&1 | grep -E "passed|failed"`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add server/src/ws/runner-protocol.ts server/src/ws/runner-protocol.test.ts
git commit -m "Add the runner protocol message types"
```

---

### Task 2: Session cookie signing

**Files:**
- Create: `server/src/auth/cookie.ts`
- Test: `server/src/auth/cookie.test.ts`

**Interfaces:**
- Produces: `signSession(memberId: string, secret: string, now?: number): string`; `verifySession(value: string | undefined, secret: string, now?: number): string | null` (returns member id); `SESSION_COOKIE = "kaya_session"`; `sessionCookieHeader(value: string, secure: boolean): string`; `clearSessionCookieHeader(): string`.

- [ ] **Step 1: Write the failing test**

```ts
// server/src/auth/cookie.test.ts
import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./cookie.js";

const SECRET = "test-secret-0123456789";

describe("session cookie", () => {
  it("verifies a value it signed", () => {
    const v = signSession("member-1", SECRET, 1_000_000);
    expect(verifySession(v, SECRET, 1_000_001)).toBe("member-1");
  });

  it("rejects a tampered member id", () => {
    const v = signSession("member-1", SECRET, 1_000_000).replace("member-1", "member-2");
    expect(verifySession(v, SECRET, 1_000_001)).toBeNull();
  });

  it("rejects the wrong secret and missing values", () => {
    const v = signSession("member-1", SECRET, 1_000_000);
    expect(verifySession(v, "other", 1_000_001)).toBeNull();
    expect(verifySession(undefined, SECRET)).toBeNull();
  });

  it("expires after 30 days", () => {
    const v = signSession("member-1", SECRET, 0);
    expect(verifySession(v, SECRET, 30 * 86_400_000 + 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server 2>&1 | grep -E "FAIL|Cannot find"`
Expected: FAIL, cannot find `./cookie.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/auth/cookie.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "kaya_session";
const MAX_AGE_MS = 30 * 86_400_000;

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** value = base64url(memberId).issuedAtMs.hmac */
export function signSession(memberId: string, secret: string, now = Date.now()): string {
  const payload = `${Buffer.from(memberId).toString("base64url")}.${now}`;
  return `${payload}.${mac(payload, secret)}`;
}

export function verifySession(value: string | undefined, secret: string, now = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [id, issued, sig] = parts;
  const payload = `${id}.${issued}`;
  const expected = mac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const issuedAt = Number(issued);
  if (!Number.isFinite(issuedAt) || now - issuedAt > MAX_AGE_MS) return null;
  return Buffer.from(id, "base64url").toString();
}

export function sessionCookieHeader(value: string, secure: boolean): string {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE_MS / 1000}`];
  if (secure) flags.push("Secure");
  return `${SESSION_COOKIE}=${value}; ${flags.join("; ")}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w server 2>&1 | grep -E "passed|failed"`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/cookie.ts server/src/auth/cookie.test.ts
git commit -m "Add signed session cookie helpers"
```

---

### Task 3: GitHub OAuth helpers

**Files:**
- Create: `server/src/auth/github.ts`
- Test: `server/src/auth/github.test.ts`

**Interfaces:**
- Produces: `githubAuthorizeUrl(clientId: string, redirectUri: string, state: string): string`; `exchangeGithubCode(opts: { code: string; clientId: string; clientSecret: string; fetchImpl?: typeof fetch }): Promise<{ githubId: number; login: string; avatarUrl: string }>` (throws `Error("github token exchange failed")` / `Error("github user lookup failed")`).

- [ ] **Step 1: Write the failing test**

```ts
// server/src/auth/github.test.ts
import { describe, expect, it, vi } from "vitest";
import { exchangeGithubCode, githubAuthorizeUrl } from "./github.js";

describe("github oauth", () => {
  it("builds the authorize url with scope read:user", () => {
    const url = new URL(githubAuthorizeUrl("cid", "https://k.example/auth/github/callback", "st4te"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://k.example/auth/github/callback");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("scope")).toBe("read:user");
  });

  it("exchanges the code and reads the user", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://github.com/login/oauth/access_token"))
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      if (url === "https://api.github.com/user")
        return new Response(JSON.stringify({ id: 42, login: "octo", avatar_url: "https://a/x.png" }), { status: 200 });
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;

    const user = await exchangeGithubCode({ code: "abc", clientId: "cid", clientSecret: "sec", fetchImpl });
    expect(user).toEqual({ githubId: 42, login: "octo", avatarUrl: "https://a/x.png" });
    const userCall = vi.mocked(fetchImpl).mock.calls.find((c) => String(c[0]) === "https://api.github.com/user")!;
    expect((userCall[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("throws when the exchange has no token", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "bad" }), { status: 200 })) as typeof fetch;
    await expect(exchangeGithubCode({ code: "x", clientId: "c", clientSecret: "s", fetchImpl })).rejects.toThrow(
      "github token exchange failed",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server 2>&1 | grep -E "FAIL|Cannot find"`
Expected: FAIL, cannot find `./github.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/auth/github.ts
export function githubAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", "read:user");
  return u.toString();
}

export interface GithubUser {
  githubId: number;
  login: string;
  avatarUrl: string;
}

export async function exchangeGithubCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<GithubUser> {
  const f = opts.fetchImpl ?? fetch;
  const tokenRes = await f("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: opts.clientId, client_secret: opts.clientSecret, code: opts.code }),
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenRes.ok || !tokenJson.access_token) throw new Error("github token exchange failed");

  const userRes = await f("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "kaya" },
  });
  if (!userRes.ok) throw new Error("github user lookup failed");
  const u = (await userRes.json()) as { id: number; login: string; avatar_url: string };
  return { githubId: u.id, login: u.login, avatarUrl: u.avatar_url };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w server 2>&1 | grep -E "passed|failed"`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/github.ts server/src/auth/github.test.ts
git commit -m "Add GitHub OAuth authorize and code exchange helpers"
```

---

### Task 4: Invite codes, pairing codes and runner tokens

**Files:**
- Create: `server/src/auth/invites.ts`, `server/src/auth/pairing.ts`
- Test: `server/src/auth/invites.test.ts`, `server/src/auth/pairing.test.ts`

**Interfaces:**
- Produces: `generateInviteCode(random?: (n: number) => Buffer): string` (12 chars, `[A-Z2-7]`, no I/O/0/1); `newPairingCode(random?)` (6 digits as string); `pairingExpiresAt(now?: number): Date` (now + 10 min); `pairingExpired(expiresAt: Date, now?: number): boolean`; `newRunnerToken(random?)` (64 hex chars); `hashRunnerToken(token: string): string` (sha256 hex); `runnerTokenMatches(token: string, hash: string): boolean` (constant time).

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/auth/invites.test.ts
import { describe, expect, it } from "vitest";
import { generateInviteCode } from "./invites.js";

describe("generateInviteCode", () => {
  it("is 12 characters from the unambiguous alphabet", () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-Z2-7]{12}$/);
  });

  it("is deterministic for a fixed random source", () => {
    const zeros = (n: number) => Buffer.alloc(n, 0);
    expect(generateInviteCode(zeros)).toBe("AAAAAAAAAAAA");
  });
});
```

```ts
// server/src/auth/pairing.test.ts
import { describe, expect, it } from "vitest";
import { hashRunnerToken, newPairingCode, newRunnerToken, pairingExpired, pairingExpiresAt, runnerTokenMatches } from "./pairing.js";

describe("pairing", () => {
  it("pairing codes are six digits", () => {
    expect(newPairingCode()).toMatch(/^\d{6}$/);
  });

  it("codes expire ten minutes after creation", () => {
    const now = 1_000_000;
    const exp = pairingExpiresAt(now);
    expect(pairingExpired(exp, now + 9 * 60_000)).toBe(false);
    expect(pairingExpired(exp, now + 10 * 60_000 + 1)).toBe(true);
  });

  it("runner tokens are 64 hex chars and verify only against their own hash", () => {
    const t = newRunnerToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(runnerTokenMatches(t, hashRunnerToken(t))).toBe(true);
    expect(runnerTokenMatches(newRunnerToken(), hashRunnerToken(t))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server 2>&1 | grep -E "FAIL|Cannot find"`
Expected: FAIL for both new files (module not found)

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/auth/invites.ts
import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ234567"; // 30 symbols, no I/O/0/1

/** 12-character invite code from an unambiguous alphabet. */
export function generateInviteCode(random: (n: number) => Buffer = randomBytes): string {
  const bytes = random(12);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
```

Note: `ALPHABET` has 30 symbols but the test regex allows `[A-Z2-7]`; with byte 0 every position maps to `A`, matching `"AAAAAAAAAAAA"`.

```ts
// server/src/auth/pairing.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PAIRING_TTL_MS = 10 * 60_000;

export function newPairingCode(random: (n: number) => Buffer = randomBytes): string {
  const n = random(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

export function pairingExpiresAt(now = Date.now()): Date {
  return new Date(now + PAIRING_TTL_MS);
}

export function pairingExpired(expiresAt: Date, now = Date.now()): boolean {
  return expiresAt.getTime() < now;
}

export function newRunnerToken(random: (n: number) => Buffer = randomBytes): string {
  return random(32).toString("hex");
}

export function hashRunnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function runnerTokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(hashRunnerToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server 2>&1 | grep -E "passed|failed"`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/invites.ts server/src/auth/invites.test.ts server/src/auth/pairing.ts server/src/auth/pairing.test.ts
git commit -m "Add invite code, pairing code and runner token helpers"
```

---

### Task 5: Config and schema for members, invites, runners, pairing

**Files:**
- Modify: `server/src/config-schema.ts`, `server/src/config.test.ts`, `server/src/db/schema.ts`, `server/src/db/repo.ts`, `.env.example`
- Generate: `server/drizzle/0001_*.sql` via `npm run db:generate` (requires a `DATABASE_URL`; run with the user's `.env` in place, do not edit it)

**Interfaces:**
- Config gains `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `COOKIE_SECRET` (min 32 chars), `PUBLIC_URL` (url). Loses `KAYA_TOKEN`, `KAYA_WORKSPACE`, `ANTHROPIC_API_KEY`.
- Repo produces: `findMemberByGithubId(githubId: number)`, `createMember(u: { githubId; login; avatarUrl; isAdmin?: boolean })`, `getMember(id)`, `createInvite(createdBy: string | null, code: string)`, `redeemInvite(code: string, memberId: string): Promise<boolean>`, `createPairingCode(code, runnerPublicId, expiresAt)`, `getPairingCode(code)`, `confirmPairingCode(code, memberId): Promise<boolean>`, `getPairingByPublicId(publicId)`, `deletePairingCode(code)`, `upsertRunner(r: { memberId; name; tokenHash; workspace })` (delete existing for member, insert), `findRunnerByTokenHash(hash)`, `touchRunner(id)`, `createConversation(memberId)`, `getConversation(id, memberId)` (scoped), `setAgentSession(conversationId, agentSessionId, runnerId)`, `remember(memberId, kind, subject, content)`, `recall(memberId, query, limit?)`.

- [ ] **Step 1: Write the failing config test** (append to `server/src/config.test.ts`; also change `base` to the new required set)

```ts
// replace the `base` fixture at the top of server/src/config.test.ts with:
const base = {
  ELEVENLABS_API_KEY: "el",
  ELEVENLABS_VOICE_ID: "voice",
  DATABASE_URL: "postgres://kaya:kaya@localhost:5432/kaya",
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "sec",
  COOKIE_SECRET: "0123456789abcdef0123456789abcdef",
  PUBLIC_URL: "https://kaya.example",
};
// delete the "configSchema" describe block about ANTHROPIC_API_KEY and the "KAYA_WORKSPACE" describe block, then add:
describe("cloud config", () => {
  it("requires the GitHub app, cookie secret and public url", () => {
    expect(configSchema.safeParse(base).success).toBe(true);
    expect(configSchema.safeParse({ ...base, COOKIE_SECRET: "short" }).success).toBe(false);
    expect(configSchema.safeParse({ ...base, PUBLIC_URL: "nope" }).success).toBe(false);
  });

  it("no longer knows KAYA_TOKEN, KAYA_WORKSPACE or ANTHROPIC_API_KEY", () => {
    const r = configSchema.safeParse({ ...base, KAYA_TOKEN: "x", KAYA_WORKSPACE: "/tmp", ANTHROPIC_API_KEY: "k" });
    expect(r.success).toBe(true);
    if (r.success) expect(Object.keys(r.data)).not.toEqual(expect.arrayContaining(["KAYA_TOKEN", "KAYA_WORKSPACE", "ANTHROPIC_API_KEY"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server 2>&1 | grep -E "FAIL|AssertionError"`
Expected: FAIL (missing keys rejected / old keys still present)

- [ ] **Step 3: Rewrite the config schema**

```ts
// server/src/config-schema.ts
import { z } from "zod";

export const configSchema = z.object({
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_VOICE_ID: z.string().min(1),
  ELEVENLABS_TTS_MODEL: z.string().default("eleven_flash_v2_5"),
  DATABASE_URL: z.string().url(),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  COOKIE_SECRET: z.string().min(32, "COOKIE_SECRET must be at least 32 characters"),
  PUBLIC_URL: z.string().url(),
  PORT: z.coerce.number().default(8787),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Config = z.infer<typeof configSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w server 2>&1 | grep -E "passed|failed"`
Expected: config tests pass (other suites unaffected)

- [ ] **Step 5: Extend the Drizzle schema**

Replace `server/src/db/schema.ts` with:

```ts
import { pgTable, text, timestamp, uuid, jsonb, vector, index, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";

export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: integer("github_id").notNull().unique(),
  githubLogin: text("github_login").notNull(),
  avatarUrl: text("avatar_url"),
  isAdmin: boolean("is_admin").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const invites = pgTable("invites", {
  code: text("code").primaryKey(),
  createdBy: uuid("created_by").references(() => members.id, { onDelete: "set null" }),
  usedBy: uuid("used_by").references(() => members.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const runners = pgTable(
  "runners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    workspace: text("workspace").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("runners_member_idx").on(t.memberId)],
);

export const pairingCodes = pgTable("pairing_codes", {
  code: text("code").primaryKey(),
  runnerPublicId: text("runner_public_id").notNull().unique(),
  memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
  runnerId: uuid("runner_id").references(() => runners.id, { onDelete: "set null" }),
  agentSessionId: text("agent_session_id"),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
    role: text("role", { enum: ["user", "assistant", "tool"] }).notNull(),
    content: text("content").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["fact", "decision", "preference", "project"] }).notNull(),
    subject: text("subject").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("memories_member_subject_idx").on(t.memberId, t.subject)],
);
```

`memberId` on conversations and memories is nullable so the rows created before this change survive the migration; every new row sets it and every query filters by it.

- [ ] **Step 6: Rewrite the repo**

```ts
// server/src/db/repo.ts
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db, schema } from "./client.js";

// members
export async function findMemberByGithubId(githubId: number) {
  return db.query.members.findFirst({ where: eq(schema.members.githubId, githubId) });
}
export async function getMember(id: string) {
  return db.query.members.findFirst({ where: eq(schema.members.id, id) });
}
export async function createMember(u: { githubId: number; login: string; avatarUrl: string; isAdmin?: boolean }) {
  const [row] = await db
    .insert(schema.members)
    .values({ githubId: u.githubId, githubLogin: u.login, avatarUrl: u.avatarUrl, isAdmin: u.isAdmin ?? false })
    .returning();
  return row;
}

// invites
export async function createInvite(createdBy: string | null, code: string) {
  await db.insert(schema.invites).values({ code, createdBy });
}
/** Burns the code for this member. False if unknown or already used. */
export async function redeemInvite(code: string, memberId: string): Promise<boolean> {
  const rows = await db
    .update(schema.invites)
    .set({ usedBy: memberId, usedAt: new Date() })
    .where(and(eq(schema.invites.code, code), isNull(schema.invites.usedBy)))
    .returning();
  return rows.length === 1;
}
export async function inviteIsUnused(code: string): Promise<boolean> {
  const row = await db.query.invites.findFirst({ where: eq(schema.invites.code, code) });
  return !!row && row.usedBy === null;
}

// pairing
export async function createPairingCode(code: string, runnerPublicId: string, expiresAt: Date) {
  await db.insert(schema.pairingCodes).values({ code, runnerPublicId, expiresAt });
}
export async function getPairingCode(code: string) {
  return db.query.pairingCodes.findFirst({ where: eq(schema.pairingCodes.code, code) });
}
export async function getPairingByPublicId(publicId: string) {
  return db.query.pairingCodes.findFirst({ where: eq(schema.pairingCodes.runnerPublicId, publicId) });
}
export async function confirmPairingCode(code: string, memberId: string): Promise<boolean> {
  const rows = await db
    .update(schema.pairingCodes)
    .set({ memberId })
    .where(and(eq(schema.pairingCodes.code, code), isNull(schema.pairingCodes.memberId)))
    .returning();
  return rows.length === 1;
}
export async function deletePairingCode(code: string) {
  await db.delete(schema.pairingCodes).where(eq(schema.pairingCodes.code, code));
}

// runners
export async function upsertRunner(r: { memberId: string; name: string; tokenHash: string; workspace: string }) {
  await db.delete(schema.runners).where(eq(schema.runners.memberId, r.memberId));
  const [row] = await db.insert(schema.runners).values(r).returning();
  return row;
}
export async function findRunnerByTokenHash(tokenHash: string) {
  return db.query.runners.findFirst({ where: eq(schema.runners.tokenHash, tokenHash) });
}
export async function touchRunner(id: string) {
  await db.update(schema.runners).set({ lastSeenAt: new Date() }).where(eq(schema.runners.id, id));
}

// conversations & messages
export async function createConversation(memberId: string) {
  const [row] = await db.insert(schema.conversations).values({ memberId }).returning();
  return row;
}
export async function getConversation(id: string, memberId: string) {
  return db.query.conversations.findFirst({
    where: and(eq(schema.conversations.id, id), eq(schema.conversations.memberId, memberId)),
  });
}
export async function setAgentSession(conversationId: string, agentSessionId: string, runnerId: string) {
  await db
    .update(schema.conversations)
    .set({ agentSessionId, runnerId, updatedAt: new Date() })
    .where(eq(schema.conversations.id, conversationId));
}
export async function addMessage(
  conversationId: string,
  role: "user" | "assistant" | "tool",
  content: string,
  meta?: Record<string, unknown>,
) {
  await db.insert(schema.messages).values({ conversationId, role, content, meta });
}

// memories (per member)
export async function remember(
  memberId: string,
  kind: (typeof schema.memories.$inferInsert)["kind"],
  subject: string,
  content: string,
) {
  const [row] = await db.insert(schema.memories).values({ memberId, kind, subject, content }).returning();
  return row;
}
export async function recall(memberId: string, query: string, limit = 10) {
  const like = `%${query}%`;
  return db
    .select()
    .from(schema.memories)
    .where(and(eq(schema.memories.memberId, memberId), or(ilike(schema.memories.subject, like), ilike(schema.memories.content, like))))
    .orderBy(desc(schema.memories.createdAt))
    .limit(limit);
}
```

- [ ] **Step 7: Update `.env.example`**

Replace the file with:

```
# --- GitHub OAuth app (Settings → Developer settings → OAuth Apps)
# Callback URL must be <PUBLIC_URL>/auth/github/callback
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# --- Cookie signing secret, at least 32 chars. Generate with: openssl rand -hex 32
COOKIE_SECRET=

# --- Public base URL of this deployment (no trailing slash). Dev: http://localhost:5173
PUBLIC_URL=http://localhost:5173

# --- ElevenLabs (Scribe STT and TTS, one key for the whole team)
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5

# --- Postgres with pgvector
DATABASE_URL=postgres://kaya:kaya@localhost:5432/kaya

# --- Server
PORT=8787
```

- [ ] **Step 8: Generate the migration and typecheck**

Run: `cd server && npm run db:generate 2>&1 | tail -3` (uses the user's existing `.env`)
Expected: a new file `server/drizzle/0001_*.sql` creating members, invites, runners, pairing_codes and altering conversations/memories.

Run: `npm run typecheck -w server 2>&1 | grep "error TS"`
Expected: errors only in `auth.ts`, `agent/*`, `ws/session.ts`, `index.ts`, `agent/tools.ts` (callers of removed config keys and old repo signatures). Those are fixed in Tasks 8–10. Do not fix them here.

- [ ] **Step 9: Commit**

```bash
git add server/src/config-schema.ts server/src/config.test.ts server/src/db/schema.ts server/src/db/repo.ts server/drizzle .env.example
git commit -m "Add members, invites, runners and pairing to the schema and config"
```

---

### Task 6: RunnerHub — routing turns to runners

**Files:**
- Create: `server/src/ws/runner-hub.ts`
- Test: `server/src/ws/runner-hub.test.ts`

**Interfaces:**
- Consumes: `CloudToRunner`, `RunnerToCloud`, `parseRunnerMessage` from Task 1.
- Produces:

```ts
export interface RunnerLink { send(data: string): void; close(code?: number, reason?: string): void }
export interface TurnHandlers {
  onDelta(text: string): void;
  onTool(name: string, summary: string): void;
  onPermission(id: string, question: string, detail: string): void;
  onDone(r: { sessionId: string; costUsd?: number; fullText: string }): void;
  onError(message: string): void;
}
export interface MemoryService {
  remember(memberId: string, args: Record<string, unknown>): Promise<string>;
  recall(memberId: string, args: Record<string, unknown>): Promise<string>;
}
export class RunnerHub {
  constructor(memory: MemoryService, newId?: () => string);
  attach(memberId: string, runnerId: string, name: string, link: RunnerLink): void;   // closes a previous link for the member with code 4409
  detach(memberId: string, link: RunnerLink): void;                                    // only if this link is current; fails pending turns with "runner disconnected"
  status(memberId: string): { online: boolean; name?: string; runnerId?: string };
  startTurn(memberId: string, turn: { conversationId: string; text: string; resumeSessionId?: string | null }, handlers: TurnHandlers): { turnId: string; cancel(): void; answerPermission(id: string, allow: boolean): void } | null;  // null when offline
  handleMessage(memberId: string, raw: string): Promise<void>;
  onStatusChange(memberId: string, cb: (s: { online: boolean; name?: string }) => void): () => void;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// server/src/ws/runner-hub.test.ts
import { describe, expect, it, vi } from "vitest";
import { RunnerHub, type RunnerLink, type TurnHandlers } from "./runner-hub.js";

const link = () => {
  const sent: string[] = [];
  const l: RunnerLink & { sent: string[]; closed: number[] } = { sent, closed: [], send: (d) => sent.push(d), close: (c) => l.closed.push(c ?? 1000) };
  return l;
};
const handlers = (): TurnHandlers & Record<string, ReturnType<typeof vi.fn>> => ({
  onDelta: vi.fn(), onTool: vi.fn(), onPermission: vi.fn(), onDone: vi.fn(), onError: vi.fn(),
});
const memory = { remember: vi.fn(async () => "Remembered (1)."), recall: vi.fn(async () => "Nothing stored about that.") };

describe("RunnerHub", () => {
  it("returns null and reports offline when the member has no runner", () => {
    const hub = new RunnerHub(memory);
    expect(hub.status("m1")).toEqual({ online: false });
    expect(hub.startTurn("m1", { conversationId: "c1", text: "hi" }, handlers())).toBeNull();
  });

  it("sends turn_start to the runner and routes its events to the handlers", async () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const l = link();
    hub.attach("m1", "r1", "mac", l);
    const h = handlers();
    const t = hub.startTurn("m1", { conversationId: "c1", text: "hi", resumeSessionId: null }, h)!;
    expect(JSON.parse(l.sent[0])).toEqual({ type: "turn_start", turnId: "turn-1", conversationId: "c1", text: "hi", resumeSessionId: null });

    await hub.handleMessage("m1", JSON.stringify({ type: "text_delta", turnId: "turn-1", text: "He" }));
    await hub.handleMessage("m1", JSON.stringify({ type: "tool_start", turnId: "turn-1", name: "Bash", summary: "Running: ls" }));
    await hub.handleMessage("m1", JSON.stringify({ type: "permission_request", turnId: "turn-1", id: "p1", question: "Run?", detail: "rm" }));
    t.answerPermission("p1", true);
    await hub.handleMessage("m1", JSON.stringify({ type: "turn_done", turnId: "turn-1", sessionId: "s1", costUsd: 0.2, fullText: "Hello" }));

    expect(h.onDelta).toHaveBeenCalledWith("He");
    expect(h.onTool).toHaveBeenCalledWith("Bash", "Running: ls");
    expect(h.onPermission).toHaveBeenCalledWith("p1", "Run?", "rm");
    expect(JSON.parse(l.sent[1])).toEqual({ type: "permission_response", id: "p1", allow: true });
    expect(h.onDone).toHaveBeenCalledWith({ sessionId: "s1", costUsd: 0.2, fullText: "Hello" });
  });

  it("answers memory_call with memory_result scoped to the member", async () => {
    const hub = new RunnerHub(memory);
    const l = link();
    hub.attach("m1", "r1", "mac", l);
    await hub.handleMessage("m1", JSON.stringify({ type: "memory_call", turnId: "x", callId: "c9", tool: "recall", args: { query: "etravel" } }));
    expect(memory.recall).toHaveBeenCalledWith("m1", { query: "etravel" });
    expect(JSON.parse(l.sent[0])).toEqual({ type: "memory_result", callId: "c9", result: "Nothing stored about that." });
  });

  it("fails pending turns and reports offline when the runner disconnects", () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const l = link();
    hub.attach("m1", "r1", "mac", l);
    const h = handlers();
    hub.startTurn("m1", { conversationId: "c1", text: "hi" }, h);
    hub.detach("m1", l);
    expect(h.onError).toHaveBeenCalledWith("runner disconnected");
    expect(hub.status("m1")).toEqual({ online: false });
  });

  it("replaces an older runner link for the same member and notifies status listeners", () => {
    const hub = new RunnerHub(memory);
    const seen: boolean[] = [];
    hub.onStatusChange("m1", (s) => seen.push(s.online));
    const a = link();
    const b = link();
    hub.attach("m1", "r1", "mac", a);
    hub.attach("m1", "r2", "desk", b);
    expect(a.closed).toEqual([4409]);
    expect(hub.status("m1")).toEqual({ online: true, name: "desk", runnerId: "r2" });
    hub.detach("m1", a); // stale detach must not clear the current link
    expect(hub.status("m1").online).toBe(true);
    expect(seen).toEqual([true, true]);
  });

  it("cancel sends cancel to the runner", () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const l = link();
    hub.attach("m1", "r1", "mac", l);
    hub.startTurn("m1", { conversationId: "c1", text: "hi" }, handlers())!.cancel();
    expect(JSON.parse(l.sent[1])).toEqual({ type: "cancel", turnId: "turn-1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server 2>&1 | grep -E "FAIL|Cannot find"`
Expected: FAIL, cannot find `./runner-hub.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/ws/runner-hub.ts
import { randomUUID } from "node:crypto";
import { parseRunnerMessage, type CloudToRunner } from "./runner-protocol.js";

export interface RunnerLink {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface TurnHandlers {
  onDelta(text: string): void;
  onTool(name: string, summary: string): void;
  onPermission(id: string, question: string, detail: string): void;
  onDone(r: { sessionId: string; costUsd?: number; fullText: string }): void;
  onError(message: string): void;
}

export interface MemoryService {
  remember(memberId: string, args: Record<string, unknown>): Promise<string>;
  recall(memberId: string, args: Record<string, unknown>): Promise<string>;
}

interface Live {
  runnerId: string;
  name: string;
  link: RunnerLink;
  turns: Map<string, TurnHandlers>;
}

type StatusListener = (s: { online: boolean; name?: string }) => void;

/** Maps members to their single live runner and routes turn traffic both ways. */
export class RunnerHub {
  private live = new Map<string, Live>();
  private listeners = new Map<string, Set<StatusListener>>();

  constructor(
    private readonly memory: MemoryService,
    private readonly newId: () => string = randomUUID,
  ) {}

  attach(memberId: string, runnerId: string, name: string, link: RunnerLink): void {
    const prev = this.live.get(memberId);
    if (prev) {
      for (const h of prev.turns.values()) h.onError("runner replaced");
      prev.link.close(4409, "replaced by a newer runner");
    }
    this.live.set(memberId, { runnerId, name, link, turns: new Map() });
    this.emit(memberId);
  }

  detach(memberId: string, link: RunnerLink): void {
    const cur = this.live.get(memberId);
    if (!cur || cur.link !== link) return;
    for (const h of cur.turns.values()) h.onError("runner disconnected");
    this.live.delete(memberId);
    this.emit(memberId);
  }

  status(memberId: string): { online: boolean; name?: string; runnerId?: string } {
    const cur = this.live.get(memberId);
    return cur ? { online: true, name: cur.name, runnerId: cur.runnerId } : { online: false };
  }

  onStatusChange(memberId: string, cb: StatusListener): () => void {
    const set = this.listeners.get(memberId) ?? new Set();
    set.add(cb);
    this.listeners.set(memberId, set);
    return () => set.delete(cb);
  }

  startTurn(
    memberId: string,
    turn: { conversationId: string; text: string; resumeSessionId?: string | null },
    handlers: TurnHandlers,
  ) {
    const cur = this.live.get(memberId);
    if (!cur) return null;
    const turnId = this.newId();
    cur.turns.set(turnId, handlers);
    this.push(cur, { type: "turn_start", turnId, conversationId: turn.conversationId, text: turn.text, resumeSessionId: turn.resumeSessionId ?? null });
    return {
      turnId,
      cancel: () => this.push(cur, { type: "cancel", turnId }),
      answerPermission: (id: string, allow: boolean) => this.push(cur, { type: "permission_response", id, allow }),
    };
  }

  async handleMessage(memberId: string, raw: string): Promise<void> {
    const cur = this.live.get(memberId);
    const msg = parseRunnerMessage(raw);
    if (!cur || !msg) return;

    if (msg.type === "memory_call") {
      const result =
        msg.tool === "remember" ? await this.memory.remember(memberId, msg.args) : await this.memory.recall(memberId, msg.args);
      this.push(cur, { type: "memory_result", callId: msg.callId, result });
      return;
    }

    const h = cur.turns.get(msg.turnId);
    if (!h) return;
    switch (msg.type) {
      case "text_delta":
        return h.onDelta(msg.text);
      case "tool_start":
        return h.onTool(msg.name, msg.summary);
      case "permission_request":
        return h.onPermission(msg.id, msg.question, msg.detail);
      case "turn_done":
        cur.turns.delete(msg.turnId);
        return h.onDone({ sessionId: msg.sessionId, costUsd: msg.costUsd, fullText: msg.fullText });
      case "turn_error":
        cur.turns.delete(msg.turnId);
        return h.onError(msg.message);
    }
  }

  private push(cur: Live, msg: CloudToRunner) {
    cur.link.send(JSON.stringify(msg));
  }

  private emit(memberId: string) {
    const s = this.status(memberId);
    for (const cb of this.listeners.get(memberId) ?? []) cb({ online: s.online, name: s.name });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w server 2>&1 | grep -E "passed|failed"`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add server/src/ws/runner-hub.ts server/src/ws/runner-hub.test.ts
git commit -m "Add RunnerHub to route turns between members and their runners"
```

---

### Task 7: Phone protocol gains runner_status; Session delegates to the hub

**Files:**
- Modify: `server/src/ws/protocol.ts`, `server/src/ws/session.ts`, `server/src/ws/session.test.ts`

**Interfaces:**
- `ServerMessage` gains `{ type: "runner_status"; online: boolean; name?: string }`.
- `Session` constructor becomes `new Session(ws: WSContext, memberId: string, hub: RunnerHub, speaker?: Speaker)`. Behavior: `hello` → conversation scoped to member + immediate `runner_status`; `user_text` with no runner → speaks and sends status text "Your runner isn't connected. Start kaya-runner on your machine." and stores nothing; with a runner → echo, store user message, `hub.startTurn`, forward deltas/tools/permissions, TTS per sentence, on done store assistant message + `setAgentSession(conversationId, sessionId, runnerId)`, `assistant_done`, `speak_end`; `resumeSessionId` is passed only when the conversation's `runnerId` equals the live runner id.

- [ ] **Step 1: Write the failing tests** (replace `server/src/ws/session.test.ts`)

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  addMessage: vi.fn(),
  setAgentSession: vi.fn(),
}));

import * as repo from "../db/repo.js";
import { RunnerHub } from "./runner-hub.js";
import { Session } from "./session.js";

const fakeWs = () => {
  const sent: string[] = [];
  const raw: Uint8Array[] = [];
  const ws = { send: (d: string | Uint8Array) => (typeof d === "string" ? sent.push(d) : raw.push(d)) } as never;
  return { sent, raw, ws, json: () => sent.map((s) => JSON.parse(s)) };
};
const speaker = { speak: vi.fn(async () => new Uint8Array([1, 2, 3])) };
const memory = { remember: vi.fn(async () => ""), recall: vi.fn(async () => "") };
const runnerLink = () => {
  const sent: string[] = [];
  return { sent, send: (d: string) => sent.push(d), close: () => {} };
};

describe("Session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.createConversation).mockResolvedValue({ id: "c1", memberId: "m1", runnerId: null, agentSessionId: null } as never);
  });

  it("reports a thrown error to the client instead of swallowing it", async () => {
    vi.mocked(repo.createConversation).mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ws, json } = fakeWs();
    await new Session(ws, "m1", new RunnerHub(memory), speaker).handle(JSON.stringify({ type: "hello" }));
    expect(json()).toContainEqual({ type: "error", message: "db down" });
  });

  it("hello sends ready and the runner status", async () => {
    const { ws, json } = fakeWs();
    await new Session(ws, "m1", new RunnerHub(memory), speaker).handle(JSON.stringify({ type: "hello" }));
    expect(json()).toEqual([
      { type: "ready", conversationId: "c1" },
      { type: "runner_status", online: false },
    ]);
  });

  it("with no runner online, user_text speaks a fallback and stores nothing", async () => {
    const { ws, json } = fakeWs();
    const s = new Session(ws, "m1", new RunnerHub(memory), speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));
    expect(repo.addMessage).not.toHaveBeenCalled();
    expect(json()).toContainEqual({ type: "status", text: "Your runner isn't connected. Start kaya-runner on your machine." });
    expect(speaker.speak).toHaveBeenCalledWith("Your runner isn't connected. Start kaya-runner on your machine.", expect.anything());
  });

  it("routes a turn through the runner and stores both sides", async () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws, json, raw } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));

    expect(JSON.parse(link.sent[0])).toMatchObject({ type: "turn_start", turnId: "turn-1", conversationId: "c1", text: "hi", resumeSessionId: null });
    expect(repo.addMessage).toHaveBeenCalledWith("c1", "user", "hi");

    await hub.handleMessage("m1", JSON.stringify({ type: "text_delta", turnId: "turn-1", text: "Hello there." }));
    await hub.handleMessage("m1", JSON.stringify({ type: "turn_done", turnId: "turn-1", sessionId: "s1", costUsd: 0.1, fullText: "Hello there." }));
    await new Promise((r) => setTimeout(r, 0));

    expect(json()).toContainEqual({ type: "assistant_delta", text: "Hello there." });
    expect(json()).toContainEqual({ type: "assistant_done", text: "Hello there.", costUsd: 0.1 });
    expect(repo.addMessage).toHaveBeenCalledWith("c1", "assistant", "Hello there.", { costUsd: 0.1 });
    expect(repo.setAgentSession).toHaveBeenCalledWith("c1", "s1", "r1");
    expect(raw.length).toBeGreaterThan(0);
    expect(json().at(-1)).toEqual({ type: "speak_end" });
  });

  it("only resumes an agent session created on the same runner", async () => {
    vi.mocked(repo.getConversation).mockResolvedValue({ id: "c1", memberId: "m1", runnerId: "r-old", agentSessionId: "s-old" } as never);
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r-new", "mac", link);
    const { ws } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello", conversationId: "c1" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "hi" }));
    expect(JSON.parse(link.sent[0]).resumeSessionId).toBeNull();
  });

  it("forwards a permission request and relays the answer", async () => {
    const hub = new RunnerHub(memory, () => "turn-1");
    const link = runnerLink();
    hub.attach("m1", "r1", "mac", link);
    const { ws, json } = fakeWs();
    const s = new Session(ws, "m1", hub, speaker);
    await s.handle(JSON.stringify({ type: "hello" }));
    await s.handle(JSON.stringify({ type: "user_text", text: "delete it" }));
    await hub.handleMessage("m1", JSON.stringify({ type: "permission_request", turnId: "turn-1", id: "p1", question: "Run it?", detail: "rm -rf x" }));
    expect(json()).toContainEqual({ type: "permission_request", id: "p1", question: "Run it?", detail: "rm -rf x" });
    await s.handle(JSON.stringify({ type: "permission_response", id: "p1", allow: false }));
    expect(JSON.parse(link.sent[1])).toEqual({ type: "permission_response", id: "p1", allow: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server 2>&1 | grep -E "FAIL|error TS|AssertionError" | head`
Expected: FAIL (constructor signature, missing runner_status, old behavior)

- [ ] **Step 3: Add `runner_status` to the phone protocol**

In `server/src/ws/protocol.ts` add to `ServerMessage`:

```ts
  | { type: "runner_status"; online: boolean; name?: string }
```

- [ ] **Step 4: Rewrite `server/src/ws/session.ts`**

```ts
import type { WSContext } from "hono/ws";
import { SentenceChunker } from "../voice/chunker.js";
import { ElevenLabsSpeaker, type Speaker } from "../voice/tts.js";
import { encodeAudioFrame, type ClientMessage, type ServerMessage } from "./protocol.js";
import type { RunnerHub } from "./runner-hub.js";
import * as repo from "../db/repo.js";

const NO_RUNNER = "Your runner isn't connected. Start kaya-runner on your machine.";

/**
 * One phone socket = one live session for one member. Routes user text to the
 * member's runner through the hub, streams text back, runs TTS per sentence,
 * and brokers permission prompts.
 */
export class Session {
  private conversation: { id: string; runnerId: string | null; agentSessionId: string | null } | null = null;
  private turn: { turnId: string; cancel(): void; answerPermission(id: string, allow: boolean): void; abort: AbortController } | null = null;
  private unsubscribeStatus: (() => void) | null = null;

  constructor(
    private readonly ws: WSContext,
    private readonly memberId: string,
    private readonly hub: RunnerHub,
    private readonly speaker: Speaker = new ElevenLabsSpeaker(),
  ) {
    this.unsubscribeStatus = hub.onStatusChange(memberId, (s) => this.send({ type: "runner_status", online: s.online, name: s.name }));
  }

  private send(msg: ServerMessage) {
    this.ws.send(JSON.stringify(msg));
  }

  async handle(raw: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.send({ type: "error", message: "Malformed message" });
    }
    try {
      await this.dispatch(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`session error handling ${msg.type}:`, err);
      this.send({ type: "error", message });
    }
  }

  private async dispatch(msg: ClientMessage) {
    switch (msg.type) {
      case "hello":
        return this.hello(msg.conversationId);
      case "user_text":
        return this.userText(msg.text);
      case "permission_response":
        return this.turn?.answerPermission(msg.id, msg.allow);
      case "cancel":
        return this.cancelTurn();
    }
  }

  private async hello(existingId?: string) {
    const existing = existingId ? await repo.getConversation(existingId, this.memberId) : null;
    const conv = existing ?? (await repo.createConversation(this.memberId));
    this.conversation = { id: conv.id, runnerId: conv.runnerId ?? null, agentSessionId: conv.agentSessionId ?? null };
    this.send({ type: "ready", conversationId: conv.id });
    const s = this.hub.status(this.memberId);
    this.send({ type: "runner_status", online: s.online, name: s.name });
  }

  private cancelTurn() {
    this.turn?.cancel();
    this.turn?.abort.abort();
    this.turn = null;
  }

  private async userText(text: string) {
    if (!this.conversation) await this.hello();
    const conv = this.conversation!;
    const clean = text.trim();
    if (!clean) return;

    this.cancelTurn();
    const abort = new AbortController();
    const chunker = new SentenceChunker();
    let seq = 0;
    const ttsQueue: Promise<void>[] = [];

    const speakSentence = (sentence: string) => {
      const mySeq = seq++;
      const p = this.speaker
        .speak(sentence, abort.signal)
        .then((mp3) => {
          if (!abort.signal.aborted) this.ws.send(encodeAudioFrame(mySeq, mp3));
        })
        .catch((err) => {
          if (!abort.signal.aborted) this.send({ type: "status", text: `TTS failed: ${err.message}` });
        });
      ttsQueue.push(p);
    };

    const status = this.hub.status(this.memberId);
    if (!status.online) {
      this.send({ type: "status", text: NO_RUNNER });
      speakSentence(NO_RUNNER);
      await Promise.allSettled(ttsQueue);
      this.send({ type: "speak_end" });
      return;
    }

    this.send({ type: "user_echo", text: clean });
    await repo.addMessage(conv.id, "user", clean);

    const resumeSessionId = conv.runnerId === status.runnerId ? conv.agentSessionId : null;
    const finish = new Promise<void>((resolve) => {
      const handle = this.hub.startTurn(
        this.memberId,
        { conversationId: conv.id, text: clean, resumeSessionId },
        {
          onDelta: (t) => {
            this.send({ type: "assistant_delta", text: t });
            for (const s of chunker.push(t)) speakSentence(s);
          },
          onTool: (name, summary) => {
            this.send({ type: "tool", name, summary });
            void repo.addMessage(conv.id, "tool", summary, { name });
          },
          onPermission: (id, question, detail) => {
            this.send({ type: "permission_request", id, question, detail });
            speakSentence(question);
          },
          onDone: async ({ sessionId, costUsd, fullText }) => {
            const tail = chunker.flush();
            if (tail) speakSentence(tail);
            if (sessionId && status.runnerId) {
              conv.agentSessionId = sessionId;
              conv.runnerId = status.runnerId;
              await repo.setAgentSession(conv.id, sessionId, status.runnerId);
            }
            await repo.addMessage(conv.id, "assistant", fullText, { costUsd });
            this.send({ type: "assistant_done", text: fullText, costUsd });
            resolve();
          },
          onError: (message) => {
            this.send({ type: "error", message });
            resolve();
          },
        },
      );
      if (!handle) {
        this.send({ type: "status", text: NO_RUNNER });
        resolve();
        return;
      }
      this.turn = { ...handle, abort };
    });

    await finish;
    await Promise.allSettled(ttsQueue);
    if (!abort.signal.aborted) this.send({ type: "speak_end" });
    if (this.turn?.abort === abort) this.turn = null;
  }

  close() {
    this.cancelTurn();
    this.unsubscribeStatus?.();
  }
}
```

The `summarizeTool` helper moves to the runner in Task 12; delete it from this file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w server 2>&1 | grep -E "passed|failed"`
Expected: session tests pass. Typecheck still fails in `index.ts`, `auth.ts`, `agent/*` (fixed next tasks).

- [ ] **Step 6: Commit**

```bash
git add server/src/ws/protocol.ts server/src/ws/session.ts server/src/ws/session.test.ts
git commit -m "Route phone turns through the RunnerHub and report runner status"
```

---

### Task 8: Auth middleware and routes (GitHub sign-in, invites, me, logout)

**Files:**
- Create: `server/src/auth/middleware.ts`, `server/src/routes/auth.ts`
- Test: `server/src/routes/auth.test.ts`
- Delete: `server/src/auth.ts`

**Interfaces:**
- `requireMember: MiddlewareHandler` sets `c.set("memberId", id)` or returns 401 JSON. `memberIdFromRequest(cookieHeader: string | undefined, secret: string): string | null` (pure, used by the phone socket upgrade too).
- `authRoutes(deps): Hono` where `deps = { config: { GITHUB_CLIENT_ID; GITHUB_CLIENT_SECRET; COOKIE_SECRET; PUBLIC_URL; isProd: boolean }, exchange?: typeof exchangeGithubCode }`. Routes: `GET /auth/github` (sets `kaya_oauth_state` cookie, redirects), `GET /auth/github/callback?code&state[&invite]` (existing member → set cookie → redirect `/`; new member without invite → 200 HTML form posting back with `invite`; new member with valid invite → create member, burn invite, set cookie, redirect `/`; invalid invite → 403 HTML), `POST /auth/logout` (clears cookie), `GET /api/me` (requireMember → `{ id, login, avatarUrl }`).

- [ ] **Step 1: Write the failing test**

```ts
// server/src/routes/auth.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({
  findMemberByGithubId: vi.fn(),
  createMember: vi.fn(),
  getMember: vi.fn(),
  inviteIsUnused: vi.fn(),
  redeemInvite: vi.fn(),
}));

import * as repo from "../db/repo.js";
import { signSession } from "../auth/cookie.js";
import { authRoutes } from "./auth.js";

const cfg = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "sec", COOKIE_SECRET: "0123456789abcdef0123456789abcdef", PUBLIC_URL: "http://localhost:5173", isProd: false };
const exchange = vi.fn(async () => ({ githubId: 42, login: "octo", avatarUrl: "https://a/x.png" }));
const app = () => authRoutes({ config: cfg, exchange });
const stateCookie = "kaya_oauth_state=st4te";

describe("auth routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to GitHub with a state cookie", async () => {
    const res = await app().request("/auth/github");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("https://github.com/login/oauth/authorize?");
    expect(res.headers.get("set-cookie")).toContain("kaya_oauth_state=");
  });

  it("signs in an existing member and sets the session cookie", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue({ id: "m1", githubId: 42 } as never);
    const res = await app().request("/auth/github/callback?code=abc&state=st4te", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain("kaya_session=");
  });

  it("asks a new member for an invite code", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue(undefined as never);
    const res = await app().request("/auth/github/callback?code=abc&state=st4te", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('name="invite"');
    expect(repo.createMember).not.toHaveBeenCalled();
  });

  it("creates the member and burns the invite when the code is valid", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue(undefined as never);
    vi.mocked(repo.inviteIsUnused).mockResolvedValue(true);
    vi.mocked(repo.createMember).mockResolvedValue({ id: "m9" } as never);
    vi.mocked(repo.redeemInvite).mockResolvedValue(true);
    const res = await app().request("/auth/github/callback?code=abc&state=st4te&invite=ABCDEFGHJKLM", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(302);
    expect(repo.createMember).toHaveBeenCalledWith({ githubId: 42, login: "octo", avatarUrl: "https://a/x.png" });
    expect(repo.redeemInvite).toHaveBeenCalledWith("ABCDEFGHJKLM", "m9");
  });

  it("rejects a used or unknown invite", async () => {
    vi.mocked(repo.findMemberByGithubId).mockResolvedValue(undefined as never);
    vi.mocked(repo.inviteIsUnused).mockResolvedValue(false);
    const res = await app().request("/auth/github/callback?code=abc&state=st4te&invite=NOPE", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(403);
    expect(repo.createMember).not.toHaveBeenCalled();
  });

  it("rejects a state mismatch", async () => {
    const res = await app().request("/auth/github/callback?code=abc&state=other", { headers: { cookie: stateCookie } });
    expect(res.status).toBe(400);
  });

  it("GET /api/me needs a valid session cookie", async () => {
    expect((await app().request("/api/me")).status).toBe(401);
    vi.mocked(repo.getMember).mockResolvedValue({ id: "m1", githubLogin: "octo", avatarUrl: "https://a/x.png" } as never);
    const res = await app().request("/api/me", { headers: { cookie: `kaya_session=${signSession("m1", cfg.COOKIE_SECRET)}` } });
    expect(await res.json()).toEqual({ id: "m1", login: "octo", avatarUrl: "https://a/x.png" });
  });

  it("POST /auth/logout clears the cookie", async () => {
    const res = await app().request("/auth/logout", { method: "POST" });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server 2>&1 | grep -E "FAIL|Cannot find"`
Expected: FAIL, cannot find `./auth.js`

- [ ] **Step 3: Write the middleware**

```ts
// server/src/auth/middleware.ts
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { config } from "../config.js";
import { SESSION_COOKIE, verifySession } from "./cookie.js";

/** Pure: parse a raw Cookie header and return the member id, or null. Used by socket upgrades. */
export function memberIdFromCookieHeader(cookieHeader: string | undefined, secret: string): string | null {
  if (!cookieHeader) return null;
  const pair = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`));
  return verifySession(pair?.slice(SESSION_COOKIE.length + 1), secret);
}

export type MemberEnv = { Variables: { memberId: string } };

export const requireMember: MiddlewareHandler<MemberEnv> = async (c, next) => {
  const id = verifySession(getCookie(c, SESSION_COOKIE), config.COOKIE_SECRET);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  c.set("memberId", id);
  await next();
};
```

- [ ] **Step 4: Write the routes**

```ts
// server/src/routes/auth.ts
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { clearSessionCookieHeader, sessionCookieHeader, signSession, SESSION_COOKIE, verifySession } from "../auth/cookie.js";
import { exchangeGithubCode, githubAuthorizeUrl } from "../auth/github.js";
import * as repo from "../db/repo.js";

export interface AuthDeps {
  config: { GITHUB_CLIENT_ID: string; GITHUB_CLIENT_SECRET: string; COOKIE_SECRET: string; PUBLIC_URL: string; isProd: boolean };
  exchange?: typeof exchangeGithubCode;
}

const STATE_COOKIE = "kaya_oauth_state";

const page = (title: string, body: string) =>
  `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;background:#141A26;color:#e6e9f0;display:grid;place-items:center;min-height:100vh;margin:0}form,main{max-width:360px;padding:24px}input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin-top:8px;border-radius:10px;border:1px solid #334}button{background:#e6e9f0;color:#141A26}</style>${body}`;

export function authRoutes({ config, exchange = exchangeGithubCode }: AuthDeps) {
  const app = new Hono();
  const redirectUri = `${config.PUBLIC_URL}/auth/github/callback`;

  app.get("/auth/github", (c) => {
    const state = randomBytes(16).toString("hex");
    setCookie(c, STATE_COOKIE, state, { path: "/", httpOnly: true, sameSite: "Lax", maxAge: 600, secure: config.isProd });
    return c.redirect(githubAuthorizeUrl(config.GITHUB_CLIENT_ID, redirectUri, state));
  });

  app.get("/auth/github/callback", async (c) => {
    const { code, state, invite } = c.req.query();
    if (!code || !state || state !== getCookie(c, STATE_COOKIE)) return c.text("Bad OAuth state", 400);

    const user = await exchange({ code, clientId: config.GITHUB_CLIENT_ID, clientSecret: config.GITHUB_CLIENT_SECRET });
    let member = await repo.findMemberByGithubId(user.githubId);

    if (!member) {
      if (!invite) {
        const action = `/auth/github/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
        return c.html(
          page("Kaya — invite", `<form method="get" action="${action}"><h1>Welcome, ${user.login}</h1><p>Kaya is invite only. Paste your invite code.</p><input name="invite" placeholder="Invite code" autocapitalize="characters" autocomplete="off"><input type="hidden" name="code" value="${code}"><input type="hidden" name="state" value="${state}"><button>Join</button></form>`),
        );
      }
      const clean = String(invite).trim().toUpperCase();
      if (!(await repo.inviteIsUnused(clean))) return c.html(page("Kaya — invite", `<main><h1>Invite not valid</h1><p>That code is unknown or already used. Ask for a new one.</p></main>`), 403);
      member = await repo.createMember({ githubId: user.githubId, login: user.login, avatarUrl: user.avatarUrl });
      await repo.redeemInvite(clean, member.id);
    }

    c.header("Set-Cookie", sessionCookieHeader(signSession(member.id, config.COOKIE_SECRET), config.isProd), { append: true });
    setCookie(c, STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return c.redirect("/");
  });

  app.post("/auth/logout", (c) => {
    c.header("Set-Cookie", clearSessionCookieHeader());
    return c.json({ ok: true });
  });

  app.get("/api/me", async (c) => {
    const id = verifySession(getCookie(c, SESSION_COOKIE), config.COOKIE_SECRET);
    if (!id) return c.json({ error: "unauthorized" }, 401);
    const m = await repo.getMember(id);
    if (!m) return c.json({ error: "unauthorized" }, 401);
    return c.json({ id: m.id, login: m.githubLogin, avatarUrl: m.avatarUrl });
  });

  return app;
}
```

Note: `/api/me` verifies inline rather than through `requireMember` so the route module stays testable without importing `config.js` (which exits on a missing `.env` in tests).

- [ ] **Step 5: Delete the old token auth**

```bash
git rm -q server/src/auth.ts
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w server 2>&1 | grep -E "passed|failed"`
Expected: all passed

- [ ] **Step 7: Commit**

```bash
git add server/src/auth/middleware.ts server/src/routes/auth.ts server/src/routes/auth.test.ts
git commit -m "Add GitHub sign-in with invite codes and a signed session cookie"
```

---

### Task 9: Pairing routes and the runner socket

**Files:**
- Create: `server/src/routes/pairing.ts`, `server/src/ws/runner-socket.ts`
- Test: `server/src/routes/pairing.test.ts`

**Interfaces:**
- `pairingRoutes(deps: { secret: string; publicUrl: string; now?: () => number }): Hono` with:
  - `POST /api/pair/start` body `{ name: string; workspace: string }` → `{ code, publicId, verifyUrl }`.
  - `GET /api/pair/poll?publicId=` → `{ status: "pending" }` | `{ status: "expired" }` | `{ status: "paired", token }` (token returned exactly once; the pairing row is deleted and the runner row upserted at that moment).
  - `POST /api/pair/confirm` (session cookie) body `{ code }` → `{ ok: true }` | 404 | 410.
  - The runner's `name` and `workspace` from `start` are kept in an in-memory `Map<publicId, { name; workspace }>` (they're needed at poll time; the table doesn't store them).
- `runnerSocket(hub: RunnerHub, upgradeWebSocket)` → a handler for `GET /runner`: reads `Authorization: Bearer <token>`, `findRunnerByTokenHash(hashRunnerToken(token))`, 4401 close if unknown; on open `hub.attach(memberId, runner.id, runner.name, link)` + `touchRunner`; on message `hub.handleMessage`; on close `hub.detach`.

- [ ] **Step 1: Write the failing test**

```ts
// server/src/routes/pairing.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/repo.js", () => ({
  createPairingCode: vi.fn(),
  getPairingCode: vi.fn(),
  getPairingByPublicId: vi.fn(),
  confirmPairingCode: vi.fn(),
  deletePairingCode: vi.fn(),
  upsertRunner: vi.fn(),
}));

import * as repo from "../db/repo.js";
import { signSession } from "../auth/cookie.js";
import { pairingRoutes } from "./pairing.js";

const secret = "0123456789abcdef0123456789abcdef";
const app = () => pairingRoutes({ secret, publicUrl: "https://kaya.example", now: () => 1_000_000 });
const cookie = `kaya_session=${signSession("m1", secret, 1_000_000)}`;

describe("pairing routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("start creates a code and returns the verify url", async () => {
    const res = await app().request("/api/pair/start", { method: "POST", body: JSON.stringify({ name: "mac", workspace: "/w" }), headers: { "content-type": "application/json" } });
    const body = await res.json();
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.verifyUrl).toBe(`https://kaya.example/pair?code=${body.code}`);
    expect(repo.createPairingCode).toHaveBeenCalledWith(body.code, body.publicId, new Date(1_000_000 + 600_000));
  });

  it("poll is pending until confirmed, then hands the token once and upserts the runner", async () => {
    const a = app();
    const start = await (await a.request("/api/pair/start", { method: "POST", body: JSON.stringify({ name: "mac", workspace: "/w" }), headers: { "content-type": "application/json" } })).json();
    vi.mocked(repo.getPairingByPublicId).mockResolvedValueOnce({ code: start.code, runnerPublicId: start.publicId, memberId: null, expiresAt: new Date(1_600_000) } as never);
    expect(await (await a.request(`/api/pair/poll?publicId=${start.publicId}`)).json()).toEqual({ status: "pending" });

    vi.mocked(repo.getPairingByPublicId).mockResolvedValueOnce({ code: start.code, runnerPublicId: start.publicId, memberId: "m1", expiresAt: new Date(1_600_000) } as never);
    vi.mocked(repo.upsertRunner).mockResolvedValue({ id: "r1" } as never);
    const paired = await (await a.request(`/api/pair/poll?publicId=${start.publicId}`)).json();
    expect(paired.status).toBe("paired");
    expect(paired.token).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.upsertRunner).toHaveBeenCalledWith(expect.objectContaining({ memberId: "m1", name: "mac", workspace: "/w" }));
    expect(repo.deletePairingCode).toHaveBeenCalledWith(start.code);
  });

  it("poll reports expired codes", async () => {
    vi.mocked(repo.getPairingByPublicId).mockResolvedValueOnce({ code: "1", runnerPublicId: "p", memberId: null, expiresAt: new Date(900_000) } as never);
    expect(await (await app().request("/api/pair/poll?publicId=p")).json()).toEqual({ status: "expired" });
  });

  it("confirm requires a session and a live code", async () => {
    expect((await app().request("/api/pair/confirm", { method: "POST", body: JSON.stringify({ code: "123456" }), headers: { "content-type": "application/json" } })).status).toBe(401);
    vi.mocked(repo.getPairingCode).mockResolvedValueOnce(undefined as never);
    expect((await app().request("/api/pair/confirm", { method: "POST", body: JSON.stringify({ code: "123456" }), headers: { "content-type": "application/json", cookie } })).status).toBe(404);
    vi.mocked(repo.getPairingCode).mockResolvedValueOnce({ code: "123456", memberId: null, expiresAt: new Date(1_600_000) } as never);
    vi.mocked(repo.confirmPairingCode).mockResolvedValueOnce(true);
    const ok = await app().request("/api/pair/confirm", { method: "POST", body: JSON.stringify({ code: "123456" }), headers: { "content-type": "application/json", cookie } });
    expect(ok.status).toBe(200);
    expect(repo.confirmPairingCode).toHaveBeenCalledWith("123456", "m1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server 2>&1 | grep -E "FAIL|Cannot find"`
Expected: FAIL, cannot find `./pairing.js`

- [ ] **Step 3: Write the pairing routes**

```ts
// server/src/routes/pairing.ts
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { randomUUID } from "node:crypto";
import { SESSION_COOKIE, verifySession } from "../auth/cookie.js";
import { hashRunnerToken, newPairingCode, newRunnerToken, pairingExpired, pairingExpiresAt } from "../auth/pairing.js";
import * as repo from "../db/repo.js";

export interface PairingDeps {
  secret: string;
  publicUrl: string;
  now?: () => number;
}

export function pairingRoutes({ secret, publicUrl, now = Date.now }: PairingDeps) {
  const app = new Hono();
  const pendingMeta = new Map<string, { name: string; workspace: string }>();

  app.post("/api/pair/start", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; workspace?: string };
    const name = String(body.name ?? "runner").slice(0, 80);
    const workspace = String(body.workspace ?? "").slice(0, 400);
    const code = newPairingCode();
    const publicId = randomUUID();
    await repo.createPairingCode(code, publicId, pairingExpiresAt(now()));
    pendingMeta.set(publicId, { name, workspace });
    return c.json({ code, publicId, verifyUrl: `${publicUrl}/pair?code=${code}` });
  });

  app.get("/api/pair/poll", async (c) => {
    const publicId = c.req.query("publicId") ?? "";
    const row = await repo.getPairingByPublicId(publicId);
    if (!row) return c.json({ status: "expired" });
    if (pairingExpired(row.expiresAt, now())) {
      await repo.deletePairingCode(row.code);
      pendingMeta.delete(publicId);
      return c.json({ status: "expired" });
    }
    if (!row.memberId) return c.json({ status: "pending" });

    const meta = pendingMeta.get(publicId) ?? { name: "runner", workspace: "" };
    const token = newRunnerToken();
    await repo.upsertRunner({ memberId: row.memberId, name: meta.name, tokenHash: hashRunnerToken(token), workspace: meta.workspace });
    await repo.deletePairingCode(row.code);
    pendingMeta.delete(publicId);
    return c.json({ status: "paired", token });
  });

  app.post("/api/pair/confirm", async (c) => {
    const memberId = verifySession(getCookie(c, SESSION_COOKIE), secret, now());
    if (!memberId) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    const code = String(body.code ?? "").trim();
    const row = await repo.getPairingCode(code);
    if (!row) return c.json({ error: "unknown code" }, 404);
    if (pairingExpired(row.expiresAt, now())) return c.json({ error: "expired" }, 410);
    const ok = await repo.confirmPairingCode(code, memberId);
    return ok ? c.json({ ok: true }) : c.json({ error: "already confirmed" }, 409);
  });

  return app;
}
```

- [ ] **Step 4: Write the runner socket handler**

```ts
// server/src/ws/runner-socket.ts
import type { UpgradeWebSocket } from "hono/ws";
import { hashRunnerToken } from "../auth/pairing.js";
import * as repo from "../db/repo.js";
import type { RunnerHub, RunnerLink } from "./runner-hub.js";

/** `GET /runner`: authenticates a runner by bearer token and attaches it to the hub. */
export function runnerSocket(hub: RunnerHub, upgradeWebSocket: UpgradeWebSocket) {
  return upgradeWebSocket(async (c) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const runner = token ? await repo.findRunnerByTokenHash(hashRunnerToken(token)) : undefined;
    if (!runner) {
      return { onOpen(_evt, ws) { ws.close(4401, "unauthorized"); } };
    }
    let link: RunnerLink | null = null;
    return {
      onOpen(_evt, ws) {
        link = { send: (d) => ws.send(d), close: (code, reason) => ws.close(code, reason) };
        hub.attach(runner.memberId, runner.id, runner.name, link);
        void repo.touchRunner(runner.id);
      },
      onMessage(evt) {
        if (typeof evt.data === "string") void hub.handleMessage(runner.memberId, evt.data);
      },
      onClose() {
        if (link) hub.detach(runner.memberId, link);
      },
    };
  });
}
```

If `upgradeWebSocket` in the installed `@hono/node-ws` does not accept an async callback, wrap it: resolve the runner first in a small `app.use("/runner", ...)` middleware that stores it on `c.set("runner", row)`, then keep the upgrade callback synchronous and read `c.get("runner")`. Check `node_modules/hono/dist/types/helper/websocket/index.d.ts` for `UpgradeWebSocket`'s callback type before choosing.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w server 2>&1 | grep -E "passed|failed"`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/pairing.ts server/src/routes/pairing.test.ts server/src/ws/runner-socket.ts
git commit -m "Add runner pairing routes and the authenticated runner socket"
```

---

### Task 10: Wire the server entry, invite script, and remove the agent from the cloud

**Files:**
- Modify: `server/src/index.ts`, `server/package.json`, `server/src/voice/tts.ts` (unchanged API; only imports), `.claude/hooks/block-dangerous-bash.js`, `.claude/rules/agent.md`
- Create: `server/src/scripts/invite.ts`
- Delete: `server/src/agent/` (entire folder, moved to runner in Task 12; `git mv` there, so this task only removes imports)

**Interfaces:**
- `index.ts` builds one `RunnerHub` with a `MemoryService` backed by `repo.remember`/`repo.recall`, mounts `authRoutes`, `pairingRoutes`, `/api/scribe-token` behind `requireMember`, `/ws` authenticated by cookie via `memberIdFromCookieHeader`, `/runner` via `runnerSocket`, and a `GET /pair` HTML page that confirms a code for a signed-in member.

- [ ] **Step 1: Rewrite `server/src/index.ts`**

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { getCookie } from "hono/cookie";
import { config, isProd } from "./config.js";
import { SESSION_COOKIE, verifySession } from "./auth/cookie.js";
import { memberIdFromCookieHeader, requireMember } from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { pairingRoutes } from "./routes/pairing.js";
import { createScribeToken } from "./voice/tts.js";
import { RunnerHub } from "./ws/runner-hub.js";
import { runnerSocket } from "./ws/runner-socket.js";
import { Session } from "./ws/session.js";
import * as repo from "./db/repo.js";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Method + path + status only. Never the query string: it must not leak tokens or codes.
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`);
});

const hub = new RunnerHub({
  remember: async (memberId, args) => {
    const a = args as { kind: "fact" | "decision" | "preference" | "project"; subject: string; content: string };
    const row = await repo.remember(memberId, a.kind, a.subject, a.content);
    return `Remembered (${row.id}).`;
  },
  recall: async (memberId, args) => {
    const rows = await repo.recall(memberId, String((args as { query?: string }).query ?? ""));
    if (rows.length === 0) return "Nothing stored about that.";
    return rows.map((r) => `[${r.kind}] ${r.subject}: ${r.content}`).join("\n");
  },
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", authRoutes({ config: { ...config, isProd } }));
app.route("/", pairingRoutes({ secret: config.COOKIE_SECRET, publicUrl: config.PUBLIC_URL }));

// The browser talks to ElevenLabs Scribe directly with a single-use token.
app.get("/api/scribe-token", requireMember, async (c) => c.json(await createScribeToken()));

app.get("/api/runner", requireMember, (c) => c.json(hub.status(c.get("memberId"))));

app.get("/pair", (c) => {
  const member = verifySession(getCookie(c, SESSION_COOKIE), config.COOKIE_SECRET);
  if (!member) return c.redirect("/auth/github");
  const code = c.req.query("code") ?? "";
  return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair runner</title>
<style>body{font:16px system-ui;background:#141A26;color:#e6e9f0;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:360px;padding:24px}input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin-top:8px;border-radius:10px;border:1px solid #334}button{background:#e6e9f0;color:#141A26}</style>
<main><h1>Pair a runner</h1><p>Enter the code shown by kaya-runner.</p><input id="code" value="${code.replace(/[^0-9]/g, "")}" inputmode="numeric" maxlength="6"><button id="go">Confirm</button><p id="out"></p>
<script>document.getElementById('go').onclick=async()=>{const r=await fetch('/api/pair/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value})});document.getElementById('out').textContent=r.ok?'Paired. You can close this page.':'Code not valid: '+r.status;};</script></main>`);
});

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    const memberId = memberIdFromCookieHeader(c.req.header("cookie"), config.COOKIE_SECRET);
    if (!memberId) return { onOpen(_evt, ws) { ws.close(4401, "unauthorized"); } };
    let session: Session | null = null;
    return {
      onOpen(_evt, ws) { session = new Session(ws, memberId, hub); },
      onMessage(evt) { if (typeof evt.data === "string") void session?.handle(evt.data); },
      onClose() { session?.close(); session = null; },
    };
  }),
);

app.get("/runner", runnerSocket(hub, upgradeWebSocket));

if (isProd) {
  app.use("/*", serveStatic({ root: "../web/dist" }));
  app.get("*", serveStatic({ root: "../web/dist", path: "index.html" }));
}

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`Kaya cloud listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
```

- [ ] **Step 2: Add the invite script**

```ts
// server/src/scripts/invite.ts
// Usage: npm run invite            → prints a new invite code
//        npm run invite -- --admin → same, and the member who redeems it becomes admin (first member bootstrap)
import { generateInviteCode } from "../auth/invites.js";
import * as repo from "../db/repo.js";

const code = generateInviteCode();
await repo.createInvite(null, code);
console.log(code);
if (process.argv.includes("--admin")) console.log("(first sign-in with this code should be promoted with: UPDATE members SET is_admin = true WHERE github_login = '<you>';)");
process.exit(0);
```

Add to `server/package.json` scripts: `"invite": "tsx src/scripts/invite.ts"`.

- [ ] **Step 3: Move the agent folder to the runner workspace (placeholder move; Task 12 makes it compile there)**

```bash
mkdir -p runner/src
git mv server/src/agent runner/src/agent
```

Then update `.claude/hooks/block-dangerous-bash.js`: change the patterns path to `runner/src/agent/destructive-patterns.json`. Update `.claude/rules/agent.md` frontmatter `paths` to `runner/src/agent/**` and its text to say the runner owns the agent layer. In `CLAUDE.md`, the security checklist line about `destructive-patterns.json` gets the new path.

- [ ] **Step 4: Typecheck the server**

Run: `npm run typecheck -w server 2>&1 | grep "error TS"`
Expected: clean. If `upgradeWebSocket` rejects the async callback in `runner-socket.ts`, apply the middleware variant described in Task 9 Step 4.

- [ ] **Step 5: Run all server tests**

Run: `npm test -w server 2>&1 | grep -E "passed|failed"`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add -A server .claude/hooks/block-dangerous-bash.js .claude/rules/agent.md CLAUDE.md runner/src/agent
git commit -m "Wire cloud routes, cookie-authenticated sockets and the invite script"
```

---

### Task 11: Runner workspace scaffold, backoff and config

**Files:**
- Create: `runner/package.json`, `runner/tsconfig.json`, `runner/src/backoff.ts`, `runner/src/config.ts`
- Test: `runner/src/backoff.test.ts`, `runner/src/config.test.ts`
- Modify: root `package.json` (workspaces, scripts)

**Interfaces:**
- `nextBackoffMs(attempt: number): number` → 1s, 2s, 4s, … capped at 30s (attempt 0 → 1000).
- `RunnerConfig = { cloudUrl: string; token: string; workspace: string }`; `configPath(home?: string): string` → `<home>/.kaya/runner.json`; `readConfig(path): Promise<RunnerConfig | null>`; `writeConfig(path, cfg): Promise<void>` (mode 0600, mkdir -p).

- [ ] **Step 1: Scaffold the workspace**

`runner/package.json`:

```json
{
  "name": "kaya-runner",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "bin": { "kaya-runner": "dist/cli.js" },
  "files": ["dist"],
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit --pretty false",
    "test": "vitest run --reporter=dot"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.3.0",
    "ws": "^8.18.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`runner/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext", "outDir": "dist", "rootDir": "src", "types": ["node"] },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

Root `package.json`: `"workspaces": ["server", "web", "runner"]`; scripts `"dev": "concurrently -n cloud,web -c blue,magenta \"npm run dev -w server\" \"npm run dev -w web\""`, `"dev:runner": "npm run dev -w runner"`, `"build": "npm run build -w web && npm run build -w server && npm run build -w runner"`, `"typecheck": "npm run typecheck -w server && npm run typecheck -w web && npm run typecheck -w runner"`, `"test": "npm test -w server && npm test -w web && npm test -w runner"`.

Then: `npm install 2>&1 | tail -2` and remove `@anthropic-ai/claude-agent-sdk` and `zod` from `server/package.json` dependencies only if nothing in `server/src` imports them anymore (`grep -rn "claude-agent-sdk\|from \"zod\"" server/src`). `config-schema.ts` uses zod, so zod stays; the SDK goes.

- [ ] **Step 2: Write the failing tests**

```ts
// runner/src/backoff.test.ts
import { describe, expect, it } from "vitest";
import { nextBackoffMs } from "./backoff.js";

describe("nextBackoffMs", () => {
  it("doubles from one second and caps at thirty", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(nextBackoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
});
```

```ts
// runner/src/config.test.ts
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPath, readConfig, writeConfig } from "./config.js";

describe("runner config", () => {
  it("lives at ~/.kaya/runner.json", () => {
    expect(configPath("/Users/x")).toBe("/Users/x/.kaya/runner.json");
  });

  it("round-trips through disk with owner-only permissions and returns null when missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kaya-"));
    const p = configPath(dir);
    expect(await readConfig(p)).toBeNull();
    await writeConfig(p, { cloudUrl: "https://k.example", token: "t", workspace: "/w" });
    expect(await readConfig(p)).toEqual({ cloudUrl: "https://k.example", token: "t", workspace: "/w" });
    expect((await stat(p)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(p, "utf8")).token).toBe("t");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w runner 2>&1 | grep -E "FAIL|Cannot find"`
Expected: FAIL, modules not found

- [ ] **Step 4: Write minimal implementation**

```ts
// runner/src/backoff.ts
export function nextBackoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}
```

```ts
// runner/src/config.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RunnerConfig {
  cloudUrl: string;
  token: string;
  workspace: string;
}

export function configPath(home = homedir()): string {
  return join(home, ".kaya", "runner.json");
}

export async function readConfig(path: string): Promise<RunnerConfig | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<RunnerConfig>;
    if (typeof raw.cloudUrl !== "string" || typeof raw.token !== "string" || typeof raw.workspace !== "string") return null;
    return { cloudUrl: raw.cloudUrl, token: raw.token, workspace: raw.workspace };
  } catch {
    return null;
  }
}

export async function writeConfig(path: string, cfg: RunnerConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w runner 2>&1 | grep -E "passed|failed"`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server/package.json runner/package.json runner/tsconfig.json runner/src/backoff.ts runner/src/backoff.test.ts runner/src/config.ts runner/src/config.test.ts
git commit -m "Scaffold the runner workspace with backoff and config helpers"
```

---

### Task 12: Runner agent code compiles in its new home; memory tools over a bridge

**Files:**
- Modify: `runner/src/agent/tools.ts`, `runner/src/agent/runner.ts`, `runner/src/agent/prompt.ts`, `runner/src/agent/env.test.ts` (unchanged content, now runs under the runner's vitest)
- Create: `runner/src/memory-bridge.ts`, `runner/src/agent/summarize.ts`
- Test: `runner/src/memory-bridge.test.ts`, `runner/src/agent/tools.test.ts`

**Interfaces:**
- `MemoryBridge`: `call(tool: "remember" | "recall", args: Record<string, unknown>): Promise<string>` and `resolve(callId: string, result: string): void`. Constructor takes `send: (msg: { type: "memory_call"; turnId: string; callId: string; tool; args }) => void` and `turnId: () => string`. `pending(): number`.
- `createKayaMcpServer(bridge: MemoryBridge)` replaces the module-level `kayaMcpServer`; `KAYA_TOOL_NAMES` unchanged.
- `runAgentTurn(opts: RunOptions & { workspace: string; mcpServer: ReturnType<typeof createKayaMcpServer> })`: `config.KAYA_WORKSPACE` replaced by `opts.workspace`; `env: buildAgentEnv(process.env, process.env.ANTHROPIC_API_KEY)`.
- `KAYA_SYSTEM_PROMPT(workspace: string): string` becomes a function (it interpolated `config.KAYA_WORKSPACE`).
- `summarizeTool(name: string, input: unknown): string` moves out of the old session into `runner/src/agent/summarize.ts` with the same cases.

- [ ] **Step 1: Write the failing tests**

```ts
// runner/src/memory-bridge.test.ts
import { describe, expect, it, vi } from "vitest";
import { MemoryBridge } from "./memory-bridge.js";

describe("MemoryBridge", () => {
  it("sends memory_call and resolves when the matching memory_result arrives", async () => {
    const send = vi.fn();
    const bridge = new MemoryBridge(send, () => "turn-1", () => "call-1");
    const p = bridge.call("recall", { query: "x" });
    expect(send).toHaveBeenCalledWith({ type: "memory_call", turnId: "turn-1", callId: "call-1", tool: "recall", args: { query: "x" } });
    expect(bridge.pending()).toBe(1);
    bridge.resolve("call-1", "Nothing stored about that.");
    await expect(p).resolves.toBe("Nothing stored about that.");
    expect(bridge.pending()).toBe(0);
  });

  it("ignores results for unknown call ids", () => {
    const bridge = new MemoryBridge(vi.fn(), () => "t", () => "c");
    expect(() => bridge.resolve("nope", "x")).not.toThrow();
  });
});
```

```ts
// runner/src/agent/tools.test.ts
import { describe, expect, it, vi } from "vitest";
import { MemoryBridge } from "../memory-bridge.js";
import { createKayaMcpServer, KAYA_TOOL_NAMES } from "./tools.js";

describe("kaya mcp server", () => {
  it("exposes remember and recall under the kaya server name", () => {
    const bridge = new MemoryBridge(vi.fn(), () => "t", () => "c");
    const server = createKayaMcpServer(bridge);
    expect(server.name).toBe("kaya");
    expect(KAYA_TOOL_NAMES).toEqual(["mcp__kaya__remember", "mcp__kaya__recall"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w runner 2>&1 | grep -E "FAIL|Cannot find|error" | head -5`
Expected: FAIL (bridge missing; `tools.ts` still imports `../db/repo.js` which no longer exists here)

- [ ] **Step 3: Write the bridge**

```ts
// runner/src/memory-bridge.ts
import { randomUUID } from "node:crypto";

type MemoryCall = { type: "memory_call"; turnId: string; callId: string; tool: "remember" | "recall"; args: Record<string, unknown> };

/** Lets the agent's memory tools call the cloud over the runner socket and await the answer. */
export class MemoryBridge {
  private waiting = new Map<string, (result: string) => void>();

  constructor(
    private readonly send: (msg: MemoryCall) => void,
    private readonly currentTurnId: () => string,
    private readonly newId: () => string = randomUUID,
  ) {}

  call(tool: "remember" | "recall", args: Record<string, unknown>): Promise<string> {
    const callId = this.newId();
    return new Promise((resolve) => {
      this.waiting.set(callId, resolve);
      this.send({ type: "memory_call", turnId: this.currentTurnId(), callId, tool, args });
    });
  }

  resolve(callId: string, result: string): void {
    const r = this.waiting.get(callId);
    if (!r) return;
    this.waiting.delete(callId);
    r(result);
  }

  pending(): number {
    return this.waiting.size;
  }
}
```

- [ ] **Step 4: Rewrite `runner/src/agent/tools.ts`**

```ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { MemoryBridge } from "../memory-bridge.js";

/**
 * In-process MCP server exposing Kaya's memory tools to the agent. The tools
 * run on the member's machine but the memory lives in the cloud, so each call
 * goes over the runner socket through the bridge. Names reach the model as
 * `mcp__kaya__<name>`.
 */
export function createKayaMcpServer(bridge: MemoryBridge) {
  return createSdkMcpServer({
    name: "kaya",
    version: "0.2.0",
    instructions: "Long-term memory for the developer you assist. Prefer recall before answering questions about their projects.",
    tools: [
      tool(
        "remember",
        "Store a durable fact, decision, preference, or project detail for future conversations.",
        {
          kind: z.enum(["fact", "decision", "preference", "project"]),
          subject: z.string().describe("Short topic key, e.g. 'etravel', 'git conventions'"),
          content: z.string().describe("One or two sentences, stated plainly"),
        },
        async (args) => ({ content: [{ type: "text", text: await bridge.call("remember", args) }] }),
        { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
      ),
      tool(
        "recall",
        "Search long-term memory by keyword.",
        { query: z.string() },
        async (args) => ({ content: [{ type: "text", text: await bridge.call("recall", args) }] }),
        { annotations: { readOnlyHint: true, openWorldHint: false } },
      ),
    ],
  });
}

export const KAYA_TOOL_NAMES = ["mcp__kaya__remember", "mcp__kaya__recall"];
```

- [ ] **Step 5: Adjust `prompt.ts` and `runner.ts`**

`runner/src/agent/prompt.ts`: remove the `config` import; export `export const KAYA_SYSTEM_PROMPT = (workspace: string) => \`...\`` with `${workspace}` where `${config.KAYA_WORKSPACE}` was. Add one line to the persona rules: `- Address the developer as Blackbox. Never adopt names or words that look like a garbled transcript.`

`runner/src/agent/runner.ts`: remove the `config` import and the module-level `kayaMcpServer` import; `RunOptions` gains `workspace: string` and `mcpServer: ReturnType<typeof createKayaMcpServer>`; inside `query` use `cwd: opts.workspace`, `systemPrompt: KAYA_SYSTEM_PROMPT(opts.workspace)`, `mcpServers: { kaya: opts.mcpServer }`, `env: buildAgentEnv(process.env, process.env.ANTHROPIC_API_KEY)`. Everything else stays.

`runner/src/agent/summarize.ts`: paste the old `summarizeTool` function from the pre-Task-7 `session.ts` (cases `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `mcp__kaya__remember`, `mcp__kaya__recall`, default) and `export` it. Retrieve it with `git show 8fca135:server/src/ws/session.ts | sed -n '/^function summarizeTool/,/^}/p'`.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w runner 2>&1 | grep -E "passed|failed"; npm run typecheck -w runner 2>&1 | grep "error TS"`
Expected: tests pass (bridge, tools, env); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add runner/src
git commit -m "Run the agent from the runner with memory tools bridged to the cloud"
```

---

### Task 13: Runner socket client, turn execution and CLI

**Files:**
- Create: `runner/src/turn.ts`, `runner/src/client.ts`, `runner/src/pair.ts`, `runner/src/cli.ts`
- Test: `runner/src/turn.test.ts`, `runner/src/client.test.ts`

**Interfaces:**
- `runner/src/turn.ts`: `executeTurn(opts: { turn: { turnId; conversationId; text; resumeSessionId?: string | null }; workspace: string; mcpServer; send: (m: RunnerToCloud) => void; permissions: PermissionBroker; runAgent?: typeof runAgentTurn }): { done: Promise<void>; abort(): void }`. Maps agent events to protocol messages: `text_delta`→`text_delta`, `tool_start`→`tool_start` (via `summarizeTool`), `done`→`turn_done`, `error`→`turn_error`. `PermissionBroker` = `{ ask(question, detail): Promise<boolean>; answer(id, allow): void }` implemented in the same file as `class PermissionBroker` that generates ids and sends `permission_request` through `send` with the current turn id.
- `runner/src/client.ts`: `RunnerClient` with `constructor(cfg: RunnerConfig, deps: { makeSocket?: (url, headers) => WebSocketLike; sleep?: (ms) => Promise<void>; log?: (line: string) => void })`, `start(): void` (connect loop with `nextBackoffMs`), `stop(): void`, and `handle(raw: string)` which parses with `parseCloudMessage` and dispatches: `turn_start` → `executeTurn` (one at a time; a new `turn_start` aborts the previous), `cancel` → abort, `permission_response` → broker, `memory_result` → bridge. `WebSocketLike = { send(d: string): void; close(): void; on(event: "open" | "message" | "close" | "error", cb: (...a: any[]) => void): void }`.
- `runner/src/pair.ts`: `pair(cloudUrl: string, name: string, workspace: string, fetchImpl?: typeof fetch, sleep?: (ms) => Promise<void>): Promise<string>` returns the token after polling. Prints the code and URL with `console.log`.
- `runner/src/cli.ts`: entry. Reads config or pairs; asks for the workspace with `node:readline` if missing; refuses if the folder does not exist; prints which credential source is in use; starts the client.
- The runner imports protocol types by relative path: `import type { CloudToRunner, RunnerToCloud } from "../../server/src/ws/runner-protocol.js"` is not allowed across workspaces at runtime. Instead copy the file: `runner/src/protocol.ts` is a verbatim copy of `server/src/ws/runner-protocol.ts` with a header comment `// MIRROR of server/src/ws/runner-protocol.ts. Keep identical.`, and `runner/src/protocol.test.ts` asserts the two files' contents are equal after stripping that header line.

- [ ] **Step 1: Write the failing tests**

```ts
// runner/src/protocol.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("protocol mirror", () => {
  it("matches the cloud's runner-protocol.ts exactly", () => {
    const strip = (s: string) => s.split("\n").filter((l) => !l.startsWith("// MIRROR")).join("\n");
    const cloud = readFileSync(new URL("../../server/src/ws/runner-protocol.ts", import.meta.url), "utf8");
    const mine = readFileSync(new URL("./protocol.ts", import.meta.url), "utf8");
    expect(strip(mine)).toBe(strip(cloud));
  });
});
```

```ts
// runner/src/turn.test.ts
import { describe, expect, it, vi } from "vitest";
import { executeTurn, PermissionBroker } from "./turn.js";

async function* fakeAgent() {
  yield { type: "text_delta" as const, text: "Hi" };
  yield { type: "tool_start" as const, name: "Bash", input: { command: "ls" } };
  yield { type: "done" as const, sessionId: "s1", costUsd: 0.1, fullText: "Hi" };
}

describe("executeTurn", () => {
  it("maps agent events to runner protocol messages", async () => {
    const send = vi.fn();
    const broker = new PermissionBroker(send, () => "t1", () => "p1");
    const t = executeTurn({
      turn: { turnId: "t1", conversationId: "c1", text: "hello" },
      workspace: "/w",
      mcpServer: {} as never,
      send,
      permissions: broker,
      runAgent: () => fakeAgent() as never,
    });
    await t.done;
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: "text_delta", turnId: "t1", text: "Hi" },
      { type: "tool_start", turnId: "t1", name: "Bash", summary: "Running: ls" },
      { type: "turn_done", turnId: "t1", sessionId: "s1", costUsd: 0.1, fullText: "Hi" },
    ]);
  });

  it("permission broker sends a request and resolves on the answer", async () => {
    const send = vi.fn();
    const broker = new PermissionBroker(send, () => "t1", () => "p1");
    const p = broker.ask("Run it?", "rm -rf x");
    expect(send).toHaveBeenCalledWith({ type: "permission_request", turnId: "t1", id: "p1", question: "Run it?", detail: "rm -rf x" });
    broker.answer("p1", true);
    await expect(p).resolves.toBe(true);
  });
});
```

```ts
// runner/src/client.test.ts
import { describe, expect, it, vi } from "vitest";
import { RunnerClient } from "./client.js";

const fakeSocket = () => {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const s = {
    sent: [] as string[],
    headers: {} as Record<string, string>,
    send: (d: string) => s.sent.push(d),
    close: vi.fn(),
    on: (ev: string, cb: (...a: unknown[]) => void) => { handlers[ev] = cb; },
    emit: (ev: string, ...a: unknown[]) => handlers[ev]?.(...a),
  };
  return s;
};

describe("RunnerClient", () => {
  it("connects with the bearer token and reconnects with backoff after close", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const sleeps: number[] = [];
    const client = new RunnerClient(
      { cloudUrl: "https://k.example", token: "tok", workspace: "/w" },
      {
        makeSocket: (url, headers) => { const s = fakeSocket(); s.headers = headers; sockets.push(s); expect(url).toBe("wss://k.example/runner"); return s; },
        sleep: async (ms) => { sleeps.push(ms); },
        log: () => {},
        mcpServer: {} as never,
      },
    );
    client.start();
    expect(sockets[0].headers).toEqual({ Authorization: "Bearer tok" });
    sockets[0].emit("open");
    sockets[0].emit("close");
    await new Promise((r) => setTimeout(r, 0));
    expect(sleeps).toEqual([1000]);
    expect(sockets.length).toBe(2);
    client.stop();
  });

  it("routes memory_result to the bridge and cancel to the running turn", async () => {
    const s = fakeSocket();
    const client = new RunnerClient(
      { cloudUrl: "https://k.example", token: "tok", workspace: "/w" },
      { makeSocket: () => s, sleep: async () => {}, log: () => {}, mcpServer: {} as never, runAgent: () => (async function* () { await new Promise(() => {}); })() as never },
    );
    client.start();
    s.emit("open");
    s.emit("message", JSON.stringify({ type: "turn_start", turnId: "t1", conversationId: "c1", text: "hi", resumeSessionId: null }));
    const p = client.bridge.call("recall", { query: "x" });
    const callId = JSON.parse(s.sent[0]).callId;
    s.emit("message", JSON.stringify({ type: "memory_result", callId, result: "ok" }));
    await expect(p).resolves.toBe("ok");
    s.emit("message", JSON.stringify({ type: "cancel", turnId: "t1" }));
    expect(client.currentTurnId()).toBeNull();
    client.stop();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w runner 2>&1 | grep -E "FAIL|Cannot find" | head -5`
Expected: FAIL, modules not found

- [ ] **Step 3: Create the protocol mirror**

```bash
{ echo "// MIRROR of server/src/ws/runner-protocol.ts. Keep identical."; cat server/src/ws/runner-protocol.ts; } > runner/src/protocol.ts
```

- [ ] **Step 4: Write `runner/src/turn.ts`**

```ts
import { randomUUID } from "node:crypto";
import { runAgentTurn, type AgentEvent } from "./agent/runner.js";
import { summarizeTool } from "./agent/summarize.js";
import type { createKayaMcpServer } from "./agent/tools.js";
import type { RunnerToCloud } from "./protocol.js";

/** Generates permission ids, sends the request to the cloud, and resolves when the answer comes back. */
export class PermissionBroker {
  private waiting = new Map<string, (allow: boolean) => void>();
  constructor(
    private readonly send: (m: RunnerToCloud) => void,
    private readonly currentTurnId: () => string,
    private readonly newId: () => string = randomUUID,
  ) {}
  ask(question: string, detail: string): Promise<boolean> {
    const id = this.newId();
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.send({ type: "permission_request", turnId: this.currentTurnId(), id, question, detail });
    });
  }
  answer(id: string, allow: boolean): void {
    const r = this.waiting.get(id);
    if (!r) return;
    this.waiting.delete(id);
    r(allow);
  }
  cancelAll(): void {
    for (const r of this.waiting.values()) r(false);
    this.waiting.clear();
  }
}

export interface ExecuteOptions {
  turn: { turnId: string; conversationId: string; text: string; resumeSessionId?: string | null };
  workspace: string;
  mcpServer: ReturnType<typeof createKayaMcpServer>;
  send: (m: RunnerToCloud) => void;
  permissions: PermissionBroker;
  runAgent?: typeof runAgentTurn;
}

export function executeTurn(opts: ExecuteOptions): { done: Promise<void>; abort(): void } {
  const abort = new AbortController();
  const { turnId } = opts.turn;
  const run = opts.runAgent ?? runAgentTurn;

  const done = (async () => {
    const events: AsyncGenerator<AgentEvent> = run({
      prompt: opts.turn.text,
      resumeSessionId: opts.turn.resumeSessionId ?? null,
      ask: (q, d) => opts.permissions.ask(q, d),
      signal: abort.signal,
      workspace: opts.workspace,
      mcpServer: opts.mcpServer,
    });
    for await (const ev of events) {
      if (abort.signal.aborted) break;
      switch (ev.type) {
        case "text_delta":
          opts.send({ type: "text_delta", turnId, text: ev.text });
          break;
        case "tool_start":
          opts.send({ type: "tool_start", turnId, name: ev.name, summary: summarizeTool(ev.name, ev.input) });
          break;
        case "done":
          opts.send({ type: "turn_done", turnId, sessionId: ev.sessionId, costUsd: ev.costUsd, fullText: ev.fullText });
          break;
        case "error":
          opts.send({ type: "turn_error", turnId, message: ev.message });
          break;
        case "status":
          break;
      }
    }
  })().catch((err) => opts.send({ type: "turn_error", turnId, message: err instanceof Error ? err.message : String(err) }));

  return { done, abort: () => { abort.abort(); opts.permissions.cancelAll(); } };
}
```

- [ ] **Step 5: Write `runner/src/client.ts`**

```ts
import WebSocket from "ws";
import { nextBackoffMs } from "./backoff.js";
import type { RunnerConfig } from "./config.js";
import { MemoryBridge } from "./memory-bridge.js";
import { parseCloudMessage, type RunnerToCloud } from "./protocol.js";
import { createKayaMcpServer } from "./agent/tools.js";
import type { runAgentTurn } from "./agent/runner.js";
import { executeTurn, PermissionBroker } from "./turn.js";

export interface WebSocketLike {
  send(d: string): void;
  close(): void;
  on(event: "open" | "message" | "close" | "error", cb: (...a: any[]) => void): void;
}

export interface ClientDeps {
  makeSocket?: (url: string, headers: Record<string, string>) => WebSocketLike;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  mcpServer?: ReturnType<typeof createKayaMcpServer>;
  runAgent?: typeof runAgentTurn;
}

const defaultMakeSocket = (url: string, headers: Record<string, string>): WebSocketLike => new WebSocket(url, { headers }) as unknown as WebSocketLike;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Keeps one outbound socket to the cloud and runs at most one agent turn at a time. */
export class RunnerClient {
  readonly bridge: MemoryBridge;
  private readonly mcpServer: ReturnType<typeof createKayaMcpServer>;
  private readonly permissions: PermissionBroker;
  private socket: WebSocketLike | null = null;
  private current: { turnId: string; abort(): void } | null = null;
  private stopped = false;
  private attempt = 0;

  constructor(private readonly cfg: RunnerConfig, private readonly deps: ClientDeps = {}) {
    this.bridge = new MemoryBridge((m) => this.send(m), () => this.current?.turnId ?? "");
    this.mcpServer = deps.mcpServer ?? createKayaMcpServer(this.bridge);
    this.permissions = new PermissionBroker((m) => this.send(m), () => this.current?.turnId ?? "");
  }

  currentTurnId(): string | null {
    return this.current?.turnId ?? null;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.current?.abort();
    this.socket?.close();
  }

  private url(): string {
    return this.cfg.cloudUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/runner";
  }

  private connect(): void {
    const log = this.deps.log ?? console.log;
    const s = (this.deps.makeSocket ?? defaultMakeSocket)(this.url(), { Authorization: `Bearer ${this.cfg.token}` });
    this.socket = s;
    s.on("open", () => { this.attempt = 0; log(`connected to ${this.url()}`); });
    s.on("message", (data: unknown) => this.handle(String(data)));
    s.on("error", (err: unknown) => log(`socket error: ${err instanceof Error ? err.message : String(err)}`));
    s.on("close", () => {
      this.current?.abort();
      this.current = null;
      if (this.stopped) return;
      const wait = nextBackoffMs(this.attempt++);
      log(`disconnected, retrying in ${wait / 1000}s`);
      void (this.deps.sleep ?? defaultSleep)(wait).then(() => { if (!this.stopped) this.connect(); });
    });
  }

  private send(m: RunnerToCloud): void {
    this.socket?.send(JSON.stringify(m));
  }

  handle(raw: string): void {
    const msg = parseCloudMessage(raw);
    if (!msg) return;
    switch (msg.type) {
      case "turn_start": {
        this.current?.abort();
        const t = executeTurn({
          turn: msg,
          workspace: this.cfg.workspace,
          mcpServer: this.mcpServer,
          send: (m) => this.send(m),
          permissions: this.permissions,
          runAgent: this.deps.runAgent,
        });
        this.current = { turnId: msg.turnId, abort: t.abort };
        void t.done.finally(() => { if (this.current?.turnId === msg.turnId) this.current = null; });
        return;
      }
      case "cancel":
        if (this.current?.turnId === msg.turnId) { this.current.abort(); this.current = null; }
        return;
      case "permission_response":
        return this.permissions.answer(msg.id, msg.allow);
      case "memory_result":
        return this.bridge.resolve(msg.callId, msg.result);
    }
  }
}
```

- [ ] **Step 6: Write `runner/src/pair.ts` and `runner/src/cli.ts`**

```ts
// runner/src/pair.ts
/** Device-code pairing: prints a code, waits for the member to confirm it, returns the runner token. */
export async function pair(
  cloudUrl: string,
  name: string,
  workspace: string,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string> {
  const base = cloudUrl.replace(/\/$/, "");
  const start = await fetchImpl(`${base}/api/pair/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, workspace }),
  });
  if (!start.ok) throw new Error(`pairing start failed: ${start.status}`);
  const { code, publicId, verifyUrl } = (await start.json()) as { code: string; publicId: string; verifyUrl: string };
  console.log(`\nPair this runner: open ${verifyUrl}\nCode: ${code}\nWaiting for confirmation (10 minutes)...`);
  for (;;) {
    await sleep(2000);
    const res = await fetchImpl(`${base}/api/pair/poll?publicId=${encodeURIComponent(publicId)}`);
    const body = (await res.json()) as { status: string; token?: string };
    if (body.status === "paired" && body.token) return body.token;
    if (body.status === "expired") throw new Error("pairing code expired, start again");
  }
}
```

```ts
// runner/src/cli.ts
#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { createInterface } from "node:readline/promises";
import { RunnerClient } from "./client.js";
import { configPath, readConfig, writeConfig } from "./config.js";
import { pair } from "./pair.js";

const ask = async (q: string) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(q)).trim();
  rl.close();
  return a;
};

const path = configPath();
let cfg = await readConfig(path);

if (!cfg) {
  const cloudUrl = process.env.KAYA_CLOUD_URL ?? (await ask("Kaya cloud URL (e.g. https://kaya.example): "));
  const workspace = await ask("Folder Kaya may work in (absolute path): ");
  if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
    console.error(`Not a directory: ${workspace}`);
    process.exit(1);
  }
  const token = await pair(cloudUrl, hostname(), workspace);
  cfg = { cloudUrl, token, workspace };
  await writeConfig(path, cfg);
  console.log(`Paired. Config saved to ${path}`);
}

if (!existsSync(cfg.workspace) || !statSync(cfg.workspace).isDirectory()) {
  console.error(`Workspace is not a directory: ${cfg.workspace}. Edit ${path} or delete it to pair again.`);
  process.exit(1);
}

console.log(`Workspace: ${cfg.workspace}`);
console.log(`Claude credential: ${process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY from environment" : "this machine's claude login"}`);

const client = new RunnerClient(cfg);
client.start();
process.on("SIGINT", () => { client.stop(); process.exit(0); });
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test -w runner 2>&1 | grep -E "passed|failed"; npm run typecheck -w runner 2>&1 | grep "error TS"`
Expected: all pass, typecheck clean. If `@types/ws` typing of `new WebSocket(url, { headers })` complains, keep the `as unknown as WebSocketLike` cast.

- [ ] **Step 8: Commit**

```bash
git add runner/src
git commit -m "Add the runner client, turn execution, pairing and CLI"
```

---

### Task 14: Web app — sign-in, cookie sockets, runner banner

**Files:**
- Modify: `web/src/App.tsx`, `web/src/useKaya.ts`, `web/src/styles.css`, `web/vite.config.ts` (proxy `/auth`, `/pair`, `/runner`)
- Test: `web/src/transcript.test.ts` (unchanged), `web/src/runner-banner.test.ts`

**Interfaces:**
- `useKaya()` no longer takes a token. It opens `/ws` with no query string (cookie rides along). New state `runner: { online: boolean; name?: string }` from `runner_status`. `error` set to `"Signed out"` on close code 4401.
- `App`: on mount `GET /api/me`; 401 → `SignIn` view with a "Sign in with GitHub" link to `/auth/github`; otherwise `Console`. `Console` shows a banner when `runner.online` is false: "No runner connected. Run `npx kaya-runner` on your machine." with a link to `/pair`. Sign out posts to `/auth/logout` then reloads.
- Pure helper `runnerBannerText(r: { online: boolean; name?: string }): string | null` in `web/src/runner-banner.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/runner-banner.test.ts
import { describe, expect, it } from "vitest";
import { runnerBannerText } from "./runner-banner";

describe("runnerBannerText", () => {
  it("is null when a runner is online", () => {
    expect(runnerBannerText({ online: true, name: "mac" })).toBeNull();
  });
  it("tells the member how to start a runner when offline", () => {
    expect(runnerBannerText({ online: false })).toBe("No runner connected. Run npx kaya-runner on your machine.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web 2>&1 | grep -E "FAIL|Cannot find"`
Expected: FAIL, cannot find `./runner-banner`

- [ ] **Step 3: Write the helper and rewire the hook**

```ts
// web/src/runner-banner.ts
export function runnerBannerText(r: { online: boolean; name?: string }): string | null {
  return r.online ? null : "No runner connected. Run npx kaya-runner on your machine.";
}
```

In `web/src/useKaya.ts`:
- Signature `export function useKaya()`; remove the `token` parameter and the `if (!token) return;` guard; the effect depends on `[]`.
- Socket URL: `` `${proto}://${location.host}/ws` ``.
- Add `const [runner, setRunner] = useState<{ online: boolean; name?: string }>({ online: false });`
- In `onmessage`, add `case "runner_status": setRunner({ online: msg.online, name: msg.name }); break;`
- In `onclose`: `if (e.code === 4401) setError("Signed out. Reload to sign in again.");`
- Return `runner` alongside the existing fields.

In `web/src/App.tsx`:
- Replace `TokenGate` with:

```tsx
function SignIn() {
  return (
    <main className="gate">
      <img className="logo" src="/kaya.png" alt="" width={96} height={96} />
      <h1>Kaya</h1>
      <p>Voice-first dev assistant for the team. Invite only.</p>
      <a className="primary button" href="/auth/github">Sign in with GitHub</a>
    </main>
  );
}
```

- `App` becomes:

```tsx
export function App() {
  const [me, setMe] = useState<null | undefined | { login: string }>(undefined);
  useEffect(() => {
    fetch("/api/me").then(async (r) => setMe(r.ok ? await r.json() : null)).catch(() => setMe(null));
  }, []);
  if (me === undefined) return null;
  if (me === null) return <SignIn />;
  return <Console onSignOut={async () => { await fetch("/auth/logout", { method: "POST" }); location.reload(); }} />;
}
```

- `Console` drops the `token` prop, calls `useKaya()`, fetches `/api/scribe-token` without an Authorization header, and renders above the transcript:

```tsx
{runnerBannerText(kaya.runner) && (
  <div className="banner runner">{runnerBannerText(kaya.runner)} <a href="/pair">Pair a runner</a></div>
)}
```

- `styles.css`: add `.button{display:inline-block;text-decoration:none;text-align:center}` and `.banner.runner{background:#2b2a1f}`.
- `vite.config.ts` proxy gains `"/auth": "http://localhost:8787"`, `"/pair": "http://localhost:8787"`, `"/runner": { target: "ws://localhost:8787", ws: true }`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w web 2>&1 | grep -E "passed|failed"; npm run typecheck -w web 2>&1 | grep "error TS"`
Expected: pass, clean

- [ ] **Step 5: Commit**

```bash
git add web/src web/vite.config.ts
git commit -m "Sign in with GitHub, cookie-authenticated socket, runner banner"
```

---

### Task 15: Local end-to-end run (rollout step 1)

**Files:**
- Modify: `.claude/sessions/RULES.md` (dev recipe), `README.md`

No production code. This task proves the split works on one machine before anything is deployed.

- [ ] **Step 1: Tell the user what to set in `.env`** (never edit it): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` from a GitHub OAuth app whose callback is `http://localhost:5173/auth/github/callback`; `COOKIE_SECRET` from `openssl rand -hex 32`; `PUBLIC_URL=http://localhost:5173`. Remove `KAYA_TOKEN`, `KAYA_WORKSPACE`, `ANTHROPIC_API_KEY` (harmless if left).

- [ ] **Step 2: Migrate and create the first invite**

```bash
cd server && npm run db:migrate 2>&1 | tail -1 && npm run invite -- --admin
```

- [ ] **Step 3: Start the cloud and web** in a background shell (not through a launch.json `port` entry): `npm run dev`. Then attach the browser pane with the `attach` config.

- [ ] **Step 4: Sign in** at `http://localhost:5173`, click "Sign in with GitHub", paste the invite code. Expect the console with the "No runner connected" banner.

- [ ] **Step 5: Start the runner** in another background shell: `KAYA_CLOUD_URL=http://localhost:5173 npm run dev:runner`. Enter the workspace `/Volumes/Developer/Projects/Personal`. Open the printed pair URL in the pane, confirm. Expect the runner log line `connected to ws://localhost:5173/runner` and the banner to disappear.

- [ ] **Step 6: Prove audio**: type "Say hello in one short sentence." Expect echo, assistant line, one binary frame, `speak_end`. Then "Remember that my favorite editor is Zed." followed by "What is my favorite editor?" to prove memory over the bridge. Then "Delete the folder /tmp/never-there with rm -rf" to prove the permission prompt round-trips (answer No).

- [ ] **Step 7: Update docs**: README "Local development" section describes the three processes and the invite step; `.claude/sessions/RULES.md` gets the runner start line. Commit:

```bash
git add README.md .claude/sessions/RULES.md
git commit -m "Document the local cloud plus runner development loop"
```

---

### Task 16: Docker, Caddy and the VPS deploy guide (rollout step 2)

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.dockerignore`, `docs/deploy/vps.md`, `docs/qa/2026-09-22-cloud-runner-e2e.md`
- Modify: `server/package.json` (`start` runs migrations first), `README.md`, `TODO.md`

- [ ] **Step 1: Dockerfile**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY runner/package.json runner/
RUN npm ci --workspace server --workspace web --include-workspace-root
COPY server server
COPY web web
RUN npm run build -w web && npm run build -w server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/server/package.json server/
RUN npm ci --workspace server --omit=dev --include-workspace-root
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/drizzle server/drizzle
COPY --from=build /app/server/drizzle.config.ts server/
COPY --from=build /app/web/dist web/dist
WORKDIR /app/server
EXPOSE 8787
CMD ["npm", "start"]
```

`server/package.json` `start` becomes `"start": "drizzle-kit migrate && node dist/index.js"` and `drizzle-kit` moves from devDependencies to dependencies so the migration can run in the production image.

`.dockerignore`: `node_modules`, `**/node_modules`, `**/dist`, `.env*`, `.git`, `.claude/worktrees`, `web/dev-dist`.

- [ ] **Step 2: Compose and Caddy**

```yaml
# docker-compose.yml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      PORT: "8787"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    expose: ["8787"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8787/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    environment:
      DOMAIN: ${DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [app]

volumes:
  caddy_data:
  caddy_config:
```

```
# Caddyfile
{$DOMAIN} {
	encode zstd gzip
	reverse_proxy app:8787
}
```

Caddy proxies WebSockets without extra config. `.env.example` gains `DOMAIN=kaya.example.com` under a `# --- Deployment` heading, and the `DATABASE_URL` comment notes `host.docker.internal` for the VPS.

- [ ] **Step 3: Deploy guide `docs/deploy/vps.md`**

Sections, each with the exact commands:
1. **Postgres on the host**: `sudo -u postgres psql -c "CREATE ROLE kaya LOGIN PASSWORD '...';" -c "CREATE DATABASE kaya OWNER kaya;"`, then `psql -U kaya -d kaya -c "CREATE EXTENSION IF NOT EXISTS vector;"`. Allow the Docker bridge: in `postgresql.conf` set `listen_addresses = 'localhost,172.17.0.1'`; in `pg_hba.conf` add `host kaya kaya 172.16.0.0/12 scram-sha-256`; `sudo systemctl reload postgresql`. If `CREATE EXTENSION vector` fails, install `postgresql-17-pgvector` from the PGDG apt repo.
2. **GitHub OAuth app**: callback `https://<DOMAIN>/auth/github/callback`.
3. **`.env` on the VPS**: the keys from `.env.example` with `PUBLIC_URL=https://<DOMAIN>`, `DATABASE_URL=postgres://kaya:<pw>@host.docker.internal:5432/kaya`, `DOMAIN=<DOMAIN>`.
4. **First deploy**: `git clone git@github.com:msforbes09/kaya.git && cd kaya && docker compose up -d --build`, then `docker compose exec app npm run invite -- --admin`.
5. **Updates**: `git pull && docker compose up -d --build`.
6. **Backups**: `0 3 * * * pg_dump -U kaya kaya | gzip > /var/backups/kaya/$(date +\%F).sql.gz` in the host crontab.
7. **Health**: `https://<DOMAIN>/api/health` for an uptime pinger; `docker compose logs -f app`.
8. **Runner on each machine**: `KAYA_CLOUD_URL=https://<DOMAIN> npx kaya-runner` (after the package is published, or `npm run dev:runner` from a checkout until then).

- [ ] **Step 4: QA script `docs/qa/2026-09-22-cloud-runner-e2e.md`**: a checklist mirroring Task 15 steps 4–6 but against the VPS from an iPhone: sign in, invite, pair from the phone, mic turn over HTTPS, permission prompt, audio, and a runner restart mid-conversation to confirm the banner flips and the next turn works.

- [ ] **Step 5: Build the image locally to prove the Dockerfile**

Run: `docker build -t kaya-test . 2>&1 | tail -3`
Expected: `naming to docker.io/library/kaya-test`. Then `docker rmi kaya-test` is the user's call (the dev hook blocks `docker rmi`); leave the image.

- [ ] **Step 6: Update README and TODO**

README: replace the "Production" section with a pointer to `docs/deploy/vps.md` and the three-process description. TODO: remove the resolved token-in-URL item; add "publish `kaya-runner` to npm", "multiple runners per member", "hosted GitHub sandbox runner", "phone auto-reconnect", "mic pause while speaking", "model choice in runner".

- [ ] **Step 7: Commit and open the PR**

```bash
git add Dockerfile docker-compose.yml Caddyfile .dockerignore docs/deploy/vps.md docs/qa/2026-09-22-cloud-runner-e2e.md server/package.json package-lock.json .env.example README.md TODO.md
git commit -m "Add Docker, Caddy and the VPS deploy guide"
git push -u origin feature/cloud-runner
gh pr create --base develop --head feature/cloud-runner --title "Cloud relay and local runner" --body-file docs/superpowers/specs/2026-09-22-cloud-runner-design.md
```

Then stop. The user merges. Note in the PR body that PR #1 must merge first (this branch contains its commits).

---

## Self-review

**Spec coverage.** Architecture and both protocols: Tasks 1, 6, 7. Accounts, invites, cookie, pairing: Tasks 2, 3, 4, 8, 9. Data model: Task 5. Runner: Tasks 11, 12, 13. Cloud changes (config, cookie sockets, no URL logging, hub delegation, memory served per member): Tasks 5, 7, 10. Deployment: Task 16. Testing seams: each task; manual QA: Task 16. Rollout steps 1 and 2: Tasks 15 and 16; step 3 is the user inviting the team. The "runner_status" phone message: Tasks 7 and 14. Persona line about not adopting transcript names: Task 12.

**Placeholders.** None: every code step has full code. The one conditional (async `upgradeWebSocket` callback) states both variants.

**Type consistency.** `RunnerHub.startTurn` returns `{ turnId, cancel, answerPermission } | null` and `Session` uses exactly that. `MemoryService.remember/recall(memberId, args)` matches `index.ts`. `runAgentTurn` gains `workspace` and `mcpServer`, and `executeTurn` passes both. `RunnerLink` is `{ send, close }` in hub, socket and tests. `parseCloudMessage`/`parseRunnerMessage` names match across Tasks 1, 6, 13. `configSchema` no longer has `KAYA_WORKSPACE`, and nothing after Task 5 references it.

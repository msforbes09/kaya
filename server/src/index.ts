import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { getCookie } from "hono/cookie";
import { config, isProd } from "./config.js";
import { SESSION_COOKIE } from "./auth/cookie.js";
import { authorizeSession } from "./auth/session.js";
import { memberIdFromCookieHeader, requireMember } from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { pairingRoutes } from "./routes/pairing.js";
import { createScribeToken } from "./voice/tts.js";
import { RunnerHub } from "./ws/runner-hub.js";
import { runnerSocket } from "./ws/runner-socket.js";
import { Session } from "./ws/session.js";
import { escapeHtml } from "./html.js";
import { memoryServiceFor } from "./memory-service.js";
import * as repo from "./db/repo.js";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Method + path + status only. Never the query string: it must not leak tokens or codes.
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`);
});

const hub = new RunnerHub(memoryServiceFor({ remember: repo.remember, recall: repo.recall, forget: repo.forgetMemories }));

// A rejected promise anywhere must not take the cloud down: every member's
// runner and phone socket live in this one process.
process.on("unhandledRejection", (err) => console.error("unhandled rejection:", err));

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", authRoutes({ config: { ...config, isProd } }));
app.route("/", pairingRoutes({ secret: config.COOKIE_SECRET, publicUrl: config.PUBLIC_URL }));

// The browser talks to ElevenLabs Scribe directly with a single-use token.
app.get("/api/scribe-token", requireMember, async (c) => c.json(await createScribeToken()));

app.get("/api/runner", requireMember, (c) => c.json(hub.status(c.get("memberId"))));

app.get("/pair", async (c) => {
  const member = await authorizeSession(getCookie(c, SESSION_COOKIE), config.COOKIE_SECRET);
  if (!member) return c.redirect("/auth/github");
  const code = c.req.query("code") ?? "";
  return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair runner</title>
<style>body{font:16px system-ui;background:#141A26;color:#e6e9f0;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:360px;padding:24px}input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin-top:8px;border-radius:10px;border:1px solid #334}button{background:#e6e9f0;color:#141A26}</style>
<main><h1>Pair a runner</h1><p>Enter the code shown by kaya-runner.</p><input id="code" value="${escapeHtml(code.replace(/[^0-9]/g, ""))}" inputmode="numeric" maxlength="6"><p id="who"></p><button id="go">Confirm</button><p id="out"></p>
<script>const el=id=>document.getElementById(id);
// textContent, never innerHTML: the runner names itself.
(async()=>{const c=el('code').value;if(c.length!==6)return;const r=await fetch('/api/pair/describe?code='+encodeURIComponent(c));if(!r.ok)return;const d=await r.json();el('who').textContent='Pairing runner: '+d.name;})();
el('go').onclick=async()=>{const r=await fetch('/api/pair/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:el('code').value})});el('out').textContent=r.ok?'Paired. You can close this page.':'Code not valid: '+r.status;};</script></main>`);
});

app.get(
  "/ws",
  upgradeWebSocket(async (c) => {
    const memberId = await memberIdFromCookieHeader(c.req.header("cookie"), config.COOKIE_SECRET);
    if (!memberId)
      return {
        onOpen(_evt, ws) {
          ws.close(4401, "unauthorized");
        },
      };
    let session: Session | null = null;
    return {
      onOpen(_evt, ws) {
        session = new Session(ws, memberId, hub);
      },
      onMessage(evt) {
        if (typeof evt.data === "string") void session?.handle(evt.data);
      },
      onClose() {
        session?.close();
        session = null;
      },
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

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { logger } from "hono/logger";
import { config, isProd } from "./config.js";
import { requireToken, wsTokenValid } from "./auth.js";
import { createScribeToken } from "./voice/tts.js";
import { Session } from "./ws/session.js";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("*", logger());

app.get("/api/health", (c) => c.json({ ok: true }));

// The browser talks to ElevenLabs Scribe directly with a 15-minute single-use token.
app.get("/api/scribe-token", requireToken, async (c) => c.json(await createScribeToken()));

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    const url = new URL(c.req.url);
    if (!wsTokenValid(url)) {
      return {
        onOpen(_evt, ws) {
          ws.close(4401, "unauthorized");
        },
      };
    }
    let session: Session | null = null;
    return {
      onOpen(_evt, ws) {
        session = new Session(ws);
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

// In production the server hosts the built PWA so there is one origin, one TLS cert.
if (isProd) {
  app.use("/*", serveStatic({ root: "../web/dist" }));
  app.get("*", serveStatic({ root: "../web/dist", path: "index.html" }));
}

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`Kaya listening on http://localhost:${info.port}`);
});
injectWebSocket(server);

import type { UpgradeWebSocket } from "hono/ws";
import { hashRunnerToken } from "../auth/pairing.js";
import * as repo from "../db/repo.js";
import type { RunnerHub, RunnerLink } from "./runner-hub.js";

/** Never log message contents: they carry the member's conversation. */
const logFailure = (err: unknown) => console.error("runner socket:", err);

/** `GET /runner`: authenticates a runner by bearer token and attaches it to the hub. */
export function runnerSocket(hub: RunnerHub, upgradeWebSocket: UpgradeWebSocket) {
  return upgradeWebSocket(async (c) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const runner = token ? await repo.findRunnerByTokenHash(hashRunnerToken(token)) : undefined;
    if (!runner) {
      return {
        onOpen(_evt, ws) {
          ws.close(4401, "unauthorized");
        },
      };
    }
    let link: RunnerLink | null = null;
    return {
      onOpen(_evt, ws) {
        link = { send: (d) => ws.send(d), close: (code, reason) => ws.close(code, reason) };
        hub.attach(runner.memberId, runner.id, runner.name, link);
        void repo.touchRunner(runner.id).catch(logFailure);
      },
      onMessage(evt) {
        if (typeof evt.data === "string") void hub.handleMessage(runner.memberId, evt.data).catch(logFailure);
      },
      onClose() {
        if (link) hub.detach(runner.memberId, link);
      },
    };
  });
}

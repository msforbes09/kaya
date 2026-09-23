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
      this.socket = null;
      this.bridge.rejectAll("runner disconnected");
      this.current?.abort();
      this.current = null;
      if (this.stopped) return;
      const wait = nextBackoffMs(this.attempt++);
      log(`disconnected, retrying in ${wait / 1000}s`);
      void (this.deps.sleep ?? defaultSleep)(wait).then(() => { if (!this.stopped) this.connect(); });
    });
  }

  private send(m: RunnerToCloud): void {
    if (!this.socket) return;
    try {
      this.socket.send(JSON.stringify(m));
    } catch (err) {
      const log = this.deps.log ?? console.log;
      log(`send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
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

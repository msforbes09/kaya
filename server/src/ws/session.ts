import { randomUUID } from "node:crypto";
import type { WSContext } from "hono/ws";
import { runAgentTurn } from "../agent/runner.js";
import { SentenceChunker } from "../voice/chunker.js";
import { ElevenLabsSpeaker, type Speaker } from "../voice/tts.js";
import { encodeAudioFrame, type ClientMessage, type ServerMessage } from "./protocol.js";
import * as repo from "../db/repo.js";

/**
 * One WebSocket connection = one live session with Kaya.
 * Responsibilities: route user text into the agent, stream text back,
 * run TTS per sentence, and broker permission prompts.
 */
export class Session {
  private conversationId: string | null = null;
  private agentSessionId: string | null = null;
  private current: AbortController | null = null;
  private pendingPermissions = new Map<string, (allow: boolean) => void>();
  private readonly speaker: Speaker = new ElevenLabsSpeaker();

  constructor(private readonly ws: WSContext) {}

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

    switch (msg.type) {
      case "hello":
        return this.hello(msg.conversationId);
      case "user_text":
        return this.userText(msg.text);
      case "permission_response":
        return this.pendingPermissions.get(msg.id)?.(msg.allow);
      case "cancel":
        this.current?.abort();
        return;
    }
  }

  private async hello(existingId?: string) {
    const existing = existingId ? await repo.getConversation(existingId) : null;
    const conv = existing ?? (await repo.createConversation());
    this.conversationId = conv.id;
    this.agentSessionId = conv.agentSessionId ?? null;
    this.send({ type: "ready", conversationId: conv.id });
  }

  private async userText(text: string) {
    if (!this.conversationId) await this.hello();
    const conversationId = this.conversationId!;
    const clean = text.trim();
    if (!clean) return;

    // Interrupting: a new utterance cancels whatever Kaya was saying.
    this.current?.abort();
    const abort = new AbortController();
    this.current = abort;

    this.send({ type: "user_echo", text: clean });
    await repo.addMessage(conversationId, "user", clean);

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

    const ask = (question: string, detail: string) =>
      new Promise<boolean>((resolve) => {
        const id = randomUUID();
        this.pendingPermissions.set(id, (allow) => {
          this.pendingPermissions.delete(id);
          resolve(allow);
        });
        this.send({ type: "permission_request", id, question, detail });
        speakSentence(question);
      });

    for await (const ev of runAgentTurn({ prompt: clean, resumeSessionId: this.agentSessionId, ask, signal: abort.signal })) {
      if (abort.signal.aborted) break;
      switch (ev.type) {
        case "text_delta":
          this.send({ type: "assistant_delta", text: ev.text });
          for (const s of chunker.push(ev.text)) speakSentence(s);
          break;
        case "tool_start": {
          const summary = summarizeTool(ev.name, ev.input);
          this.send({ type: "tool", name: ev.name, summary });
          await repo.addMessage(conversationId, "tool", summary, { name: ev.name });
          break;
        }
        case "status":
          this.send({ type: "status", text: ev.text });
          break;
        case "error":
          this.send({ type: "error", message: ev.message });
          break;
        case "done": {
          const tail = chunker.flush();
          if (tail) speakSentence(tail);
          if (ev.sessionId && ev.sessionId !== this.agentSessionId) {
            this.agentSessionId = ev.sessionId;
            await repo.setAgentSession(conversationId, ev.sessionId);
          }
          await repo.addMessage(conversationId, "assistant", ev.fullText, { costUsd: ev.costUsd });
          this.send({ type: "assistant_done", text: ev.fullText, costUsd: ev.costUsd });
          break;
        }
      }
    }

    await Promise.allSettled(ttsQueue);
    if (!abort.signal.aborted) this.send({ type: "speak_end" });
    if (this.current === abort) this.current = null;
  }

  close() {
    this.current?.abort();
    for (const resolve of this.pendingPermissions.values()) resolve(false);
    this.pendingPermissions.clear();
  }
}

function summarizeTool(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "Bash":
      return `Running: ${String(i.command ?? "").slice(0, 120)}`;
    case "Read":
      return `Reading ${i.file_path ?? ""}`;
    case "Edit":
    case "Write":
    case "MultiEdit":
      return `Editing ${i.file_path ?? ""}`;
    case "Grep":
      return `Searching for "${i.pattern ?? ""}"`;
    case "Glob":
      return `Listing ${i.pattern ?? ""}`;
    case "mcp__kaya__remember":
      return `Remembering: ${i.subject ?? ""}`;
    case "mcp__kaya__recall":
      return `Recalling "${i.query ?? ""}"`;
    default:
      return name;
  }
}

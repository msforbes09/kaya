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
    let resolveFinish: () => void;
    const finish = new Promise<void>((resolve) => {
      resolveFinish = resolve;
    });

    const handle = this.hub.startTurn(
      this.memberId,
      { conversationId: conv.id, text: clean, resumeSessionId },
      {
        onDelta: (t) => {
          if (abort.signal.aborted) return;
          this.send({ type: "assistant_delta", text: t });
          for (const s of chunker.push(t)) speakSentence(s);
        },
        onTool: (name, summary) => {
          if (abort.signal.aborted) return;
          this.send({ type: "tool", name, summary });
          void repo.addMessage(conv.id, "tool", summary, { name });
        },
        onPermission: (id, question, detail) => {
          if (abort.signal.aborted) return;
          this.send({ type: "permission_request", id, question, detail });
          speakSentence(question);
        },
        onDone: async ({ sessionId, costUsd, fullText }) => {
          if (abort.signal.aborted) return;
          try {
            const tail = chunker.flush();
            if (tail) speakSentence(tail);
            if (sessionId && status.runnerId) {
              conv.agentSessionId = sessionId;
              conv.runnerId = status.runnerId;
              await repo.setAgentSession(conv.id, sessionId, status.runnerId);
            }
            await repo.addMessage(conv.id, "assistant", fullText, { costUsd });
            this.send({ type: "assistant_done", text: fullText, costUsd });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("session error handling turn_done:", err);
            this.send({ type: "error", message });
          } finally {
            resolveFinish();
          }
        },
        onError: (message) => {
          if (abort.signal.aborted) return;
          this.send({ type: "error", message });
          resolveFinish();
        },
      },
    );

    // Turn traffic streams back asynchronously via hub.handleMessage, driven
    // by the runner's own messages over time. Don't block the phone socket's
    // message loop on that: return once the turn is under way so cancel/
    // permission_response for THIS turn can still be handled while it runs.
    // Drain any queued TTS and close out the turn in the background instead.
    if (!handle) {
      this.send({ type: "status", text: NO_RUNNER });
      await Promise.allSettled(ttsQueue);
      this.send({ type: "speak_end" });
      return;
    }
    this.turn = { ...handle, abort };

    void finish.then(async () => {
      await Promise.allSettled(ttsQueue);
      if (!abort.signal.aborted) this.send({ type: "speak_end" });
      if (this.turn?.abort === abort) this.turn = null;
    });
  }

  close() {
    this.cancelTurn();
    this.unsubscribeStatus?.();
  }
}

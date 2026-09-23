import { useCallback, useEffect, useRef, useState } from "react";
import { AudioQueue } from "./audio";
import { reconnectDelayMs, shouldReconnect } from "./reconnect";
import { applyTranscript, emptyTranscript, type Line } from "./transcript";

export type { Line };

export interface PermissionPrompt {
  id: string;
  question: string;
  detail: string;
}

export type Status = "offline" | "connecting" | "idle" | "thinking" | "speaking";

export function useKaya() {
  const [status, setStatus] = useState<Status>("offline");
  const [transcript, setTranscript] = useState(emptyTranscript);
  const [permission, setPermission] = useState<PermissionPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runner, setRunner] = useState<{ online: boolean; name?: string }>({ online: false });
  const ws = useRef<WebSocket | null>(null);
  const audio = useRef(new AudioQueue());

  useEffect(() => {
    let deliberate = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    audio.current.onStateChange = (speaking) => setStatus((s) => (speaking ? "speaking" : s === "speaking" ? "idle" : s));

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${proto}://${location.host}/ws`);
      socket.binaryType = "arraybuffer";
      ws.current = socket;
      setStatus("connecting");

      socket.onopen = () => {
        attempt = 0;
        const conversationId = localStorage.getItem("kaya:conversation") ?? undefined;
        socket.send(JSON.stringify({ type: "hello", conversationId }));
      };
      socket.onclose = (e) => {
        setStatus("offline");
        if (e.code === 4401) setError("Signed out. Reload to sign in again.");
        // Phones drop sockets whenever the screen locks. Come back on our own.
        if (shouldReconnect({ code: e.code, deliberate })) timer = setTimeout(connect, reconnectDelayMs(attempt++));
      };
      socket.onmessage = (evt) => {
        if (evt.data instanceof ArrayBuffer) {
          const view = new DataView(evt.data);
          const seq = view.getUint32(0);
          audio.current.push(seq, new Blob([evt.data.slice(4)], { type: "audio/mpeg" }));
          return;
        }
        const msg = JSON.parse(evt.data);
        switch (msg.type) {
          case "ready":
            localStorage.setItem("kaya:conversation", msg.conversationId);
            setStatus("idle");
            setError(null);
            break;
          case "user_echo":
          case "assistant_delta":
          case "assistant_done":
          case "tool":
            setTranscript((t) => applyTranscript(t, msg));
            if (msg.type === "user_echo") setStatus("thinking");
            if (msg.type === "assistant_done") setStatus((s) => (s === "speaking" ? s : "idle"));
            break;
          case "permission_request":
            setPermission({ id: msg.id, question: msg.question, detail: msg.detail });
            break;
          case "runner_status":
            setRunner({ online: msg.online, name: msg.name });
            break;
          case "speak_end":
            break;
          case "error":
            setError(msg.message);
            setStatus("idle");
            break;
        }
      };
    };

    connect();
    return () => {
      deliberate = true;
      if (timer) clearTimeout(timer);
      ws.current?.close();
    };
  }, []);

  const say = useCallback((text: string) => {
    audio.current.reset();
    ws.current?.send(JSON.stringify({ type: "user_text", text }));
  }, []);

  const answerPermission = useCallback((id: string, allow: boolean) => {
    ws.current?.send(JSON.stringify({ type: "permission_response", id, allow }));
    setPermission(null);
  }, []);

  const cancel = useCallback(() => {
    audio.current.reset();
    ws.current?.send(JSON.stringify({ type: "cancel" }));
    setStatus("idle");
  }, []);

  const newConversation = useCallback(() => {
    localStorage.removeItem("kaya:conversation");
    setTranscript(emptyTranscript);
    ws.current?.send(JSON.stringify({ type: "hello" }));
  }, []);

  const unlockAudio = useCallback(() => audio.current.unlock(), []);

  const lines = transcript.lines;
  return { status, lines, permission, error, runner, say, answerPermission, cancel, newConversation, unlockAudio };
}

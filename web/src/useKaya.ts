import { useCallback, useEffect, useRef, useState } from "react";
import { AudioQueue } from "./audio";

export type Line =
  | { id: number; who: "you" | "kaya"; text: string; live?: boolean }
  | { id: number; who: "tool"; text: string };

export interface PermissionPrompt {
  id: string;
  question: string;
  detail: string;
}

export type Status = "offline" | "connecting" | "idle" | "thinking" | "speaking";

let nextId = 1;

export function useKaya(token: string | null) {
  const [status, setStatus] = useState<Status>("offline");
  const [lines, setLines] = useState<Line[]>([]);
  const [permission, setPermission] = useState<PermissionPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const audio = useRef(new AudioQueue());
  const liveId = useRef<number | null>(null);

  useEffect(() => {
    if (!token) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    socket.binaryType = "arraybuffer";
    ws.current = socket;
    setStatus("connecting");

    audio.current.onStateChange = (speaking) => setStatus((s) => (speaking ? "speaking" : s === "speaking" ? "idle" : s));

    socket.onopen = () => {
      const conversationId = localStorage.getItem("kaya:conversation") ?? undefined;
      socket.send(JSON.stringify({ type: "hello", conversationId }));
    };
    socket.onclose = (e) => {
      setStatus("offline");
      if (e.code === 4401) setError("Token rejected. Check it in settings.");
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
          liveId.current = null;
          setLines((l) => [...l, { id: nextId++, who: "you", text: msg.text }]);
          setStatus("thinking");
          break;
        case "assistant_delta":
          setLines((l) => {
            if (liveId.current === null) {
              liveId.current = nextId++;
              return [...l, { id: liveId.current, who: "kaya", text: msg.text, live: true }];
            }
            return l.map((x) => (x.id === liveId.current && x.who === "kaya" ? { ...x, text: x.text + msg.text } : x));
          });
          break;
        case "assistant_done":
          setLines((l) => l.map((x) => (x.id === liveId.current && x.who === "kaya" ? { ...x, text: msg.text, live: false } : x)));
          liveId.current = null;
          setStatus((s) => (s === "speaking" ? s : "idle"));
          break;
        case "tool":
          setLines((l) => [...l, { id: nextId++, who: "tool", text: msg.summary }]);
          break;
        case "permission_request":
          setPermission({ id: msg.id, question: msg.question, detail: msg.detail });
          break;
        case "speak_end":
          break;
        case "error":
          setError(msg.message);
          setStatus("idle");
          break;
      }
    };
    return () => socket.close();
  }, [token]);

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
    setLines([]);
    ws.current?.send(JSON.stringify({ type: "hello" }));
  }, []);

  const unlockAudio = useCallback(() => audio.current.unlock(), []);

  return { status, lines, permission, error, say, answerPermission, cancel, newConversation, unlockAudio };
}

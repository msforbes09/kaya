export type Line = { id: number; who: "you" | "kaya"; text: string; live?: boolean } | { id: number; who: "tool"; text: string };

/** Transcript state. Pure: React StrictMode may run an updater twice. */
export interface TranscriptState {
  lines: Line[];
  liveId: number | null;
  nextId: number;
}

export const emptyTranscript: TranscriptState = { lines: [], liveId: null, nextId: 1 };

type TranscriptMessage =
  | { type: "user_echo"; text: string }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_done"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: string };

export function applyTranscript(s: TranscriptState, msg: TranscriptMessage): TranscriptState {
  switch (msg.type) {
    case "user_echo": {
      const m = msg as { text: string };
      return { lines: [...s.lines, { id: s.nextId, who: "you", text: m.text }], liveId: null, nextId: s.nextId + 1 };
    }
    case "assistant_delta": {
      const m = msg as { text: string };
      if (s.liveId === null) {
        return { lines: [...s.lines, { id: s.nextId, who: "kaya", text: m.text, live: true }], liveId: s.nextId, nextId: s.nextId + 1 };
      }
      return { ...s, lines: s.lines.map((x) => (x.id === s.liveId && x.who === "kaya" ? { ...x, text: x.text + m.text } : x)) };
    }
    case "assistant_done": {
      const m = msg as { text: string };
      if (s.liveId === null) {
        return { lines: [...s.lines, { id: s.nextId, who: "kaya", text: m.text, live: false }], liveId: null, nextId: s.nextId + 1 };
      }
      return {
        ...s,
        liveId: null,
        lines: s.lines.map((x) => (x.id === s.liveId && x.who === "kaya" ? { ...x, text: m.text, live: false } : x)),
      };
    }
    case "tool": {
      const m = msg as { summary: string };
      return { ...s, lines: [...s.lines, { id: s.nextId, who: "tool", text: m.summary }], nextId: s.nextId + 1 };
    }
    default:
      return s;
  }
}

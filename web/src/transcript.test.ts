import { describe, expect, it } from "vitest";
import { applyTranscript, emptyTranscript, type TranscriptState } from "./transcript";

const run = (msgs: Array<Record<string, unknown>>, start: TranscriptState = emptyTranscript) =>
  msgs.reduce((s, m) => applyTranscript(s, m as never), start);

describe("applyTranscript", () => {
  it("renders the assistant reply as one live line that finalizes on done", () => {
    const s = run([
      { type: "user_echo", text: "hi" },
      { type: "assistant_delta", text: "Hel" },
      { type: "assistant_delta", text: "lo." },
      { type: "assistant_done", text: "Hello." },
    ]);
    expect(s.lines.map((l) => [l.who, l.text])).toEqual([
      ["you", "hi"],
      ["kaya", "Hello."],
    ]);
    expect(s.lines[1]).toMatchObject({ live: false });
  });

  it("is pure: applying the same delta twice to the same state gives the same result (StrictMode)", () => {
    const base = run([{ type: "user_echo", text: "hi" }]);
    const once = applyTranscript(base, { type: "assistant_delta", text: "Hel" });
    const twice = applyTranscript(base, { type: "assistant_delta", text: "Hel" });
    expect(twice).toEqual(once);
    expect(once.lines).toHaveLength(2);
  });

  it("appends tool lines and keeps the live assistant line growing after them", () => {
    const s = run([
      { type: "user_echo", text: "hi" },
      { type: "assistant_delta", text: "Checking. " },
      { type: "tool", name: "Read", summary: "Reading a.ts" },
      { type: "assistant_delta", text: "Done." },
    ]);
    expect(s.lines.map((l) => l.who)).toEqual(["you", "kaya", "tool"]);
    expect(s.lines[1].text).toBe("Checking. Done.");
  });
});

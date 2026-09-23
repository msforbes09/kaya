import { useEffect, useRef, useState } from "react";
import { CommitStrategy, useScribe } from "@elevenlabs/react";
import { useKaya } from "./useKaya";
import { runnerBannerText } from "./runner-banner";

export function App() {
  const [me, setMe] = useState<null | undefined | { login: string }>(undefined);
  useEffect(() => {
    fetch("/api/me").then(async (r) => setMe(r.ok ? await r.json() : null)).catch(() => setMe(null));
  }, []);
  if (me === undefined) return null;
  if (me === null) return <SignIn />;
  return <Console onSignOut={async () => { await fetch("/auth/logout", { method: "POST" }); location.reload(); }} />;
}

function SignIn() {
  return (
    <main className="gate">
      <img className="logo" src="/kaya.png" alt="" width={96} height={96} />
      <h1>Kaya</h1>
      <p>Voice-first dev assistant for the team. Invite only.</p>
      <a className="primary button" href="/auth/github">Sign in with GitHub</a>
    </main>
  );
}

function Console({ onSignOut }: { onSignOut: () => void }) {
  const kaya = useKaya();
  const [typed, setTyped] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    languageCode: "en",
    // Commit on silence instead of the SDK default (manual), so a pause ends the utterance.
    commitStrategy: CommitStrategy.VAD,
    vadSilenceThresholdSecs: 1.0,
    onCommittedTranscript: (data) => {
      const text = data.text.trim();
      if (text) kaya.say(text);
    },
    onError: (e: unknown) => setMicError(e instanceof Error ? e.message : "Microphone stream failed"),
  });

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [kaya.lines]);

  const startListening = async () => {
    kaya.unlockAudio();
    setMicError(null);
    try {
      const res = await fetch("/api/scribe-token");
      if (!res.ok) throw new Error("Could not get a transcription token");
      const { token: scribeToken } = await res.json();
      await scribe.connect({
        token: scribeToken,
        microphone: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      setMicError(e instanceof Error ? e.message : String(e));
    }
  };

  const listening = scribe.isConnected;
  const toggleMic = () => (listening ? scribe.disconnect() : startListening());

  const submitTyped = () => {
    const t = typed.trim();
    if (!t) return;
    kaya.say(t);
    setTyped("");
  };

  return (
    <main className="console">
      <header>
        <span className={`dot ${kaya.status}`} />
        <span className="status">{label(kaya.status, listening)}</span>
        <span className="spacer" />
        <button className="ghost" onClick={kaya.newConversation}>New chat</button>
        <button className="ghost" onClick={onSignOut}>Sign out</button>
      </header>

      {runnerBannerText(kaya.runner) && (
        <div className="banner runner">{runnerBannerText(kaya.runner)} <a href="/pair">Pair a runner</a></div>
      )}

      <div className="log" ref={logRef}>
        {kaya.lines.length === 0 && (
          <p className="empty">Tap the ring and start talking. Try: "what repos are in my workspace?"</p>
        )}
        {kaya.lines.map((l) =>
          l.who === "tool" ? (
            <div key={l.id} className="line tool">{l.text}</div>
          ) : (
            <div key={l.id} className={`line ${l.who}${"live" in l && l.live ? " live" : ""}`}>
              <span className="who">{l.who === "you" ? "You" : "Kaya"}</span>
              <p>{l.text}</p>
            </div>
          ),
        )}
        {listening && scribe.partialTranscript && (
          <div className="line you partial"><span className="who">You</span><p>{scribe.partialTranscript}</p></div>
        )}
      </div>

      {(kaya.error || micError) && <div className="banner">{kaya.error ?? micError}</div>}

      {kaya.permission && (
        <div className="permission" role="alertdialog">
          <p className="q">{kaya.permission.question}</p>
          <pre>{kaya.permission.detail}</pre>
          <div className="row">
            <button onClick={() => kaya.answerPermission(kaya.permission!.id, false)}>No</button>
            <button className="primary" onClick={() => kaya.answerPermission(kaya.permission!.id, true)}>Yes, run it</button>
          </div>
        </div>
      )}

      <footer>
        <form className="typed" onSubmit={(e) => { e.preventDefault(); submitTyped(); }}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type…" enterKeyHint="send" />
        </form>
        <button
          className={`ring ${listening ? "listening" : ""} ${kaya.status}`}
          onClick={toggleMic}
          aria-pressed={listening}
          aria-label={listening ? "Stop listening" : "Start listening"}
        >
          <span className="core" />
        </button>
        {kaya.status === "speaking" || kaya.status === "thinking" ? (
          <button className="ghost stop" onClick={kaya.cancel}>Stop</button>
        ) : (
          <span className="stop-placeholder" />
        )}
      </footer>
    </main>
  );
}

function label(status: string, listening: boolean) {
  if (status === "offline") return "Offline";
  if (status === "connecting") return "Connecting";
  if (status === "thinking") return "Thinking";
  if (status === "speaking") return "Speaking";
  return listening ? "Listening" : "Ready";
}

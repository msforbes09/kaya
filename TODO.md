# TODO (deferred work)

- Formatter not chosen yet. Add Prettier or Biome, then wire `.claude/hooks/format-on-save.sh` into `settings.json`.
- Decide whether runtime Kaya should read the target repo's own `.claude/` folder instead of a hard-coded system prompt.
- Embeddings column exists in the schema but is unused in v1.
- Publish `kaya-runner` to npm.
- Multiple runners per member.
- Hosted GitHub sandbox runner.
- Model choice per member from the UI (the runner reads `KAYA_MODEL` or its config file today).
- `repo.upsertRunner` is delete-then-insert outside a transaction; wrap it.
- `RunnerHub.onStatusChange` never prunes empty listener sets.
- Pairing rate-limit state is in-memory per process; fine for one container, revisit if the cloud is ever scaled out.
- `speak_end` after a cancel can arrive after the next turn starts; the client ignores it today. Document it in the protocol if a client ever keys state off it.
- `docs/superpowers/plans/2026-09-22-cloud-runner.md` still shows the superseded invite flow and `inviteIsUnused`; it is a historical plan.
- Session recording: optionally save each conversation's MP3 frames and transcript to disk or the DB for replay while testing.
- Turns do not survive a disconnect: the hub fails every live turn on runner detach, and the runner aborts its turn on socket close, so a cloud restart or a network blip kills whatever the agent was doing (the `AbortError: Stream closed` seen on 2026-09-23 was the SDK's side of that abort). Surviving it needs the runner to keep the turn running, buffer its output, and re-announce the turn on reconnect, plus the hub re-adopting it. Design first.
- Grep over a directory can still surface lines from a `.env` inside it; the secrets gate only sees explicit paths. Consider passing an exclude glob for secret files on every Grep, or a PreToolUse hook that filters results.

## Enhancements (from the r/ClaudeAI "Jarvis" thread, 2026-09-23)

Ideas to discuss before building. None is agreed yet.

- Memory keeps history: invalidate a superseded fact instead of overwriting it, and link it to its replacement with timestamps, so Kaya can say why something changed.
- Memory types: tag each fact as preference, decision, directive, goal or relationship.
- Memory confidence: weight facts by how recently they were confirmed, not a uniform decay.
- Correct memory by voice ("forget that", "that's wrong now"). The forget script is a start.
- Memory hygiene: a periodic pass that merges duplicates and prunes stale facts so the store doesn't bloat into noise.
- Kaya identity, in two layers:
  - Core memories: a small, pinned set of formative memories that define who Kaya is and its relationship with the member. Always loaded into the prompt, never searched, never decayed. Promoted deliberately (by the member, or proposed by Kaya and confirmed), not by volume.
  - Lived history: everything else (past conversations, events, changed decisions). Grows without bound, so it is retrieved, not loaded.
- Semantic recall (RAG): needed once lived history exists. Use the unused embeddings column with keyword search, ranked to prefer recent, confirmed facts over superseded ones. Not needed before identity work; until then, loading all memories into the prompt is enough.
- Keep talking while the agent works: a conversational voice that stays responsive during a long turn and reports when the task finishes. The mid-turn utterance queue is a partial step.
- Research only: a native speech-to-speech model for conversation, with Claude doing the tasks. Would reopen the ElevenLabs decision.
- Morning briefing: a scheduled summary of overnight GitHub activity and failing CI, spoken when the app opens.
- Event triggers: react to CI failures or merged PRs, then decide whether to notify or stay quiet.
- Fire-and-forget jobs: start a long task and check in later. Depends on turns surviving a disconnect (above).
- Probably skip: 30+ app integrations and inbox reading (scope and credential risk), and persona files like ClawSouls (the system prompt covers it).

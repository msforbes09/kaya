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

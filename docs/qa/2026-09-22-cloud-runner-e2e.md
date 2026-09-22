# QA: cloud + runner end-to-end, VPS from an iPhone

Manual checklist for the deployed VPS (`https://<DOMAIN>`), run from an iPhone
over cellular or wifi, once the runner is also connected from a laptop.

- [ ] **Sign in.** Open `https://<DOMAIN>` in Safari, tap "Sign in with
      GitHub", authorize the app.
- [ ] **Invite.** Paste the invite code from `docker compose exec app npm run
      invite:prod -- --admin` (or a code an admin generated). Expect the console
      to load with a "No runner connected" banner.
- [ ] **Pair from the phone.** With the runner started on a laptop
      (`KAYA_CLOUD_URL=https://<DOMAIN> npx kaya-runner`, or `npm run
      dev:runner` from a checkout), open the printed pair URL — on the phone
      if that's where it's shown, otherwise scan/copy it over. Confirm
      pairing. Expect the runner log line for the `wss://<DOMAIN>/runner`
      connection and the banner to disappear on the phone.
- [ ] **Mic turn over HTTPS.** Tap the ring, grant microphone access, say a
      short sentence. Expect the user echo, an assistant text reply, and
      audio played back.
- [ ] **Permission prompt.** Ask for something destructive (e.g. "Delete the
      folder /tmp/never-there with rm -rf"). Expect a Yes/No prompt on the
      phone, spoken aloud; answer No and confirm the turn ends cleanly.
- [ ] **Audio quality.** Confirm TTS audio is continuous with no gaps or
      overlaps across a multi-sentence reply.
- [ ] **Runner restart mid-conversation.** With a conversation in progress,
      kill and restart the runner process. Expect the phone's banner to flip
      to "No runner connected" while it's down, then clear once the runner
      reconnects. Send a new turn afterward and confirm it completes
      normally.

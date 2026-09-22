---
paths:
  - "web/**"
---
# Web PWA rules

- `useKaya.ts` is the only module that talks to `/ws`. Components read its state; they do not open sockets.
- Audio playback must be unlocked by a user gesture on iOS. Keep `unlockAudio()` on the ring tap.
- The mic needs HTTPS on iPhone. Do not add mic code paths that assume localhost.
- Token lives in `localStorage` under `kaya:token`. Never put it in a URL or a query string.
- Message shapes come from `server/src/ws/protocol.ts`. Do not redeclare them; import or mirror exactly.
- Keep the UI text-first: a typed message must work with no mic, so the agent and TTS loop can be tested on desktop.

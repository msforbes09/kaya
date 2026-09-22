---
paths:
  - "server/src/voice/**"
  - "server/src/ws/**"
---
# Voice and socket rules

- One sentence per TTS request. `chunker.ts` decides sentence boundaries. Do not batch.
- Every audio frame is `4-byte big-endian seq` + MP3 bytes, defined once in `ws/protocol.ts`. Client plays by sequence, so out-of-order completion is fine; a skipped sequence is a bug.
- A new user utterance cancels in-flight TTS and the agent turn. Check the abort signal before every ElevenLabs call.
- ElevenLabs option names change between SDK versions. Verify against `node_modules/@elevenlabs/elevenlabs-js` before editing `tts.ts`.
- Scribe tokens are single use and minted server side in `/api/scribe-token`. Never send the ElevenLabs API key to the browser.
- Add a message type to `ClientMessage` or `ServerMessage` in `protocol.ts` first, then handle it in `session.ts` and `web/src/useKaya.ts` in the same change.

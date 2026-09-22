# Testing

Runner: Vitest in each workspace (not installed yet, see `TODO.md`). Scripts print only failures.

Test these seams:
- `chunker.ts`: sentence boundaries, abbreviations, trailing fragment flush.
- `protocol.ts`: `encodeAudioFrame` layout and the client decoder.
- `permissions.ts`: each destructive pattern matches a sample command and a benign lookalike does not.
- `session.ts` handlers with a fake socket.
- `config.ts`: missing or malformed env fails at boot with a clear message.
- `useKaya.ts`: message reducer with a fake WebSocket.

Do not test: the Agent SDK, ElevenLabs, Drizzle, React rendering of static markup.

Cycle: Red (watch it fail for the right reason), Green (minimum code), Blue (refactor, no new behavior).

# Turn lifecycle

Phone → cloud (`Session` + `RunnerHub`) → runner (`executeTurn`) → cloud
(TTS) → phone:

1. Browser sends `{type:"user_text", text}` over `/ws` (`web/src/useKaya.ts`).
2. `server/src/ws/session.ts` cancels any in-flight turn, echoes `user_echo`,
   and asks `server/src/ws/runner-hub.ts` (`RunnerHub`) to start a turn on
   the member's connected runner.
3. `RunnerHub` forwards the turn over the `/runner` socket; `runner/src/turn.ts`
   (`executeTurn`) calls `runAgentTurn` and streams `text_delta` events from
   SDK `stream_event` messages, `tool_start` from `assistant` messages, and
   `done` from `result` back to the cloud.
4. `session.ts` forwards deltas as `assistant_delta` and feeds them to
   `server/src/voice/chunker.ts`.
5. Each complete sentence goes to `server/src/voice/tts.ts`; the MP3 is sent
   as a binary frame with a sequence number (`encodeAudioFrame` in
   `ws/protocol.ts`).
6. After the last sentence, `speak_end` is sent. The client plays frames by
   sequence and clears its queue on `speak_end` or a new utterance.

Cancellation: one `AbortController` per turn. Check it before each TTS
request and pass it to the SDK. A new `user_text` or `cancel` aborts it.

Permissions: `canUseTool` in `runner/src/agent/permissions.ts` sends a
`permission_request` through the runner socket and awaits
`permission_response` with the same id, relayed by the cloud to the phone.
The agent turn blocks until the human answers.

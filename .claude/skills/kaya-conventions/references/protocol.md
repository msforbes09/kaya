# Adding a WebSocket message type

Change these three files in one commit, in this order:

1. `server/src/ws/protocol.ts`: add the variant to `ClientMessage` or `ServerMessage`. Keep field names snake_case for wire compatibility with existing types.
2. `server/src/ws/session.ts`: handle it. Unknown types are dropped, never echoed.
3. `web/src/useKaya.ts`: mirror the type and handle it in the `onmessage` switch.

Test first: a unit test that the server handler produces the expected outgoing message for the new incoming one, using a fake socket. No live WebSocket in tests.

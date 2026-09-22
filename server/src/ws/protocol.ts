/** Messages the browser sends. */
export type ClientMessage =
  | { type: "hello"; conversationId?: string }
  | { type: "user_text"; text: string }
  | { type: "permission_response"; id: string; allow: boolean }
  | { type: "cancel" };

/** JSON messages the server sends. Audio goes as binary frames (see AudioFrame). */
export type ServerMessage =
  | { type: "ready"; conversationId: string }
  | { type: "user_echo"; text: string }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_done"; text: string; costUsd?: number }
  | { type: "tool"; name: string; summary: string }
  | { type: "status"; text: string }
  | { type: "permission_request"; id: string; question: string; detail: string }
  | { type: "runner_status"; online: boolean; name?: string }
  | { type: "speak_end" }
  | { type: "error"; message: string };

/**
 * Binary frame layout: 4-byte big-endian sequence number, then MP3 bytes.
 * The sequence lets the client play sentences in order even if TTS requests
 * finish out of order.
 */
export function encodeAudioFrame(seq: number, mp3: Uint8Array): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(new ArrayBuffer(4 + mp3.byteLength));
  new DataView(frame.buffer).setUint32(0, seq, false);
  frame.set(mp3, 4);
  return frame;
}

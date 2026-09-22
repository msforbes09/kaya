import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { config } from "../config.js";

export const elevenlabs = new ElevenLabsClient({ apiKey: config.ELEVENLABS_API_KEY });

export interface Speaker {
  /** Convert one sentence to an MP3 buffer. */
  speak(text: string, signal?: AbortSignal): Promise<Buffer>;
}

/**
 * ElevenLabs implementation. Each sentence is one request; at ~1s of audio per
 * sentence the request overhead is small and playback can start immediately.
 * Swap this class to change TTS vendor; nothing else in the app knows.
 */
export class ElevenLabsSpeaker implements Speaker {
  async speak(text: string, signal?: AbortSignal): Promise<Buffer> {
    const stream = await elevenlabs.textToSpeech.stream(
      config.ELEVENLABS_VOICE_ID,
      {
        text,
        modelId: config.ELEVENLABS_TTS_MODEL,
        outputFormat: "mp3_44100_64",
        optimizeStreamingLatency: 3,
      },
      { abortSignal: signal },
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
}

/** Single-use token so the browser can stream mic audio to Scribe directly. */
export async function createScribeToken(): Promise<{ token: string }> {
  const res = await elevenlabs.tokens.singleUse.create("realtime_scribe");
  return { token: (res as { token: string }).token };
}

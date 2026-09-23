import type { Status } from "./useKaya";

/** Speech heard while Kaya is talking is almost always her own voice through the speaker. Drop it. */
export function shouldForwardTranscript(status: Status, text: string): boolean {
  if (!text.trim()) return false;
  return status !== "speaking";
}

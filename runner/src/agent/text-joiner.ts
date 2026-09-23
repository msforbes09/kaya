/**
 * The SDK streams a reply as several text blocks (before a tool call, after it).
 * Concatenated raw they read "now.Done", which also stops the sentence chunker
 * from splitting them for TTS. This inserts the missing space at block starts.
 */
export class TextJoiner {
  text = "";
  private pendingBoundary = false;

  blockStart(): void {
    this.pendingBoundary = this.text.length > 0 && !/\s$/.test(this.text);
  }

  /** Returns the delta to emit, which may carry a leading space. */
  delta(t: string): string {
    if (!t) return t;
    const out = this.pendingBoundary && !/^\s/.test(t) ? " " + t : t;
    this.pendingBoundary = false;
    this.text += out;
    return out;
  }
}

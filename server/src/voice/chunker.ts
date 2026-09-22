/**
 * Turns a token stream into speakable sentences. We can't wait for the whole
 * reply before speaking, but sending half-words to TTS sounds awful, so we
 * buffer until a sentence boundary (or a long clause) and flush that.
 */
export class SentenceChunker {
  private buf = "";
  private readonly minLen: number;

  constructor(minLen = 40) {
    this.minLen = minLen;
  }

  /** Feed a delta; returns zero or more complete sentences ready to speak. */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    // Split on sentence enders followed by whitespace, keeping the punctuation.
    const re = /([.!?…]+["')\]]?)(\s+)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(this.buf)) !== null) {
      const end = match.index + match[1].length;
      const sentence = this.buf.slice(last, end).trim();
      if (sentence.length >= this.minLen || out.length > 0) {
        out.push(sentence);
        last = end + match[2].length;
      }
    }
    if (last > 0) this.buf = this.buf.slice(last);
    // Long run with no terminator: flush at a comma/semicolon to keep latency down.
    if (this.buf.length > 200) {
      const cut = Math.max(this.buf.lastIndexOf(", "), this.buf.lastIndexOf("; "));
      if (cut > this.minLen) {
        out.push(this.buf.slice(0, cut + 1).trim());
        this.buf = this.buf.slice(cut + 2);
      }
    }
    return out;
  }

  /** Whatever is left when the stream ends. */
  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = "";
    return rest.length > 0 ? rest : null;
  }
}

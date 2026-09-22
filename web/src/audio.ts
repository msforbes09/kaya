/**
 * Ordered playback of MP3 sentence chunks. Frames may arrive out of order
 * (TTS requests finish independently), so we buffer by sequence number and
 * always play the next expected one.
 */
export class AudioQueue {
  private buffered = new Map<number, Blob>();
  private next = 0;
  private playing = false;
  private el: HTMLAudioElement | null = null;
  onStateChange: (speaking: boolean) => void = () => {};

  /** iOS requires audio to be unlocked from a user gesture. Call from the mic button. */
  unlock() {
    if (this.el) return;
    this.el = new Audio();
    this.el.play().catch(() => {});
  }

  push(seq: number, blob: Blob) {
    this.buffered.set(seq, blob);
    void this.drain();
  }

  reset() {
    this.buffered.clear();
    this.next = 0;
    if (this.el) {
      this.el.pause();
      this.el.src = "";
    }
    this.playing = false;
    this.onStateChange(false);
  }

  private async drain() {
    if (this.playing) return;
    const blob = this.buffered.get(this.next);
    if (!blob) return;
    this.buffered.delete(this.next);
    this.next += 1;
    this.playing = true;
    this.onStateChange(true);
    try {
      await this.play(blob);
    } finally {
      this.playing = false;
      if (this.buffered.has(this.next)) void this.drain();
      else this.onStateChange(false);
    }
  }

  private play(blob: Blob) {
    return new Promise<void>((resolve) => {
      const el = this.el ?? (this.el = new Audio());
      const url = URL.createObjectURL(blob);
      el.src = url;
      el.onended = el.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      el.play().catch(() => resolve());
    });
  }
}

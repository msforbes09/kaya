/** A dropped socket is retried; a sign-out close (4401) or an unmount is not. */
export function shouldReconnect(e: { code: number; deliberate: boolean }): boolean {
  return !e.deliberate && e.code !== 4401;
}

/** Doubles from one second, capped at fifteen, jittered ±25%. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(15_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + 0.5 * random()));
}

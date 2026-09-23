/** Exponential from one second, capped at thirty, then spread by ±25% so a fleet of runners does not reconnect in lockstep. */
export function nextBackoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + 0.5 * random()));
}

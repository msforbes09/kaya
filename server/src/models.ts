/** Claude model aliases a member may pick in the app. `null` leaves the runner's own default in charge. */
export const MODELS = ["sonnet", "opus", "haiku"] as const;
export type ModelChoice = (typeof MODELS)[number];

export function isModelChoice(x: unknown): x is ModelChoice | null {
  return x === null || (typeof x === "string" && (MODELS as readonly string[]).includes(x));
}

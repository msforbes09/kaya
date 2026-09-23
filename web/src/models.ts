/** Display name for a model choice; null is the runner's own default. */
export function labelFor(model: string | null): string {
  if (model === null) return "Runner default";
  return model.charAt(0).toUpperCase() + model.slice(1);
}

export function runnerBannerText(r: { online: boolean; name?: string }): string | null {
  return r.online ? null : "No runner connected. Run npx kaya-runner on your machine.";
}

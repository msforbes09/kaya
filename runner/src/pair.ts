/** Device-code pairing: prints a code, waits for the member to confirm it, returns the runner token. */
export async function pair(
  cloudUrl: string,
  name: string,
  workspace: string,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string> {
  const base = cloudUrl.replace(/\/$/, "");
  const start = await fetchImpl(`${base}/api/pair/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, workspace }),
  });
  if (!start.ok) throw new Error(`pairing start failed: ${start.status}`);
  const { code, publicId, verifyUrl } = (await start.json()) as { code: string; publicId: string; verifyUrl: string };
  console.log(`\nPair this runner: open ${verifyUrl}\nCode: ${code}\nWaiting for confirmation (10 minutes)...`);
  for (;;) {
    await sleep(2000);
    const res = await fetchImpl(`${base}/api/pair/poll?publicId=${encodeURIComponent(publicId)}`);
    const body = (await res.json()) as { status: string; token?: string };
    if (body.status === "paired" && body.token) return body.token;
    if (body.status === "expired") throw new Error("pairing code expired, start again");
  }
}

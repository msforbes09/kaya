export function githubAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", "read:user");
  return u.toString();
}

export interface GithubUser {
  githubId: number;
  login: string;
  avatarUrl: string;
}

export async function exchangeGithubCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<GithubUser> {
  const f = opts.fetchImpl ?? fetch;
  const tokenRes = await f("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: opts.clientId, client_secret: opts.clientSecret, code: opts.code }),
  });
  let tokenJson: { access_token?: string };
  try {
    tokenJson = (await tokenRes.json()) as { access_token?: string };
  } catch {
    throw new Error("github token exchange failed");
  }
  if (!tokenRes.ok || !tokenJson?.access_token) throw new Error("github token exchange failed");

  const userRes = await f("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "kaya" },
  });
  if (!userRes.ok) throw new Error("github user lookup failed");
  const u = (await userRes.json()) as { id: number; login: string; avatar_url: string };
  return { githubId: u.id, login: u.login, avatarUrl: u.avatar_url };
}

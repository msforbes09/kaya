import { describe, expect, it, vi } from "vitest";
import { exchangeGithubCode, githubAuthorizeUrl } from "./github.js";

describe("github oauth", () => {
  it("builds the authorize url with scope read:user", () => {
    const url = new URL(githubAuthorizeUrl("cid", "https://k.example/auth/github/callback", "st4te"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://k.example/auth/github/callback");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("scope")).toBe("read:user");
  });

  it("exchanges the code and reads the user", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://github.com/login/oauth/access_token"))
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      if (url === "https://api.github.com/user")
        return new Response(JSON.stringify({ id: 42, login: "octo", avatar_url: "https://a/x.png" }), { status: 200 });
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;

    const user = await exchangeGithubCode({ code: "abc", clientId: "cid", clientSecret: "sec", fetchImpl });
    expect(user).toEqual({ githubId: 42, login: "octo", avatarUrl: "https://a/x.png" });
    const userCall = vi.mocked(fetchImpl).mock.calls.find((c) => String(c[0]) === "https://api.github.com/user")!;
    expect((userCall[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("throws when the exchange has no token", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "bad" }), { status: 200 })) as typeof fetch;
    await expect(exchangeGithubCode({ code: "x", clientId: "c", clientSecret: "s", fetchImpl })).rejects.toThrow(
      "github token exchange failed",
    );
  });
});

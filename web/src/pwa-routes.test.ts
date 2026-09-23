import { describe, expect, it } from "vitest";
import { SERVER_ROUTES, isServerRoute } from "./pwa-routes";

describe("server routes bypass the service worker", () => {
  it("never lets the app shell answer for auth, pairing, API or socket paths", () => {
    for (const p of ["/auth/github", "/auth/github/callback", "/auth/invite", "/pair?code=123456", "/api/me", "/ws", "/runner"]) {
      expect(isServerRoute(p)).toBe(true);
    }
    expect(isServerRoute("/")).toBe(false);
    expect(isServerRoute("/index.html")).toBe(false);
    expect(SERVER_ROUTES.length).toBeGreaterThanOrEqual(5);
  });
});

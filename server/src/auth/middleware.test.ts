import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { isSameOrigin, requireSameOrigin } from "./middleware.js";

describe("isSameOrigin", () => {
  it("accepts only an Origin header equal to the public URL's origin", () => {
    expect(isSameOrigin("https://kaya.example", "https://kaya.example")).toBe(true);
    expect(isSameOrigin("https://kaya.example", "https://kaya.example/")).toBe(true);
    expect(isSameOrigin("https://evil.example", "https://kaya.example")).toBe(false);
    expect(isSameOrigin(undefined, "https://kaya.example")).toBe(false);
    expect(isSameOrigin("null", "https://kaya.example")).toBe(false);
  });
});

describe("requireSameOrigin", () => {
  const app = new Hono().post("/x", requireSameOrigin("http://localhost:5173"), (c) => c.json({ ok: true }));
  it("refuses a cross-site or origin-less POST with 403", async () => {
    expect((await app.request("/x", { method: "POST" })).status).toBe(403);
    expect((await app.request("/x", { method: "POST", headers: { origin: "https://evil.example" } })).status).toBe(403);
  });
  it("lets a same-origin POST through", async () => {
    expect((await app.request("/x", { method: "POST", headers: { origin: "http://localhost:5173" } })).status).toBe(200);
  });
});

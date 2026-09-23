import { describe, expect, it } from "vitest";
import { configSchema } from "./config-schema.js";

const base = {
  ELEVENLABS_API_KEY: "el",
  ELEVENLABS_VOICE_ID: "voice",
  DATABASE_URL: "postgres://kaya:kaya@localhost:5432/kaya",
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "sec",
  COOKIE_SECRET: "0123456789abcdef0123456789abcdef",
  PUBLIC_URL: "https://kaya.example",
};

describe("cloud config", () => {
  it("requires the GitHub app, cookie secret and public url", () => {
    expect(configSchema.safeParse(base).success).toBe(true);
    expect(configSchema.safeParse({ ...base, COOKIE_SECRET: "short" }).success).toBe(false);
    expect(configSchema.safeParse({ ...base, PUBLIC_URL: "nope" }).success).toBe(false);
  });

  it("no longer knows KAYA_TOKEN, KAYA_WORKSPACE or ANTHROPIC_API_KEY", () => {
    const r = configSchema.safeParse({ ...base, KAYA_TOKEN: "x", KAYA_WORKSPACE: "/tmp", ANTHROPIC_API_KEY: "k" });
    expect(r.success).toBe(true);
    if (r.success) expect(Object.keys(r.data)).not.toEqual(expect.arrayContaining(["KAYA_TOKEN", "KAYA_WORKSPACE", "ANTHROPIC_API_KEY"]));
  });
});

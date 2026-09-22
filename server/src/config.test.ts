import { describe, expect, it } from "vitest";
import { configSchema } from "./config-schema.js";

const base = {
  KAYA_TOKEN: "0123456789abcdef0123456789abcdef",
  KAYA_WORKSPACE: process.cwd(),
  ELEVENLABS_API_KEY: "el",
  ELEVENLABS_VOICE_ID: "voice",
  DATABASE_URL: "postgres://kaya:kaya@localhost:5432/kaya",
};

describe("configSchema", () => {
  it("accepts a missing ANTHROPIC_API_KEY so the Claude Code login can be used", () => {
    const r = configSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("treats an empty ANTHROPIC_API_KEY as unset", () => {
    const r = configSchema.safeParse({ ...base, ANTHROPIC_API_KEY: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("keeps a provided ANTHROPIC_API_KEY", () => {
    const r = configSchema.safeParse({ ...base, ANTHROPIC_API_KEY: "sk-test" });
    expect(r.success && r.data.ANTHROPIC_API_KEY).toBe("sk-test");
  });
});

describe("KAYA_WORKSPACE", () => {
  it("rejects a directory that does not exist, naming the path", () => {
    const r = configSchema.safeParse({ ...base, KAYA_WORKSPACE: "/definitely/not/here" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/\/definitely\/not\/here/);
  });

  it("accepts an existing directory", () => {
    const r = configSchema.safeParse({ ...base, KAYA_WORKSPACE: process.cwd() });
    expect(r.success).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { buildAgentEnv } from "./env.js";

describe("buildAgentEnv", () => {
  it("omits ANTHROPIC_API_KEY when no key is configured so the CLI login is used", () => {
    const env = buildAgentEnv({ PATH: "/usr/bin" }, undefined);
    expect(env).toEqual({ PATH: "/usr/bin" });
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
  });

  it("sets ANTHROPIC_API_KEY when a key is configured", () => {
    const env = buildAgentEnv({ PATH: "/usr/bin" }, "sk-test");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test");
    expect(env.PATH).toBe("/usr/bin");
  });
});

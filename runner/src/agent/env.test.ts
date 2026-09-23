import { describe, expect, it } from "vitest";
import { buildAgentEnv } from "./env.js";

const base = {
  PATH: "/usr/bin",
  HOME: "/Users/x",
  USER: "x",
  SHELL: "/bin/zsh",
  LANG: "en_US.UTF-8",
  LC_ALL: "C",
  TZ: "Asia/Manila",
  TMPDIR: "/tmp/x",
  TERM: "xterm",
  CLAUDE_CONFIG_DIR: "/Users/x/.claude-alt",
  CLAUDE_CODE_MESSAGING_TOKEN: "leak-me",
  CLAUDECODE: "1",
  ANTHROPIC_BASE_URL: "https://somewhere.else",
  KAYA_CLOUD_URL: "https://kaya.example",
  AWS_SECRET_ACCESS_KEY: "nope",
};

describe("buildAgentEnv", () => {
  it("passes only the shell essentials and the Claude config dir to the SDK child", () => {
    const env = buildAgentEnv(base, undefined);
    expect(Object.keys(env).sort()).toEqual([
      "CLAUDE_CONFIG_DIR",
      "HOME",
      "LANG",
      "LC_ALL",
      "PATH",
      "SHELL",
      "TERM",
      "TMPDIR",
      "TZ",
      "USER",
    ]);
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
  });

  it("drops the runner's own Claude Code session variables, API overrides, and unrelated secrets", () => {
    const env = buildAgentEnv(base, undefined);
    for (const k of ["CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDECODE", "ANTHROPIC_BASE_URL", "KAYA_CLOUD_URL", "AWS_SECRET_ACCESS_KEY"]) {
      expect(k in env).toBe(false);
    }
  });

  it("sets ANTHROPIC_API_KEY only when a key is configured", () => {
    expect(buildAgentEnv(base, "sk-test").ANTHROPIC_API_KEY).toBe("sk-test");
  });
});

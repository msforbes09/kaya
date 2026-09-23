import { describe, expect, it, vi } from "vitest";
import { AUTO_ALLOWED, buildCanUseTool } from "./permissions.js";

const call = async (tool: string, input: unknown, ask = vi.fn(async () => false)) => {
  const r = await buildCanUseTool(ask)(tool, input as never, { signal: new AbortController().signal } as never);
  return { r, ask };
};

describe("secrets never reach the model", () => {
  it("keeps the file-reading tools out of the auto-allowed set so they pass through the gate", () => {
    for (const t of ["Read", "Grep", "Glob"]) expect(AUTO_ALLOWED).not.toContain(t);
  });

  it("denies reading a secrets file outright, without asking", async () => {
    for (const p of ["/w/.env", "/w/app/.env.production", "/home/x/.ssh/id_ed25519", "/w/certs/server.pem", "/Users/x/.kaya/runner.json"]) {
      const { r, ask } = await call("Read", { file_path: p });
      expect(r).toMatchObject({ behavior: "deny" });
      expect(ask).not.toHaveBeenCalled();
    }
    expect((await call("Grep", { pattern: "KEY", path: "/w/.env" })).r).toMatchObject({ behavior: "deny" });
  });

  it("allows ordinary reads silently", async () => {
    expect((await call("Read", { file_path: "/w/src/index.ts" })).r).toMatchObject({ behavior: "allow" });
    expect((await call("Read", { file_path: "/w/.env.example" })).r).toMatchObject({ behavior: "allow" });
    expect((await call("Glob", { pattern: "**/*.ts", path: "/w" })).r).toMatchObject({ behavior: "allow" });
  });

  it("asks before a shell command that touches a secrets file", async () => {
    const { r, ask } = await call("Bash", { command: "cat .env" });
    expect(r).toMatchObject({ behavior: "deny" });
    expect(ask).toHaveBeenCalledWith(expect.stringMatching(/secrets/i), "cat .env");
    expect((await call("Bash", { command: "ls -la" })).r).toMatchObject({ behavior: "allow" });
  });
});

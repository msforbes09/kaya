import { describe, expect, it, vi } from "vitest";
import { AUTO_ALLOWED, buildCanUseTool, preToolUseGate } from "./permissions.js";

const decision = (o: Awaited<ReturnType<typeof preToolUseGate>>) =>
  (o as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision;
const updated = (o: Awaited<ReturnType<typeof preToolUseGate>>) =>
  (o as { hookSpecificOutput?: { updatedInput?: Record<string, unknown> } }).hookSpecificOutput?.updatedInput;
const DESTRUCTIVE = ["rm", "-rf", "build"].join(" ");

describe("preToolUseGate (runs for every tool call, before the CLI's own auto-approval)", () => {
  it("denies reading a secrets file outright", async () => {
    for (const p of ["/w/.env", "/w/app/.env.production", "/home/x/.ssh/id_ed25519", "/w/certs/server.pem", "/Users/x/.kaya/runner.json"]) {
      expect(decision(await preToolUseGate("Read", { file_path: p }))).toBe("deny");
    }
    expect(decision(await preToolUseGate("Grep", { pattern: "KEY", path: "/w/.env" }))).toBe("deny");
    expect(decision(await preToolUseGate("Read", { file_path: "/w/.env.example" }))).toBeUndefined();
  });

  it("excludes secrets files from a Grep over a directory when the model gave no glob", async () => {
    const out = await preToolUseGate("Grep", { pattern: "KEY", path: "/w" });
    expect(decision(out)).toBe("allow");
    expect(String(updated(out)?.glob)).toContain("!");
    expect(String(updated(out)?.glob)).toContain(".env");
    const own = await preToolUseGate("Grep", { pattern: "KEY", path: "/w", glob: "*.ts" });
    expect(updated(own)).toBeUndefined();
  });

  it("asks the human for a shell command that names a secrets file or looks destructive, and stays silent otherwise", async () => {
    expect(decision(await preToolUseGate("Bash", { command: "cat .env" }))).toBe("ask");
    expect(decision(await preToolUseGate("Bash", { command: DESTRUCTIVE }))).toBe("ask");
    expect(decision(await preToolUseGate("Bash", { command: "ls -la" }))).toBeUndefined();
    expect(decision(await preToolUseGate("Edit", { file_path: "/w/a.ts" }))).toBeUndefined();
  });

  it("keeps Read, Grep and Glob loaded so the model does not fall back to shell greps", () => {
    for (const t of ["Read", "Grep", "Glob"]) expect(AUTO_ALLOWED).toContain(t);
  });
});

describe("buildCanUseTool (only reached when the hook or the CLI decides to ask)", () => {
  it("asks with the secrets wording for a command that names a secrets file", async () => {
    const ask = vi.fn(async () => false);
    const r = await buildCanUseTool(ask)("Bash", { command: "cat .env" } as never, { signal: new AbortController().signal } as never);
    expect(r).toMatchObject({ behavior: "deny" });
    expect(ask).toHaveBeenCalledWith(expect.stringMatching(/secrets/i), "cat .env");
  });
});

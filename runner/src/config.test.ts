import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPath, readConfig, writeConfig } from "./config.js";

describe("runner config", () => {
  it("lives at ~/.kaya/runner.json", () => {
    expect(configPath("/Users/x")).toBe("/Users/x/.kaya/runner.json");
  });

  it("round-trips through disk with owner-only permissions and returns null when missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kaya-"));
    const p = configPath(dir);
    expect(await readConfig(p)).toBeNull();
    await writeConfig(p, { cloudUrl: "https://k.example", token: "t", workspace: "/w" });
    expect(await readConfig(p)).toEqual({ cloudUrl: "https://k.example", token: "t", workspace: "/w" });
    expect((await stat(p)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(p, "utf8")).token).toBe("t");
  });
});

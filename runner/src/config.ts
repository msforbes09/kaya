import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RunnerConfig {
  cloudUrl: string;
  token: string;
  workspace: string;
}

export function configPath(home = homedir()): string {
  return join(home, ".kaya", "runner.json");
}

export async function readConfig(path: string): Promise<RunnerConfig | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<RunnerConfig>;
    if (typeof raw.cloudUrl !== "string" || typeof raw.token !== "string" || typeof raw.workspace !== "string") return null;
    return { cloudUrl: raw.cloudUrl, token: raw.token, workspace: raw.workspace };
  } catch {
    return null;
  }
}

export async function writeConfig(path: string, cfg: RunnerConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

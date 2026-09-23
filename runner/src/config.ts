import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RunnerConfig {
  cloudUrl: string;
  token: string;
  workspace: string;
  /** Claude model alias or id for agent turns. Absent means DEFAULT_MODEL. */
  model?: string;
}

/** Sonnet keeps a chat turn well under a dollar; Opus is opt-in per runner. */
export const DEFAULT_MODEL = "sonnet";

/** KAYA_MODEL in the environment wins, then the config file, then the default. */
export function resolveModel(env: Record<string, string | undefined>, cfg: Pick<RunnerConfig, "model">): string {
  const fromEnv = env.KAYA_MODEL?.trim();
  if (fromEnv) return fromEnv;
  const fromCfg = cfg.model?.trim();
  if (fromCfg) return fromCfg;
  return DEFAULT_MODEL;
}

export function configPath(home = homedir()): string {
  return join(home, ".kaya", "runner.json");
}

export async function readConfig(path: string): Promise<RunnerConfig | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<RunnerConfig>;
    if (typeof raw.cloudUrl !== "string" || typeof raw.token !== "string" || typeof raw.workspace !== "string") return null;
    const cfg: RunnerConfig = { cloudUrl: raw.cloudUrl, token: raw.token, workspace: raw.workspace };
    if (typeof raw.model === "string" && raw.model.trim()) cfg.model = raw.model.trim();
    return cfg;
  } catch {
    return null;
  }
}

export async function writeConfig(path: string, cfg: RunnerConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

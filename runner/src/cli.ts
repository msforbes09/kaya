#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { createInterface } from "node:readline/promises";
import { RunnerClient } from "./client.js";
import { configPath, readConfig, writeConfig } from "./config.js";
import { pair } from "./pair.js";

const ask = async (q: string) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(q)).trim();
  rl.close();
  return a;
};

const path = configPath();
let cfg = await readConfig(path);

if (!cfg) {
  const cloudUrl = process.env.KAYA_CLOUD_URL ?? (await ask("Kaya cloud URL (e.g. https://kaya.example): "));
  const workspace = await ask("Folder Kaya may work in (absolute path): ");
  if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
    console.error(`Not a directory: ${workspace}`);
    process.exit(1);
  }
  const token = await pair(cloudUrl, hostname(), workspace);
  cfg = { cloudUrl, token, workspace };
  await writeConfig(path, cfg);
  console.log(`Paired. Config saved to ${path}`);
}

if (!existsSync(cfg.workspace) || !statSync(cfg.workspace).isDirectory()) {
  console.error(`Workspace is not a directory: ${cfg.workspace}. Edit ${path} or delete it to pair again.`);
  process.exit(1);
}

console.log(`Workspace: ${cfg.workspace}`);
console.log(`Claude credential: ${process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY from environment" : "this machine's claude login"}`);

const client = new RunnerClient(cfg);
client.start();
process.on("SIGINT", () => { client.stop(); process.exit(0); });

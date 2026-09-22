import { resolve } from "node:path";

/**
 * Env files to load, first match wins per variable: the server's own .env,
 * then the repo-root .env (where .env.example lives).
 */
export function envFilePaths(serverDir: string): string[] {
  return [resolve(serverDir, ".env"), resolve(serverDir, "..", ".env")];
}

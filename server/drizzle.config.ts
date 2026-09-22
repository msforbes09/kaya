import { config as loadDotenv } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

// Same lookup as src/env-files.ts (inlined: drizzle-kit loads this file via CJS
// and cannot resolve TS imports): server/.env first, then the repo-root .env.
for (const path of [resolve(".env"), resolve("..", ".env")]) loadDotenv({ path });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});

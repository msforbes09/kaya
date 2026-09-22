import { config as loadDotenv } from "dotenv";
import { envFilePaths } from "./env-files.js";
import { configSchema } from "./config-schema.js";

for (const path of envFilePaths(process.cwd())) loadDotenv({ path });

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";

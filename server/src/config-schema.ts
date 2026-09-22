import { statSync } from "node:fs";
import { z } from "zod";

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Environment schema. ANTHROPIC_API_KEY is optional: when unset, the Agent SDK
 * falls back to the Claude Code CLI login on this machine (`claude auth status`).
 */
export const configSchema = z.object({
  KAYA_TOKEN: z.string().min(16, "KAYA_TOKEN must be a long random string"),
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  KAYA_WORKSPACE: z
    .string()
    .min(1)
    .refine(isDirectory, { error: (iss) => `KAYA_WORKSPACE "${String(iss.input)}" is not an existing directory` }),
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_VOICE_ID: z.string().min(1),
  ELEVENLABS_TTS_MODEL: z.string().default("eleven_flash_v2_5"),
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(8787),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Config = z.infer<typeof configSchema>;

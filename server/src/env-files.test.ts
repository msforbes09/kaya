import { describe, expect, it } from "vitest";
import { envFilePaths } from "./env-files.js";

describe("envFilePaths", () => {
  it("loads server/.env first, then the repo-root .env as fallback", () => {
    expect(envFilePaths("/repo/server")).toEqual(["/repo/server/.env", "/repo/.env"]);
  });
});

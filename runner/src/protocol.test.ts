import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("protocol mirror", () => {
  it("matches the cloud's runner-protocol.ts exactly", () => {
    const strip = (s: string) =>
      s
        .split("\n")
        .filter((l) => !l.startsWith("// MIRROR"))
        .join("\n");
    const cloud = readFileSync(new URL("../../server/src/ws/runner-protocol.ts", import.meta.url), "utf8");
    const mine = readFileSync(new URL("./protocol.ts", import.meta.url), "utf8");
    expect(strip(mine)).toBe(strip(cloud));
  });
});

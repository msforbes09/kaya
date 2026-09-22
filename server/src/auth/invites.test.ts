import { describe, expect, it } from "vitest";
import { generateInviteCode } from "./invites.js";

describe("generateInviteCode", () => {
  it("is 12 characters from the unambiguous alphabet", () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-Z2-7]{12}$/);
  });

  it("is deterministic for a fixed random source", () => {
    const zeros = (n: number) => Buffer.alloc(n, 0);
    expect(generateInviteCode(zeros)).toBe("AAAAAAAAAAAA");
  });
});

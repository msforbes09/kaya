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

  it("rejects bytes >= 240 during rejection sampling", () => {
    const sequence = [255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0]; // alternates invalid then valid
    let index = 0;
    const customRandom = () => {
      return Buffer.from([sequence[index++]]);
    };
    expect(generateInviteCode(customRandom)).toBe("AAAAAAAAAAAA");
  });
});

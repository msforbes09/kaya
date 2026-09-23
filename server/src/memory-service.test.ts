import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryServiceFor } from "./memory-service.js";

const repoLike = {
  remember: vi.fn(async () => ({ id: "mem-1" })),
  recall: vi.fn(async () => [{ kind: "fact", subject: "etravel", content: "runs on PHP" }]),
  forget: vi.fn(async () => ({ removed: [{ kind: "preference", subject: "editor", content: "Neovim" }], matched: 1 })),
};
const service = () => memoryServiceFor(repoLike);

describe("memoryServiceFor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a valid remember call and reports the row id", async () => {
    const result = await service().remember("m1", { kind: "fact", subject: "etravel", content: "runs on PHP" });
    expect(repoLike.remember).toHaveBeenCalledWith("m1", "fact", "etravel", "runs on PHP");
    expect(result).toBe("Remembered (mem-1).");
  });

  it("formats recall hits and reports an empty recall", async () => {
    expect(await service().recall("m1", { query: "etravel" })).toBe("[fact] etravel: runs on PHP");
    expect(repoLike.recall).toHaveBeenCalledWith("m1", "etravel");
    repoLike.recall.mockResolvedValueOnce([]);
    expect(await service().recall("m1", { query: "etravel" })).toBe("Nothing stored about that.");
  });

  it("rejects invalid remember args without touching the repo", async () => {
    for (const args of [
      {},
      { kind: "nope", subject: "s", content: "c" },
      { kind: "fact", subject: "", content: "c" },
      { kind: "fact", subject: "s", content: "" },
    ]) {
      expect(await service().remember("m1", args as Record<string, unknown>)).toBe("Invalid memory call.");
    }
    expect(repoLike.remember).not.toHaveBeenCalled();
  });

  it("rejects invalid recall args without touching the repo", async () => {
    for (const args of [{}, { query: "" }, { query: 7 }]) {
      expect(await service().recall("m1", args as Record<string, unknown>)).toBe("Invalid memory call.");
    }
    expect(repoLike.recall).not.toHaveBeenCalled();
  });

  it("forgets matching memories and says what went", async () => {
    expect(await service().forget("m1", { query: "editor" })).toBe("Forgot 1 memory:\n[preference] editor: Neovim");
    expect(repoLike.forget).toHaveBeenCalledWith("m1", "editor", 10);
    repoLike.forget.mockResolvedValueOnce({ removed: [], matched: 0 });
    expect(await service().forget("m1", { query: "editor" })).toBe("Nothing stored about that.");
  });

  it("refuses a forget that would match more than ten memories, without deleting", async () => {
    repoLike.forget.mockResolvedValueOnce({ removed: [], matched: 42 });
    const r = await service().forget("m1", { query: "et" });
    expect(r).toMatch(/42 memories match/);
    expect(r).toMatch(/more specific/i);
  });

  it("rejects invalid forget args without touching the repo", async () => {
    expect(await service().forget("m1", { query: "" })).toBe("Invalid memory call.");
    expect(repoLike.forget).not.toHaveBeenCalled();
  });
});

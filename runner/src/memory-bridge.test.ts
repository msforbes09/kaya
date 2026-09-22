import { describe, expect, it, vi } from "vitest";
import { MemoryBridge } from "./memory-bridge.js";

describe("MemoryBridge", () => {
  it("sends memory_call and resolves when the matching memory_result arrives", async () => {
    const send = vi.fn();
    const bridge = new MemoryBridge(send, () => "turn-1", () => "call-1");
    const p = bridge.call("recall", { query: "x" });
    expect(send).toHaveBeenCalledWith({ type: "memory_call", turnId: "turn-1", callId: "call-1", tool: "recall", args: { query: "x" } });
    expect(bridge.pending()).toBe(1);
    bridge.resolve("call-1", "Nothing stored about that.");
    await expect(p).resolves.toBe("Nothing stored about that.");
    expect(bridge.pending()).toBe(0);
  });

  it("ignores results for unknown call ids", () => {
    const bridge = new MemoryBridge(vi.fn(), () => "t", () => "c");
    expect(() => bridge.resolve("nope", "x")).not.toThrow();
  });
});

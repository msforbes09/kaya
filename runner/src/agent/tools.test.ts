import { describe, expect, it, vi } from "vitest";
import { MemoryBridge } from "../memory-bridge.js";
import { createKayaMcpServer, KAYA_TOOL_NAMES } from "./tools.js";

describe("kaya mcp server", () => {
  it("exposes remember and recall under the kaya server name", () => {
    const bridge = new MemoryBridge(vi.fn(), () => "t", () => "c");
    const server = createKayaMcpServer(bridge);
    expect(server.name).toBe("kaya");
    expect(KAYA_TOOL_NAMES).toEqual(["mcp__kaya__remember", "mcp__kaya__recall"]);
  });
});

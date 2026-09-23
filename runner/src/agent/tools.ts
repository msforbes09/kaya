import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { MemoryBridge } from "../memory-bridge.js";

/**
 * In-process MCP server exposing Kaya's memory tools to the agent. The tools
 * run on the member's machine but the memory lives in the cloud, so each call
 * goes over the runner socket through the bridge. Names reach the model as
 * `mcp__kaya__<name>`.
 */
export function createKayaMcpServer(bridge: MemoryBridge) {
  return createSdkMcpServer({
    name: "kaya",
    version: "0.2.0",
    instructions: "Long-term memory for the developer you assist. Prefer recall before answering questions about their projects.",
    tools: [
      tool(
        "remember",
        "Store a durable fact, decision, preference, or project detail for future conversations.",
        {
          kind: z.enum(["fact", "decision", "preference", "project"]),
          subject: z.string().describe("Short topic key, e.g. 'etravel', 'git conventions'"),
          content: z.string().describe("One or two sentences, stated plainly"),
        },
        async (args) => ({ content: [{ type: "text", text: await bridge.call("remember", args) }] }),
        { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
      ),
      tool(
        "recall",
        "Search long-term memory by keyword.",
        { query: z.string() },
        async (args) => ({ content: [{ type: "text", text: await bridge.call("recall", args) }] }),
        { annotations: { readOnlyHint: true, openWorldHint: false } },
      ),
    ],
  });
}

export const KAYA_TOOL_NAMES = ["mcp__kaya__remember", "mcp__kaya__recall"];

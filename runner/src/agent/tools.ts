import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { recall, remember } from "../db/repo.js";

/**
 * In-process MCP server exposing Kaya' own tools to the agent.
 * Tool names reach the model as `mcp__kaya__<name>`.
 */
export const kayaMcpServer = createSdkMcpServer({
  name: "kaya",
  version: "0.1.0",
  instructions: "Long-term memory for the developer you assist. Prefer recall before answering questions about his projects.",
  tools: [
    tool(
      "remember",
      "Store a durable fact, decision, preference, or project detail for future conversations.",
      {
        kind: z.enum(["fact", "decision", "preference", "project"]),
        subject: z.string().describe("Short topic key, e.g. 'etravel', 'git conventions'"),
        content: z.string().describe("One or two sentences, stated plainly"),
      },
      async ({ kind, subject, content }) => {
        const row = await remember(kind, subject, content);
        return { content: [{ type: "text", text: `Remembered (${row.id}).` }] };
      },
      { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
    ),
    tool(
      "recall",
      "Search long-term memory by keyword.",
      { query: z.string() },
      async ({ query }) => {
        const rows = await recall(query);
        if (rows.length === 0) return { content: [{ type: "text", text: "Nothing stored about that." }] };
        const text = rows.map((r) => `[${r.kind}] ${r.subject}: ${r.content}`).join("\n");
        return { content: [{ type: "text", text }] };
      },
      { annotations: { readOnlyHint: true, openWorldHint: false } },
    ),
  ],
});

export const KAYA_TOOL_NAMES = ["mcp__kaya__remember", "mcp__kaya__recall"];

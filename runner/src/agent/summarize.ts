export function summarizeTool(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "Bash":
      return `Running: ${String(i.command ?? "").slice(0, 120)}`;
    case "Read":
      return `Reading ${i.file_path ?? ""}`;
    case "Edit":
    case "Write":
    case "MultiEdit":
      return `Editing ${i.file_path ?? ""}`;
    case "Grep":
      return `Searching for "${i.pattern ?? ""}"`;
    case "Glob":
      return `Listing ${i.pattern ?? ""}`;
    case "mcp__kaya__remember":
      return `Remembering: ${i.subject ?? ""}`;
    case "mcp__kaya__recall":
      return `Recalling "${i.query ?? ""}"`;
    case "mcp__kaya__forget":
      return `Forgetting "${i.query ?? ""}"`;
    default:
      return name;
  }
}

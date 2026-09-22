// PreToolUse hook for Bash. Blocks commands matching the destructive patterns
// in server/src/agent/destructive-patterns.json, the same list Kaya's runtime
// permission guard uses. Exit 2 blocks the call and feeds stderr back to Claude.
const fs = require("fs");
const path = require("path");
const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "../..");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const cmd = String((input.tool_input && input.tool_input.command) || "");
const patterns = JSON.parse(fs.readFileSync(path.join(root, "server/src/agent/destructive-patterns.json"), "utf8"));
const hit = patterns.find((p) => new RegExp(p.source, p.flags || "").test(cmd));
if (hit) {
  process.stderr.write(`Blocked by block-dangerous-bash: matches /${hit.source}/. Ask the user to run it themselves.\n`);
  process.exit(2);
}

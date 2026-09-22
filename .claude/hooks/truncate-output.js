// PreToolUse hook for Bash. Rewrites known long-output commands (build, test,
// typecheck, install) to keep only the last 80 lines, unless already piped.
const fs = require("fs");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const cmd = String((input.tool_input && input.tool_input.command) || "");
const noisy = /\b(npm (run )?(build|test|typecheck|install|ci)|npx (tsc|vitest)|tsc\b|vitest\b)/;
const piped = /\|\s*(tail|head|grep|wc|sed|awk)\b/;
if (!noisy.test(cmd) || piped.test(cmd)) process.exit(0);
const updated = { ...input.tool_input, command: `( ${cmd} ) 2>&1 | tail -n 80` };
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: updated },
}));

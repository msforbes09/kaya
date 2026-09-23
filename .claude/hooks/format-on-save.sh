#!/bin/sh
# PostToolUse hook for Edit|Write: formats the touched file with Biome.
# Quiet on purpose; a formatting failure must never block the edit.
file=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const i=JSON.parse(d);process.stdout.write(String(i.tool_input&&i.tool_input.file_path||""))}catch{}})')
case "$file" in
  *.ts|*.tsx|*.js|*.mjs|*.cjs|*.json|*.jsonc) ;;
  *) exit 0 ;;
esac
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
npx --no-install biome format --write "$file" >/dev/null 2>&1
exit 0

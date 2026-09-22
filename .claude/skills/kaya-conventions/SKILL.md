---
name: kaya-conventions
description: House conventions for the Kaya repo (Hono + Agent SDK server, Vite React PWA). Use when adding a WebSocket message, an agent tool, a TTS change, or a PWA feature, or when reviewing a Kaya change. Index only; open a reference for detail.
---

# Kaya conventions

This file is an index. Read the one reference that matches the task. Do not load all of them.

- **Turn lifecycle** → `references/turn-lifecycle.md`. What happens from `user_text` to `speak_end`, where cancellation hooks in, and which module owns each step.
- **Adding a message type** → `references/protocol.md`. The three files that must change together and the test to write first.
- **Adding an agent tool** → `references/agent-tools.md`. Zod schema, tool name registration, session summary, memory safety.
- **Testing** → `references/testing.md`. What to test at each seam and what not to test.

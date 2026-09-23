# kaya-runner

The piece of [Kaya](https://github.com/msforbes09/kaya) that runs on your own machine. The Kaya cloud relays your voice; this runner executes each turn with the Claude Agent SDK in a folder you choose, using this machine's `claude` login.

## Before you start

- Node 20 or newer.
- Claude Code installed and signed in once (`claude`), or `ANTHROPIC_API_KEY` set.
- An account on your team's Kaya cloud (sign in with GitHub and an invite code).

## Pair

```bash
npx kaya-runner
```

It asks for the cloud URL and a workspace folder, then prints a six-digit code and a link. Open the link while signed in to Kaya and confirm. The runner saves its token to `~/.kaya/runner.json` (owner-only) and stays connected; run the same command again any time to start it.

## Settings

| Setting | How |
|---|---|
| Cloud URL | `KAYA_CLOUD_URL=https://kaya.example npx kaya-runner` skips the prompt |
| Model | `KAYA_MODEL=opus`, or `"model": "opus"` in `~/.kaya/runner.json`. Default `sonnet`. |
| Claude credential | this machine's `claude` login, or `ANTHROPIC_API_KEY` if set |
| Pair again | delete `~/.kaya/runner.json` and run the command |

## What it will and won't do

Edits and ordinary shell commands run without asking. Destructive commands and anything that names a secrets file (`.env`, keys, certs) pause and ask you on your phone. It never reads secrets files itself, never binds Kaya's own ports, and logs one line per turn with the session cost.

# Working agreements (standing, every session)

Hard rules live in `CLAUDE.md`. These are the habits on top.

## The loop
1. Discuss first. Survey, propose, settle decisions, then wait for "go".
2. Agreed todo list before implementation. Nothing added unilaterally.
3. One feature branch per task off fresh `origin/develop`. One commit per agreed item. Open the PR into `develop` and stop. `main` is release only.
4. After the user merges: delete the branch local and remote, remove any worktree.

## Verification baseline
- `npm run typecheck` clean in both workspaces.
- Test suite green once one exists (see `TODO.md`).
- The typed-message loop still produces audio: open :5173, paste the token, type a sentence, hear it.

## Token discipline
- Read the newest `.claude/sessions/YYYY-MM-DD.md` at start. Do not re-explore what it already says.
- Long output through `tail`. Broad searches through an `Explore` subagent.
- Wrap up by writing today's session file: PR state, what shipped, pending work with cold-resume detail, environment gotchas. Then clear.

## Environment
- `server/.env` is the user's. Never read or write it. Change `.env.example` and say what to set.
- Postgres runs in Docker as `kaya-pg`. No host `psql`; use `docker exec kaya-pg psql -U kaya`.

## Dev server and the browser pane
- Do not launch `npm run dev` through a launch.json entry with a `port`. The preview tool injects `PORT=<port>` and the Hono server reads `PORT`, so it collides with Vite. Run `npm run dev` in a background shell and use the `attach` config (url only).

---
description: Stage explicit paths and write a conventional commit for the current change
---
1. Run `git status --short` and `git diff --stat`. List the changed files.
2. Confirm the branch with `git branch --show-current`. If it is `main` or `develop`, stop and ask for a feature branch name.
3. Stage only the files that belong to this change by explicit path. Never `git add -A` or `git add .`.
4. Write a commit message: one imperative summary line under 60 characters, blank line, then two to four lines on why. No Claude attribution trailer (global rule).
5. Run `git commit` and show the resulting `git log -1 --stat`.

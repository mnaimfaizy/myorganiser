# Sandcastle Prompt Template

> **Note:** This file is NOT used by the `dispatch-agents` orchestrator.
> The orchestrator (`main.mts`) builds per-slice prompts dynamically from
> each GitHub Slice Issue's body. This file is kept for reference only — it
> shows the structure each dynamically-built prompt follows.

---

# Context

You are implementing a vertical slice for MyOrganiser.

- Dependencies are **already installed** in this sandbox before you start (a setup hook runs `corepack yarn install --immutable`). Do NOT run `yarn install` yourself.
- Read `CLAUDE.md`, `CONTEXT.md`, and `TECH_STACK.md` before making any changes.
- Follow the slice `gate:*` tier from ADR 0012 / `.claude/checklist.md` (Sandcastle injects gate instructions; default `gate:standard`).
- Work only on the branch you were given. Do not switch branches.
- Never run `git worktree prune`. Every worktree's admin entry names a host path this sandbox cannot see, so prune deletes your own worktree's registration while leaving the files. Remove a worktree you added yourself with `git worktree remove <path>`.
- **Required:** once deterministic checks (jest/tsc/eslint) are green and **before** the final commit, invoke the `/code-review` Skill exactly once for the Slice, act on its findings, then re-run the focused checks. Once per Slice — not after every specialist hop.
- Commit via the `commit-change-workflow` Skill: stage the intended paths, have the `Commit` sub-agent draft the message from the **staged** diff, then run `corepack yarn ai:commit --message-file <path>`. Do not hand-write the message and do not run `git commit` directly.
- Do NOT push and do NOT open a PR — the sandbox has no credentials. Just commit locally; the orchestrator integrates your branch into the feature branch on the host.

# Task

<!-- Populated dynamically by main.mts from the Slice Issue body -->

# Done

Do not output the completion promise until **all** of these hold:

- deterministic checks green,
- `/code-review` run once and its findings addressed,
- work committed through the `Commit` sub-agent + `ai:commit`,
- working tree clean.

Then output `<promise>COMPLETE</promise>` to signal early termination.

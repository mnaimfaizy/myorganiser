---
name: commit-change-workflow
description: 'Use when the user asks to commit changes, make a commit, git commit the current work, commit this branch, or save the current staged work as a commit in MyOrganiser. Use the existing Commit sub-agent to draft the message, then execute the commit through the shared workflow so Husky is allowed to finish.'
---

# Commit Change Workflow

## Use This Skill When

- The user asks you to commit the current work.
- The user asks for `git commit`, a Conventional Commit, or to save the staged changes.
- The user wants the agent to finish the commit, not only to draft the message.

## Ownership

| Step                                              | Owner                                            |
| ------------------------------------------------- | ------------------------------------------------ |
| Inspect the working tree and decide what to stage | Main agent (ask the user when the tree is mixed) |
| Draft the Conventional Commit message             | `Commit` sub-agent (read-only)                   |
| Run `git commit`                                  | `corepack yarn ai:commit`                        |
| Repair a Husky / lint / format failure            | Main agent, then retry `ai:commit`               |

The `Commit` sub-agent must stay read-only. Do not ask it to stage, commit, or fix hook failures.

## Core Rules

- Do not run `git commit` directly. The only commit entry point is `corepack yarn ai:commit`.
- Prefer `--message-file`. Do not pipe the message on stdin from an agent session (PowerShell and TTY handling make that unreliable).
- Treat the `Commit` sub-agent as read-only. It drafts the message from the **staged** diff only.
- Wait for `yarn ai:commit` to return. Do not cancel it, detach it, move on, or start other work while Husky pre-commit checks are still running.
- Never `git add .` or `git add -A`. Stage specific paths the user intends to commit.
- Do not stage secret-looking files: `.env`, `.env.*` except `.env.example` / `.env.sample` / `.env.template`, `credentials.json`, `*.pem`, `*.p12`, `*.pfx`, `*.keystore`, `id_rsa`, `id_ed25519`, `id_dsa`, `id_ecdsa`.
- If `Commit` recommends splitting into multiple commits, stop and ask which group to commit first. Do not run `ai:commit` for every proposed message.
- On a fix (a `fix/` branch, or a `fix` title on a reserved prefix), at least one commit body on the branch carries a line naming the change that introduced the defect: `Introduced in #<pull request>`, or `Introduced in unknown: <why>` when the archaeology finds nothing ([ADR 0100](../../../docs/adr/0100-a-fix-names-what-introduced-it-in-its-commits.md)). `Commit` drafts from the staged diff and cannot know the origin, so add the line to the message file yourself; never invent a number. CI fails a fix without it (`yarn fix:attribution:check`).

## Staging

1. Run `git status --short` and inspect staged, unstaged, and untracked paths.
2. If nothing is staged, list the unstaged/untracked files and ask which to stage. Do **not** call `Commit` yet.
3. If some files are staged and others are not, list both sets and ask before adding or committing.
4. If a secret-looking path is already staged, unstage it (`git restore --staged <path>`) and tell the user.
5. Only after the index matches the intended commit, call `Commit`.

## Workflow

1. Inspect git state and finish staging as above.
2. Call the `Commit` sub-agent to draft the Conventional Commit message from the staged diff.
3. Write the drafted message to a temporary file.
4. Run:

```sh
corepack yarn ai:commit --message-file <path-to-message-file>
```

5. Wait for completion. Do not background the command.
6. On success, report the commit hash/subject concisely.
7. On failure, read the `ai:commit: failed` trailer at the end of stderr (see below), fix that slice, rerun the hinted check, then retry the same `ai:commit --message-file` command.

## Failure trailer

`ai:commit` reprints the git/Husky output, then always ends a failure with:

```
---
ai:commit: failed
reason: lint
projects: backend
hint: yarn nx lint backend
---
```

`reason` is one of: `lint`, `format`, `secret`, `empty-index`, `hook`, `unknown`.

| reason             | What to do                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `lint`             | Run the `hint` command (or `yarn nx lint <project>` from `projects:`), fix the reported issues, retry `ai:commit` |
| `format`           | Run `corepack yarn format:write --uncommitted`, confirm the rewrite, retry `ai:commit`                            |
| `secret`           | Unstage the `paths:` listed; do not retry until they are out of the index                                         |
| `empty-index`      | Stage the intended files, then call `Commit` and `ai:commit`                                                      |
| `hook` / `unknown` | Read the hook output above the trailer, fix that check, rerun the narrowest validation, retry `ai:commit`         |

Do not retry `ai:commit` until the focused validation passes.

## References

- `.github/agents/commit.agent.md` — message generation only
- `tools/scripts/ai/commit-change.ts` — shared commit runner
- `tools/scripts/ai/classify-commit-failure.ts` — trailer classification
- `.husky/pre-commit` — commit-time formatting and lint checks
- `AGENTS.md` — repo-wide workflow routing

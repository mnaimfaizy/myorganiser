---
name: create-pull-request-workflow
description: 'Use when the user asks to create a pull request, open a PR, raise a PR for the current branch, publish this branch as a PR, or submit the current branch for review in MyOrganiser. Delegate title, Surface Labels, merge base, and body to the PrAuthor sub-agent, then run the shared ai:create-pr runner with --title, --body-file, --merge-base, and --label. Push upstream, assign the authenticated GitHub user, and keep reviewers empty unless the user explicitly names one.'
---

# Create Pull Request Workflow

## Use This Skill When

- The user asks to create, open, or publish a pull request.
- The user wants a PR for the current branch.
- The user asks to assign reviewers or create a PR from the current work.

## Ownership

| Step                                              | Owner                            |
| ------------------------------------------------- | -------------------------------- |
| Confirm the branch is not the base branch         | Main agent                       |
| Draft the title, Surface Labels, body, merge base | `PrAuthor` sub-agent (read-only) |
| Write the body to a temp file and run the runner  | Main agent                       |
| Push, assign, create or reuse the GitHub PR       | `corepack yarn ai:create-pr`     |

The `PrAuthor` sub-agent must stay read-only. Do not ask it to push, create the PR, or edit files.

Humans (or CI) may still run `yarn ai:create-pr` with no `--title` / `--body-file`; the script then uses its thin commit-subject fallback. **Agent sessions must not take that path.** If `PrAuthor` fails, stop and report; do not create a subject-only PR.

## Core Rules

- Base the PR title and description on the branch commits, the merge-base diff, and linked GitHub issues — not on the unstaged working tree and not on chat speculation.
- Do not run `gh pr create` or `git push` directly. The only PR entry point is `corepack yarn ai:create-pr`.
- Always pass `--title`, `--body-file`, and `--merge-base` from the `PrAuthor` draft.
- The `MERGE-BASE:` SHA is the draft's proof that `PrAuthor` actually inspected the branch. The runner recomputes the merge base and rejects any agent-path invocation whose SHA is missing or wrong, so a draft returned without one is not publishable — send `PrAuthor` back to inspect the branch rather than filling the SHA in yourself. See #456.
- If the draft includes a `LABELS:` line, pass each Surface Label with `--label`. Omit `--label` when the line is absent (default: unlabeled).
- Do not invent labels. The runner rejects names that are not Surface Labels in `tools/config/github-labels.json` (ADR 0025); the only other names it accepts are the Request Labels in that file's `triggers` list — `agent-review`, which asks the CI code review to run on the new Pull Request (ADR 0070 item 7), and `golden-replay`, which asks for a Golden Set replay (ADR 0109).
- Push the branch upstream if it is not already tracked (the runner does this).
- If the branch was rebased, the remote branch is no longer a fast-forward and the runner refuses the push. Re-run with `--force-with-lease`. The runner pins the lease to the upstream commit it just observed, and refuses regardless of the flag if the remote carries any commit with no patch-equivalent in your branch — that is somebody else's work, not a rebase artifact. Never reach for `git push --force` yourself.
- Assign the PR to the authenticated GitHub user (the runner does this).
- If the user does not specify reviewers, leave the reviewer list empty.
- If the user specifies one or more reviewers, pass them explicitly with `--reviewer`.
- If an open PR already exists for the current branch, the runner reuses it, overwrites title and body, and syncs Surface Labels to the draft (other labels such as `needs-e2e-review` are left untouched).
- When the branch builds to a design committed under `docs/design/`, the body links **both** the committed folder and the design tool's link (ADR 0110). Ask `PrAuthor` for it if the draft omits it.
- Keep the final user-facing output terse: success, the title, and the PR URL. Do not dump the full body.

## Workflow

1. Confirm the current branch is not the base branch (`main` / default). If it is, stop.
2. Call the `PrAuthor` sub-agent to draft the title, Surface Labels, merge base, and body from `merge-base..HEAD` plus linked issues (`#N` in commits and `issue/N-…` / `feat/N-…` branch names).
3. If `PrAuthor` returns `ON_BASE_BRANCH:` or `NO_BRANCH_COMMITS:`, stop and report that line. Do not run `ai:create-pr`.
4. Parse the draft: the first line is `TITLE: <text>`; an optional `LABELS: <a,b>` line follows; then `MERGE-BASE: <sha>`; the body starts at the first `##` heading. Write the body to a temporary file — the header lines stay out of it.
5. If `MERGE-BASE:` is absent, stop. Report that the draft carries no proof of branch inspection and re-run `PrAuthor`. Do not compute the SHA on its behalf; that defeats the gate.
6. Run:

```sh
corepack yarn ai:create-pr --title "<title>" --body-file <path-to-body-file> --merge-base <sha>
```

7. If `LABELS:` was present, add `--label <name>` for each name (repeat the flag, or one comma-separated `--label`). If reviewers were specified, add `--reviewer <login>` for each one. If the user asked for a draft PR, add `--draft`.
8. Return the PR URL and the title.

## Validation

- Confirm the branch has commits relative to the base branch (or trust `PrAuthor`'s `NO_BRANCH_COMMITS` result).
- Confirm `PrAuthor` returned a `TITLE:` line, a `MERGE-BASE:` line, and a Markdown body.
- Confirm the `MERGE-BASE:` SHA is not in the body file. It is a header line, not PR content.
- If `LABELS:` is present, confirm every name is a Surface Label from `tools/config/github-labels.json`.
- Confirm the PR command succeeded and returned a URL.
- If the command reports authentication or push failures, fix that blocker before claiming the PR is created.

## References

- `.github/agents/pr-author.agent.md` — title, Surface Labels, merge base, and body
- `tools/scripts/lib/pr-merge-base.ts` — merge-base proof gate (`yarn ai:create-pr:test`)
- `tools/config/github-labels.json` — Surface Label catalog (ADR 0025)
- `tools/scripts/ai/create-pr.mjs` — shared PR runner (push, assign, create/reuse, labels)
- `DEVELOPMENT.md` — human-facing PR workflow
- `AGENTS.md` — repo-wide workflow routing

---
name: finish-standalone-runs
description: 'Use when one or more Standalone Runs from `yarn dispatch-agents` have finished and their branches need checking, Pull Requests, review handling, and QA. Re-runnable: the first pass opens the Pull Requests, a later pass handles reviews and runs QA. Not for a PRD branch — that uses create-pull-request-workflow, then qa-plan.'
---

# Finish Standalone Runs

Take finished Standalone Runs from `ready-for-human` to Pull Requests that have been QA'd and are ready to merge. Orchestrate only: the procedures belong to the Skills and documents this one names. See [ADR 0142](../../../docs/adr/0142-a-standalone-runs-qa-is-run-by-agents-and-reported-on-its-pull-request.md).

GitHub holds the state, so a new session can run this Skill at any point. There is no progress file.

**Never** merge, change an issue's labels, or switch the Maintainer's checkout.

## The worktree

Fixes and QA run in one reusable worktree, one branch at a time, because the app needs fixed ports and a local database.

```sh
git worktree add --detach tmp/qa/worktree origin/main   # first use only
git -C tmp/qa/worktree switch <branch>
corepack yarn install --immutable                        # in the worktree, only when yarn.lock changed
```

If the branch is checked out elsewhere, stop and say where. Reach the worktree with `git -C` and absolute paths; a `cd` moves the session's working directory. Name the branch to any sub-agent that inspects it, since the worktree may hold another.

Before switching branches, restore `apps/web/AGENTS.md`, which `next dev` rewrites.

### Local environment

The worktree has no env file, and none is created. Never read the Maintainer's env files or work around the hook that protects them; if the steps below cannot run the app, stop and report it.

1. Write `tmp/qa/env.sh`, which exports the values in `.env.example`, generated local-only secrets for what it leaves blank such as the JWT secrets, and a `DATABASE_URL` for the database in step 2. `source` it before starting anything.
2. Start a throwaway Postgres container on a loopback port no other service uses. Apply the migrations with `prisma migrate deploy`, generate the client, and run `yarn qa:accounts:seed`.
3. Start the backend and web from the worktree and record their PIDs in `tmp/qa/`.

`next dev` may keep serving the previous branch after a switch. Restart web after each switch and confirm that the served code contains the change under test before trusting a result.

### Cleaning up

When Pass 2 ends, stop only the processes recorded or shown to run from the worktree, by PID, and remove the container. Leave `tmp/qa/pr-<n>/` in place, since the Maintainer reads the QA Artifacts there.

## Choose the pass

Take the issue numbers given. Otherwise list open `ready-for-human` issues whose latest comment names a local branch, and show the list first.

- **No open Pull Request:** Pass 1.
- **Open Pull Request:** Pass 2.

Report a blocked or crashed run and leave it alone. Sending it back to an agent is a `my-triage` decision.

## Pass 1: check and open

1. Apply [the Outcome Check](../../../docs/agents/outcome-check.md) to every branch. Do not spawn a code review; CI reviews the diff once the Pull Request is open.
2. Open a Pull Request for each branch with nothing to resolve, through the `create-pull-request-workflow` Skill.
3. Ask for one batched decision on the rest. Apply it, then open those Pull Requests.
4. Stop. Say which Pull Requests are open, and that this Skill runs again once CI and code review finish. Do not poll.

## Pass 2: reviews and QA

1. Run the `address-pr-review` Skill on the Pull Requests.
2. A Pull Request is ready for QA when CI has passed, its code review covers the latest commit, and no finding is waiting on a decision. Skip it if its QA Report already names that commit.
3. For each one in turn, compose the plan with `qa-plan` Issue mode at `tmp/QA-PLAN-issue-<n>.md`. Run it without asking for approval. If nothing is left to verify by hand, report "no manual QA needed" and skip the run.
4. Delegate the plan to one QA sub-agent. Brief it to:
   - stop and report if `:3000` or `:4200` is in use, and never kill what is using them
   - run `yarn qa:accounts:seed` and sign in only as a QA Account
   - drive the app with a throwaway Playwright script in `tmp/qa/pr-<n>/`, never committed, or with the built-in browser when Playwright's browsers are not installed
   - capture a QA Artifact only where a written result would not be enough, such as a visual change or a multi-step flow, and none for a backend or logic-only fix
   - report each scenario as PASS or FAIL, or as left for a person when an agent cannot verify it, such as a real device or design fidelity
   - fix nothing

   If the permission check refuses the sub-agent, run the plan in the main session under the same brief and say so in the results.

5. On a failure, add it to one batched decision as in the Outcome Check. After a fix, re-run the affected scenarios plus any that share the changed code. QA Artifacts from a failed run stay local.
6. Show the results and list each QA Artifact with its path and what it shows. Ask which to upload; the default is none.
7. Upload what was chosen, then post the QA Report.

## Uploading QA Artifacts

The repository is public, so an upload is public at once. Upload only what the Maintainer chose, and only media that shows QA Accounts.

```sh
gh release view qa-evidence >/dev/null 2>&1 || \
  gh release create qa-evidence --prerelease --latest=false --title "QA artifacts" --notes "QA Artifacts for Pull Requests. See ADR 0142."
gh release upload qa-evidence tmp/qa/pr-<n>/pr-<n>-<sha>-<scenario>.png --clobber
```

The asset URL is `https://github.com/mnaimfaizy/myorganiser/releases/download/qa-evidence/<asset>`. Images display with `![scenario](url)`; a video is a link.

## The QA Report

One comment per Pull Request, starting with `<!-- qa-report -->`. Update it on a re-run instead of adding another.

```md
<!-- qa-report -->

## QA Report

Commit: `<sha>`. Run by an agent. Result: QA passed | Failures listed below

| Scenario | Result | Notes |
| -------- | ------ | ----- |

### Failures and how each was resolved

### Left for a person
```

Say "QA passed" only when every scenario passed. An agent never marks a "Left for a person" item as passed, and those items do not block the report or the merge ([ADR 0048](../../../docs/adr/0048-a-qa-plan-carries-only-what-automation-does-not-prove.md)).

Finish with each Pull Request's state, anything left for a person, and a recommended merge order. A later commit makes a QA Report stale, so say which ones are.

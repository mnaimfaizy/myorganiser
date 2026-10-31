---
name: finish-standalone-runs
description: 'Use when one or more Standalone Runs from `yarn dispatch-agents` have finished and their branches need checking, Pull Requests, review handling, and QA. Re-runnable: the first pass opens the Pull Requests, a later pass handles reviews and runs QA. Not for a PRD branch — that uses create-pull-request-workflow, then qa-plan.'
---

# Finish Standalone Runs

Take finished Standalone Runs from `ready-for-human` to Pull Requests that have been QA'd and are ready to merge. Orchestrate only: the procedures belong to the Skills and documents this one names. See [ADR 0142](../../../docs/adr/0142-a-standalone-runs-qa-is-run-by-agents-and-reported-on-its-pull-request.md).

GitHub holds the state, so a new session can run this Skill at any point. There is no progress file.

**Never** merge, change an issue's labels, or switch the Maintainer's checkout.

## The worktree

Fixes and QA run in one reusable worktree, one branch at a time, because the app needs ports and a local database. It is the first QA stack; see [Scheduling QA sessions](#scheduling-qa-sessions) for when a second is worth having.

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

When Pass 2 ends, stop only the processes recorded or shown to run from the worktree, by PID, shut down any simulator or emulator a QA session booted, remove the container and any extra stack's worktree, and offer to archive the finished QA sessions. Leave `tmp/qa/pr-<n>/` in place, since the Maintainer reads the QA Artifacts there.

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
4. Schedule the plans as in [Scheduling QA sessions](#scheduling-qa-sessions), and give each one to its own QA session.
5. Check each report against its plan before relying on it. On a failure, add it to one batched decision as in the Outcome Check. After a fix, re-run the affected scenarios plus any that share the changed code. QA Artifacts from a failed run stay local.
6. Show the results and list each QA Artifact with its path and what it shows. Ask which to upload; the default is none.
7. Upload what was chosen, then post the QA Report.

## Scheduling QA sessions

A QA session is a separate agent session that runs one Pull Request's plan and reports back to this one. It is not a sub-agent, because a sub-agent cannot use the built-in browser, a simulator or an emulator. This session stays the orchestrator: it holds the schedule, the decisions and the QA Report.

Before starting any, sort the plans by what each one needs:

| Plan needs      | Holds                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| Web app         | A stack: a worktree, ports, a database                                      |
| Mobile app      | A stack, the Metro port, and a simulator or emulator for each platform used |
| Nothing by hand | Nothing; no session is started                                              |

Then schedule by these rules:

1. **Pilot first.** Start the smallest plan alone. It proves the stack and the brief before any other session spends time on them. Fix what it exposes before starting the next.
2. **One holder per resource.** A worktree, a port, a database and a device each have one QA session at a time. Sessions sharing a database also share the QA Accounts' vaults, so a session starts with `yarn qa:accounts:seed --restore`.
3. **One at a time by default.** Start the next session when the last has reported and released its stack.
4. **Overlap only when it saves real time.** Plans that need different branches need separate stacks, each with its own installed worktree, ports and database. The web port is pinned in `apps/web/project.json` and the API address comes from env, so confirm a second stack starts before giving it a session. Run at most two stacks, and keep to one when disk or memory is short.
5. **Same feature, one after another.** When two plans cover the same screens or data, run them in turn, even with a spare stack, so a failure has one cause.
6. **Say the schedule first.** State the order and the reason in one line, then start. Revise it as reports come in.

Start each session in the stack's existing worktree, without a new worktree of its own. Brief it with the plan's path, the branch and commit, the stack it holds, and these rules:

- check that the commit is what the stack serves, and report instead of testing anything else
- stop and report if a port it needs is in use, and never kill what it did not start
- sign in only as a QA Account
- use the app as a person would, through its real screens, in the built-in browser or on a simulator or emulator, and look at the result as well as checking the code's output
- for a mobile plan, follow `apps/mobile/AGENTS.md` and cover each platform the change affects, in light and dark where the plan asks
- capture a QA Artifact only where a written result would not be enough, such as a visual change or a multi-step flow, and none for a backend or logic-only fix, saved in `tmp/qa/pr-<n>/`
- write each scenario as PASS or FAIL, or as left for a person when a session cannot verify it, such as a real device, a screen reader or design fidelity, to `tmp/qa/pr-<n>/report.md`
- fix nothing, and post, upload or merge nothing
- stop the processes it started, release the stack, and end with the report's path and the overall result

A session's closing message may be cut short, so read the report file instead. If the harness has no separate sessions, or a session is refused, run the plan in this session under the same brief, one at a time, and say so in the results.

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

---
name: finish-standalone-runs
description: 'Use when one or more Standalone Runs from `yarn dispatch-agents` have finished and their branches need checking, Pull Requests, review handling, and QA. Re-runnable: the first pass opens the Pull Requests, a later pass handles reviews and runs QA. Not for a PRD branch — that uses create-pull-request-workflow, then qa-plan.'
---

# Finish Standalone Runs

Take finished Standalone Runs from `ready-for-human` to Pull Requests that have been QA'd and are ready to merge. Orchestrate only: the procedures belong to the Skills and documents this one names. See [ADR 0142](../../../docs/adr/0142-a-standalone-runs-qa-is-run-by-agents-and-reported-on-its-pull-request.md), as amended by [ADR 0147](../../../docs/adr/0147-a-qa-plans-scenarios-are-scripted-and-run-on-the-code-before-and-after-the-change.md).

GitHub holds the state, so a new session can run this Skill at any point. There is no progress file.

**Never** merge, change an issue's labels, or switch the Maintainer's checkout.

## The worktree

Fixes and QA run in one reusable worktree, one Pull Request at a time, because the app needs ports and a local database. It holds the one QA stack; see [Scheduling QA sessions](#scheduling-qa-sessions).

```sh
git worktree add --detach tmp/qa/worktree origin/main   # first use only
git -C tmp/qa/worktree fetch origin
```

Give the worktree its own install, never a symlink to another checkout's `node_modules`: the stack generates the Prisma client into it, which would overwrite that checkout's client with the merge-base's schema.

The QA stack checks out commits itself, detached, so the worktree never holds a branch. Reach it with `git -C` and absolute paths; a `cd` moves the session's working directory. Name the commit to any sub-agent that inspects it.

### The QA stack

A QA session runs its scenarios with one command, `yarn qa:run`. It starts the stack, switches it from Before to After, and grades and combines what it captured; see [Starting QA sessions](#starting-qa-sessions). The stack commands under it are the manual route, and `yarn qa:stack:stop` ends every run. All of them are documented in [the command reference](../../../docs/agents/command-reference.md#qa-tooling).

```sh
corepack yarn qa:run --worktree <abs>/tmp/qa/worktree --change-kind fix|feature --merge-base <sha> --head <sha> --scenarios tmp/qa/pr-<n>/scenarios --out tmp/qa/pr-<n> [--with-before]
corepack yarn qa:stack:start --worktree <abs>/tmp/qa/worktree --change-kind fix|feature --merge-base <sha> --head <sha> [--with-before]
corepack yarn qa:switch --worktree <abs>/tmp/qa/worktree --to after
corepack yarn qa:stack:stop
```

- The stack serves web on `http://localhost:4300` and the backend on `3300`, with its own Postgres container on `127.0.0.1:5499`, so it never collides with the Maintainer's services.
- It builds its environment from `.env.example` with generated local-only secrets and writes it to `tmp/qa/stack/`. Never read the Maintainer's env files or work around the hook that protects them. If the stack cannot run the app, stop and report it.
- It refuses a database that is not local, the primary checkout, a worktree with uncommitted changes, and a port already in use. Report a refusal; never work around it.
- It seeds the QA Accounts once, at start. `qa:switch` migrates forward and restarts both services without re-seeding, so Before and After share the same data.
- Every start and switch ends by checking the commit the stack serves. A mismatch exits 1: run no scenario on it. `yarn qa:stack:status` re-checks at any time.
- A switch back to Before after After is refused. When a feature's After fails, `yarn qa:run` stops the stack and starts a fresh one with `--before-only` for the merge-base re-run; by hand, do the same.

### Cleaning up

When Pass 2 ends, run `yarn qa:stack:stop`, which stops only the processes the stack recorded and removes only its own container. Shut down any simulator or emulator a QA session booted, remove any extra stack's worktree, and offer to archive the finished QA sessions. Leave `tmp/qa/pr-<n>/` in place, since the Maintainer reads the QA Artifacts there.

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
5. Check each report against its plan before relying on it. On a failure, add it to one batched decision as in the Outcome Check. After a fix, re-run the affected scenarios plus any that share the changed code.
6. `yarn qa:run` has already combined each Before/After pair into `tmp/qa/pr-<n>/combined/` (a feature graded After only has no pair, so nothing to combine; combine a pair made by hand with `yarn qa:combine`). Show the results and list each combined QA Artifact with its path and what it shows. Offer for upload only the files `tmp/qa/pr-<n>/run.json` marks `uploadEligible`, which follow [the upload rules](#uploading-qa-artifacts): a FAIL: regression's QA Artifact stays local. Ask which to upload; the default is none.
7. Upload what was chosen, then post the QA Report. Fill in [the QA Report](#the-qa-report) template for each one. Never post a local working note as the report.
8. Finish as in [Closing report](#closing-report).

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
2. **One holder per resource.** A worktree, a port, a database and a device each have one QA session at a time. `yarn qa:stack:start` seeds the QA Accounts with `--restore`, so each session starts from empty vaults.
3. **One at a time by default.** Start the next session when the last has reported and released its stack.
4. **No overlap yet.** The QA stack's ports and container name are fixed, and `yarn qa:stack:start` refuses a port already in use, so a second stack cannot start beside the first. Plans that need different Pull Requests run one after another.
5. **Same feature, one after another.** When two plans cover the same screens or data, run them in turn, even with a spare stack, so a failure has one cause.
6. **Say the schedule first.** State the order and the reason in one line, then start. Revise it as reports come in.

### Starting QA sessions

QA sessions start in the foreground of the turn the Maintainer began ([ADR 0147](../../../docs/adr/0147-a-qa-plans-scenarios-are-scripted-and-run-on-the-code-before-and-after-the-change.md) decision 8). Do everything up to the last session start in that turn. A start that is refused, or that falls in a later turn, such as each plan after the pilot, becomes a proposal card the Maintainer clicks. While separate sessions exist, this session never runs a plan itself.

Start each session in the stack's existing worktree, without a new worktree of its own. Brief it with the plan's path, the Pull Request's merge-base and head commits, whether it is a fix or a feature, the stack it holds, and these rules:

- **Scripted Chromium is the primary driver.** Write each scenario as a script in `tmp/qa/pr-<n>/scenarios/<id>.ts` that carries the plan's `Capture:` line (its shape is in the command reference), and never commit it. Run them all with `yarn qa:run`. It starts the stack, runs each scenario on Before and After, and keeps only what each `Capture:` line asks for, plus a failed run's recording, in `tmp/qa/pr-<n>/local/` unless the line already asks for the video
- **Before and After.** For a fix, `yarn qa:run` runs every scenario first on the merge-base (Before), then on the head (After), with the same QA Account, data and viewport. For a feature it runs After only, and re-runs a failed scenario on the merge-base; pass `--with-before` when a scenario claims existing behaviour still works
- if `yarn qa:run` reports that the stack did not start, or a switch failed closed, report that instead of testing anything else
- stop and report if a port it needs is in use, and never kill what it did not start
- sign in only as a QA Account
- **Inspect before trusting.** Open every screenshot and frame the run kept, and each failed run's recording, before trusting a result. A script that passed while the screen shows something else is a failed scenario
- **The built-in browser is for judgement only**, for what no script can decide. Reach it through the `qa-web` entry in `.claude/launch.json`, which attaches to the running stack without starting a second server. If it cannot load the app, judge from the captures, and list what captures cannot show under Left for a person. The QA Report names the route used
- for a mobile plan, follow `apps/mobile/AGENTS.md` and cover each platform the change affects, in light and dark where the plan asks. The Before and After rule applies on the simulator and emulator too, with a native rebuild on each side when the change is native
- keep the QA Artifacts the `Capture:` lines ask for, which `yarn qa:run` does, in `tmp/qa/pr-<n>/`; choose none mid-run
- write each scenario's result from `tmp/qa/pr-<n>/run.json`, which `yarn qa:run` graded, to `tmp/qa/pr-<n>/report.md`, with the headline it gives. A scenario the session cannot verify, such as one needing a real device, a screen reader or design fidelity, is left for a person
- fix nothing, and post, upload or merge nothing
- stop the stack with `yarn qa:stack:stop`, and end with the report's path and the overall result

A session's closing message may be cut short, so read the report file instead. Only if the harness has no separate sessions at all, run the plan in this session under the same brief, one at a time, and say so in the results. A refused start is a proposal card, not a reason to run it here.

## Uploading QA Artifacts

The repository is public, so an upload is public at once. Upload only what the Maintainer chose, and only media that shows QA Accounts. The default is none.

Which files may be offered (ADR 0147 decisions 5 and 6, rule in `tools/qa/lib/upload-eligibility.ts`):

- Only a combined file, made by `yarn qa:combine`: a screenshot pair is one labelled side-by-side PNG, a video pair is one side-by-side MP4 plus a GIF preview. A lone Before or After is never offered.
- A Before that shows the defect is not a failed run, so its combined file may be offered.
- A FAIL: pre-existing's combined file may be offered, since it documents the filed issue.
- A FAIL: regression's QA Artifact stays local. Do not offer it.
- A Not proven or Left for a person scenario is not a failed run, so its combined file may be offered too (ADR 0142 decision 3 and ADR 0147 decision 6): only a regression is withheld.

Eligible is not uploaded: ask, and upload only what the Maintainer picks.

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

### Request Transcript

A scenario whose `Capture:` line is `transcript` (an API change, with no screen to show) keeps a Request Transcript: the calls it made and what came back, Before and After. Write the calls to a JSON file in the shape `yarn qa:redact` documents in [the command reference](../../../docs/agents/command-reference.md), then run `yarn qa:redact --input <file>`. It prints one collapsed `<details>` block.

- Paste that block into the QA Report under the scenario, inline. A Request Transcript is never uploaded and has no upload choice (ADR 0147 decision 7): it holds only QA Account data, and the Maintainer reads the report's text before it is posted.
- If `yarn qa:redact` exits 1, it refused a field or URL parameter name it does not recognise as safe and printed nothing. Remove it from the calls, or, if it is safe, have it added to the allow-list in `tools/qa/lib/redact-transcript.ts`. Do not edit the output by hand to get past a refusal.
- Never paste a call that did not go through `yarn qa:redact`, and never include a real person's token, cookie or Ciphertext: only the QA Account's.

Say "QA passed" only when every scenario passed. An agent never marks a "Left for a person" item as passed, and those items do not block the report or the merge ([ADR 0048](../../../docs/adr/0048-a-qa-plan-carries-only-what-automation-does-not-prove.md)).

## Closing report

Pass 2 ends with a table: one row per Pull Request, giving its state (CI, review, QA result, and the commit the QA Report names), anything left for a person, and whether its QA Report is stale. Any commit after the commit the report names makes it stale.

Then recommend a merge order. Number the Pull Requests, and give each a one-line reason. Order them by these rules, in this order:

1. **Hold back** a Pull Request that has a failed or stale QA Report, red CI, or a finding waiting on a decision. List it after the others, and say what it is waiting on.
2. **Conflicts decide first.** When two branches touch the same files, merge first the one that the other then has to rebase onto. Name the rebase this causes.
3. **Then risk.** Documentation-only and tooling changes go first, then narrow fixes, then changes to a shared library (`libs/web/ui`, `libs/auth`, `libs/app-api-client`) or to a backend contract.
4. **Keep related branches next to each other.** For example, two branches that move the same feature to the generated client merge one after the other.

End with the one command that merges them, in that order: `yarn merge:train <pr> <pr> …`, leaving out every Pull Request held back by rule 1. Each QA Report was run on its branch alone, so the train brings each branch up to date with `main` and waits for its required checks before merging it, and stops at the first red one. Do not tell the Maintainer to merge by hand or with the admin bypass: a merge behind `main` lands a tree no check ran on ([ADR 0144](../../../docs/adr/0144-a-batch-of-pull-requests-merges-through-the-merge-train-not-the-admin-bypass.md)).

---
name: orchestrate
description: 'Make this session the Chief of Staff for a set of issues or a whole PRD Issue: analyse them, get one go on a Dispatch Plan, hand each piece to a Live Session, a dispatch-agents run or a Sub-agent, relay Decision Requests to the human, keep the board, and close out to one merge order. Human-invoked only. Not for building the work in this session — that is implement.'
disable-model-invocation: true
argument-hint: '<#issue …> | --prd <n> [go] | --resume <run> | --status'
---

# Orchestrate

This session becomes the **Chief of Staff** for the work named. It owns four things: the plan, the channel to the human, the status of every **Delegation**, and the merge order. It never builds a Delegation's work itself. Building, closing and merging stay with the Skills and documents this one names. See [ADR 0145](../../../docs/adr/0145-a-chief-of-staff-owns-the-plan-and-the-human-channel-and-never-builds.md).

The Chief of Staff is still the human's main agent. A question, a lookup or a handful of tool calls it answers itself.

**Never** merge, force-push, change repository settings, or destroy a branch, worktree or checkpoint without the human's yes.

Invoke it as `/orchestrate` (Codex: `$orchestrate`):

| Form                          | Meaning                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `/orchestrate #12 #34 …`      | Run these issues                                           |
| `/orchestrate --prd <n>`      | Run a whole PRD Issue and its Slice Issues                 |
| …plus `go`                    | Start after analysis, without waiting on the Dispatch Plan |
| `/orchestrate --resume <run>` | Pick a run up from its board, on any Harness               |
| `/orchestrate --status`       | Print the board and act on nothing                         |

Plain words after the arguments are notes for the plan, such as "do #12 first".

## The run folder

All state lives in GitHub plus one local folder, `tmp/orchestrate/<run>/`. `tmp/` is gitignored, so nothing in it is committed or posted. `<run>` is `YYYY-MM-DD-<slug>`.

| File                     | Holds                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `status.md`              | The board: each Delegation's issue, Executor, branch, Pull Request, state and open Decision Requests |
| `log.md`                 | The Chief of Staff's Activity Log                                                                    |
| `<delegation>/report.md` | What the Delegation reports back. Read this, because a closing message may be cut short.             |
| `<delegation>/log.md`    | The Delegation's own Activity Log                                                                    |
| `<delegation>/drafts/`   | Writes the Delegation wants made as the human, waiting for the Chief of Staff                        |

A Delegation in its own worktree may be refused writes to the primary checkout's `tmp/`. In the PRD #1507 run, a hook refused two of seven. When that happens, it writes its files into a folder it can write to, such as its Harness's own notes folder, with names prefixed `<delegation>-`, and gives the path. The Chief of Staff copies them into `<delegation>/` before checking them. That copy is the agreed route, so it is not a Decision Request, and the Delegation never routes around the refusal.

Update `status.md` after every event. Before acting on any Delegation, re-read its row, its branch, its Pull Request and CI. A message may cross with work already done, so never act on a stale snapshot.

An **Activity Log** line is `<UTC time> · <who> · <what> · <why> · <link>`. Log every message sent and the gist of each reply, every check and what it found, every nudge, re-run and background watch, every post made as the human with the approval it rests on, and every decision not to act. A Delegation logs every Sub-agent it starts and what came back, every background command, every permission block, and every judgement it made without asking.

## 1. Analyse

For each issue, read the body, every comment, the triage `## Agent Brief`, the `## Maintainer Review` notes, the labels, the links, and the history of any issue it reopens or depends on. Read the PRD Issue and its slices' `## Blocked by` edges. Read [`CODING_STANDARDS.md`](../../../CODING_STANDARDS.md) and the ADRs and Skills each issue touches. For wide searches, delegate to `CodeExplorer`.

Readiness sets the Delegation's scope:

| Issue state                                                  | Delegation                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `ready-for-agent` with a brief                               | Build end to end, to a Pull Request                                                                                        |
| `ready-for-human`, `grilling`, or triage says "for a person" | Evidence and options only, then a Decision Request. Build only after the human answers.                                    |
| A precondition: a date, data, or another issue               | Prepare, then park until the condition holds                                                                               |
| No brief, or unclear                                         | No Delegation. Raise a Decision Request: triage it with `my-triage`, or let the Chief of Staff draft a brief for approval. |

## 2. The Dispatch Plan

Write one row per Delegation into `status.md` and show it to the human. Each row gives the issue, the scope, the gate tier, the Executor and model, the wave, and where it will stop for the human.

- **Executor.** Choose from the Harness's tier in [harnesses.md](harnesses.md): a Live Session, a `dispatch-agents` run (Standalone Run or PRD slice), or a Sub-agent in this session. Say which, and why.
- **Model.** Take it from the issue's `complexity:*` label through `tools/config/agent-model-policy.json`, the mapping `dispatch-agents` uses. That mapping covers Claude only. On another Harness use the policy's default for it where one exists, otherwise the Harness's own default, and say which in the plan. A read-only Delegation gets the cheaper model.
- **Waves.** Order by `## Blocked by`. Two Delegations that touch the same files never share a wave, unless every shared file only gains appended lines on both sides, such as a new `package.json` script, a new command-reference entry or a new CI step. That overlap is a mechanical conflict the Chief of Staff resolves at integration (see Merge conflicts). Name each such shared file in the plan.
- **Limits.** At most 4 building Delegations at once, plus any number of read-only ones. The plan may raise this with the human's approval. Each shared resource has one holder at a time: a local backend on `:3000`, a production build, a QA stack, or a CI-heavy experiment. QA stacks follow [Scheduling QA sessions](../finish-standalone-runs/SKILL.md#scheduling-qa-sessions). Stagger pushes that would land within minutes of each other, because CI runs share 20 concurrent jobs.
- **Routine writes.** List the kinds of write the run will make as the human, such as new issues, routine comments, label changes and closing issues. Approving the plan approves those kinds. Every `## Maintainer Review` still needs its own yes.

Wait for one "go", unless the invocation said `go`.

### A PRD

A PRD runs in parallel waves on its local integration branch `feat/<prd-slug>`, with one Pull Request to `main` ([ADR 0010](../../../docs/adr/0010-sandcastle-local-only-integration.md)). Each slice Delegation works on its own `slice/<n>-<slug>` branch, cut from the current `feat/<prd-slug>` head. A `dispatch-agents` run integrates its own slices. When the Chief of Staff cuts `feat/<prd-slug>` itself, it first writes the empty anchor commit `dispatch-agents` writes, ending `Closes #<prd>` ([ADR 0076](../../../docs/adr/0076-an-agent-branch-carries-its-issue-in-its-first-commit.md); `anchorBranchToIssue` in `.sandcastle/main.mts`). It does this before any slice is cut. Without it, the first slice's commit becomes the branch's spec, and the Pull Request's code review flags every other slice as behaviour nobody asked for. For any other Executor, the Chief of Staff fast-forwards `feat/<prd-slug>` onto each finished slice, in plan order, in its own integration worktree. After each fast-forward it re-gates there with the slice's own tests, `corepack yarn gates:run`, and `corepack yarn design:hygiene --all`. Pre-commit checks House Explainer Pages only `--staged`, so a slice that moves a line a page cites passes locally and fails CI. An Executor that works from a clone cannot see a local branch. Before giving such an Executor a slice, raise a Decision Request: push `feat/<prd-slug>` for this run, or run the slice locally. Say that a pushed branch is visible on the public remote until it is deleted after the PRD merges ([ADR 0146](../../../docs/adr/0146-a-prd-integration-branch-may-be-pushed-for-one-run-with-the-maintainers-consent.md)).

## 3. Dispatch: the Brief Contract

Every brief carries all eight items:

1. **Read first:** the issue with its comments and history, [`AGENTS.md`](../../../AGENTS.md), `CODING_STANDARDS.md`, `CONTEXT.md` where domain terms are touched, the gate tier from `.claude/checklist.md` Step 0, and the ADRs and Skills that apply.
2. **The goal and what "done" means:** for example "a Pull Request closing #N", or "evidence and options, then stop".
3. **Phases with explicit STOP points**, for readiness-limited work. Every building brief ends with a code-review phase before its final commit, whatever the gate tier. The Delegation runs the `code-review` Skill on its range against its issue, fixes every finding or raises a Decision Request, and records the verdicts under `## Code review` in its `report.md`.
4. **Scope fences:** the files other Delegations hold right now, and what is out of scope.
5. **The repository's command routes:** commits through `commit-change-workflow`, Pull Requests through `create-pull-request-workflow` and `ai:create-pr`, and the specialist Skills for the gate tier. Never hand a Delegation a raw `git` or `gh` command those routes replace.
6. **The rules for writes.** A Delegation may push its own branch, open its own Pull Request, and reply on its own Pull Request's review. Any other write that speaks as the human goes in `<delegation>/drafts/` and is raised as a Decision Request. When a permission check blocks it, do not retry or route around it.
7. **The Decision Request form:** one question, the options, and a recommendation, sent to the Chief of Staff, and then wait.
8. **Its files:** its `report.md` and `log.md` paths.

For a slice with a ready issue, the brief can be `/implement #<n>` plus a short overrides file. The issue is the spec, and the overrides carry only what differs from the `implement` Skill: the code-review phase above, the Chief of Staff makes every issue write, and the commit lands on the slice branch with no push and no Pull Request.

A Delegation sends a short plan before it writes code (approach, files, tests and risks) when any of these hold:

- it is `gate:full`;
- it parses or filters untrusted text, such as redaction, authentication or URL handling. Its plan says whether it decides by allow-list or deny-list. If the issue prescribes a deny-list, the Chief of Staff raises a Decision Request before any code, because each review round of a deny-list finds another encoding it missed;
- it ships an executor against Docker, ports or a database. Its plan includes one live smoke run, raised as a Decision Request because the QA stack is a shared resource, in that same slice. A stubbed executor suite cannot show that the real tool runs, so leaving the live run to whoever uses the tool next hides the defect a slice later. The smoke run's QA worktree gets its own install, never a symlinked `node_modules` ([The QA stack](../finish-standalone-runs/SKILL.md#the-qa-stack)).

The Chief of Staff checks the plan against the standards, the ADRs and the spec. It answers what is within its own authority, and raises the rest as a Decision Request.

## 4. Run the loop

When a Delegation stops, read its report and log, then check them against its branch, its Pull Request, CI and the issue. Pass on only what checks out.

**The Chief of Staff acts on its own to:**

- check every report against git, GitHub and CI;
- send a review finding with one clear fix back to its Delegation;
- nudge a stalled Delegation, after re-reading its state, naming what is missing and the command route to use;
- re-run a review or CI job, or start one bounded background watch on a run. Never poll in a loop;
- update the board and both logs.

**It always brings the human:**

- every Decision Request;
- every write that speaks as the human;
- anything that widens scope, adds a Delegation, or spends something notable, such as a download, a large batch of CI runs, or a paid service;
- any finding the Delegation and the Chief of Staff disagree on;
- every merge.

**Writes as the human.** The Chief of Staff makes them, never a Delegation. The one exception is a `dispatch-agents` run's own status labels and completion comment, which that tool writes by design ([ADR 0010](../../../docs/adr/0010-sandcastle-local-only-integration.md)). That covers issue comments, `## Maintainer Review` notes, new issues, label changes and closing issues. Show each `## Maintainer Review` and post it only after the human approves its exact text. Make routine writes under the kinds the plan approved, and list each one in the next report. Post a Delegation's draft word for word, then tell the Delegation it is done. A decision recorded only in a Pull Request is invisible to the spec reviewer and to `dispatch-agents`, which read only the issue body, the brief and `## Maintainer Review` ([ADR 0137](../../../docs/adr/0137-an-issue-is-specified-by-its-body-and-its-trusted-triage-brief.md)). Record each answer there.

**Relaying a Decision Request.** Restate it so it stands alone: name the issue and what was found, give the options with their costs, and put the recommendation first. Relay the answer to the Delegation along with what it means for its next step.

### When a Delegation stalls or fails

1. **Check first.** Read its log, report, branch, Pull Request and CI. Often it has finished, or a real background job is still running.
2. **Nudge once**, naming exactly what is missing.
3. **If it is still stuck,** raise a Decision Request: resume in a fresh Live Session from its branch, with its Activity Log as the handoff; switch Executor; or park it, back to `ready-for-agent` or `ready-for-human` with a comment the human approves.
4. **Two failed rounds on the same finding** stop the Delegation ([ADR 0017](../../../docs/adr/0017-gated-pipeline-cap-and-slice-code-review.md)). Show both attempts side by side.
5. **Never destroy work.** A crashed Delegation's branch is its handoff ([ADR 0035](../../../docs/adr/0035-interrupted-slices-resume-from-git-and-destruction-is-deliberate.md)).
6. **A usage quota running out pauses the run.** The board records where everything stood, and `--resume` continues it.

### Merge conflicts

Before integrating a branch, and again before giving the merge order, run `git merge-tree --write-tree --quiet` on each finished branch: against its target, and against the other branches still in flight.

- **A mechanical conflict** is one with a deterministic fix: a generated output, a lockfile, or pure additions on adjacent lines. The Chief of Staff fixes it in its own integration worktree, then logs it.
- **A semantic conflict** is one where both sides changed the same behaviour. It goes to the Delegation whose branch is integrated later. Send that Delegation the conflicting files and the other side's intent: which slice or Pull Request, which commit, and what it was for.
- **Intents that contradict each other** go to the human as a Decision Request, with both intents side by side.

Re-gate every resolved branch before integrating it.

## 5. Close out

Close out through the existing Skills: `finish-standalone-runs` for Standalone Runs and issue branches, and `create-pull-request-workflow` then `qa-plan` for a PRD. A Delegation is **Ready to Merge** when all four hold:

1. CI is green;
2. the automated review approves, or every remaining finding is fixed or accepted in a `## Maintainer Review`;
3. its QA Report is on the Pull Request and is not stale, as `finish-standalone-runs` defines it, even when it records "no manual QA needed". For a PRD, the QA Report on the Pull Request gives the headline and links the QA Plan Issue's Execution record, which stays the full record;
4. `git merge-tree` against `main` is clean.

When every Delegation is Ready to Merge, give the human one merge order, built by the rules in [Closing report](../finish-standalone-runs/SKILL.md#closing-report), as a `yarn merge:train <pr> …` command ([ADR 0144](../../../docs/adr/0144-a-batch-of-pull-requests-merges-through-the-merge-train-not-the-admin-bypass.md)).

After the human merges:

- check `main`'s CI on the final commit;
- with the human's yes, post a **Run Summary** on the PRD Issue or umbrella issue: the Delegations, their Pull Requests, the human's decisions, and what is left open. It points to the local Activity Log rather than copying it;
- offer to archive the Live Sessions, and to delete `tmp/orchestrate/<run>/` and the worktrees.

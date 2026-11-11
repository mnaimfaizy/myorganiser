# A Chief of Staff owns the plan and the human channel, and never builds

## Status

accepted

## Context

On 2026-11-10 one session coordinated five issues (#1358, #1376, #1381, #1412, #1473) across separate agent sessions. It read every issue first, handed each piece to a session, relayed every decision that was the Maintainer's to make, recorded those decisions where the reviewers read them, and checked every report against git, GitHub and CI before passing it on. It worked, and it surfaced patterns that a repeatable Skill must fix:

- **Sessions were blocked from GitHub writes that speak as the Maintainer** (issue comments, `## Maintainer Review` notes, new issues) in every round. Each time, the session drafted the write, the coordinating session showed it to the Maintainer, and posted it after a yes. Writes posted without that step would have reached the spec reviewer and `dispatch-agents` as the Maintainer's instruction ([ADR 0137](0137-an-issue-is-specified-by-its-body-and-its-trusted-triage-brief.md)).
- **Readiness changed the scope.** Triage had marked #1376 and #1381 "for a person, not the agent", so their sessions gathered evidence and stopped. A session that built straight away would have decided the Maintainer's question.
- **Reports and reality diverged.** Sessions ended a turn "waiting on a sub-agent" with nothing running. Nudges crossed with work already done. Once the coordinating session itself gave a wrong command (`git push` where the repository requires `ai:create-pr`).
- **Merges landed behind `main`.** Three of the four Pull Requests merged within four minutes, each behind `main`.

The repository already had the closing pieces: `finish-standalone-runs`, `qa-plan`, the Outcome Check and the Merge Train. Nothing owned the layer above them.

## Decision

The `orchestrate` Skill makes a session the **Chief of Staff** for a set of issues or a PRD Issue (terms in `CONTEXT.md`).

1. **It is a layer above everything that exists.** It owns the plan, the channel to the human, the status of each Delegation, and the merge order. Building, closing and merging stay in the Skills it names, and it does not restate their procedures ([ADR 0020](0020-one-instruction-file-one-skill-tree.md)).
2. **It never builds a Delegation's work.** It may fix a mechanical merge conflict in its own integration worktree, and it logs each fix. A semantic conflict goes back to the Delegation whose branch is integrated later.
3. **It owns every write that speaks as the human.** Delegations push their own branches, open their own Pull Requests, and reply on their own reviews. Anything else is drafted and raised as a Decision Request. Each `## Maintainer Review` needs a yes on its exact text. Routine kinds of write are approved once, with the Dispatch Plan.
4. **It never merges.** It gives one `yarn merge:train` order ([ADR 0144](0144-a-batch-of-pull-requests-merges-through-the-merge-train-not-the-admin-bypass.md)).
5. **Nothing starts without one "go" on the Dispatch Plan,** unless the invocation said `go`. The Skill is human-invoked only.
6. **The state lives in GitHub plus a local, gitignored run folder.** The board and Activity Logs live in `tmp/orchestrate/<run>/`, so any Harness can resume a run. Nothing in the folder is committed or posted.
7. **It is harness-agnostic through four verbs:** `spawn`, `message`, `await`, `report`. A reference file maps them per Harness, in three tiers: Live Sessions, start and poll, and sequential.

## Considered Options

- **Replace `finish-standalone-runs` with one larger Skill.** Rejected: two copies of the close-out procedure would drift.
- **Let Delegations post wherever their permissions allow.** Rejected: the Maintainer could not predict which writes in their name would appear, and the spec reviewer reads them as instructions.
- **Live Sessions only.** Rejected: most Harnesses have no native session tool, and `dispatch-agents` already runs AFK work on any of them.
- **A wrapper script, such as `orchestrate:spawn --harness X`.** Deferred: it would drift as the vendors' CLIs change. Worth building only if the start-and-poll recipes prove error-prone.

## Consequences

- A Harness without separate sessions still runs the Skill, sequentially, and says so in the Dispatch Plan.
- The Activity Log is local only. The Maintainer reads it on their machine, and a Run Summary on the issue points to it.
- "Orchestrator" keeps its meaning inside one Skill chain (One-shot Specialist, Orchestrator Patch). The Chief of Staff is a different role.

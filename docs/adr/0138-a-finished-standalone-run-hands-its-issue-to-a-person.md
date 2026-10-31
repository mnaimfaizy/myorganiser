# A finished standalone run hands its issue to a person

## Status

accepted

Amended by [ADR 0142](0142-a-standalone-runs-qa-is-run-by-agents-and-reported-on-its-pull-request.md): a person or the `finish-standalone-runs` Skill opens the PR. The labels are unchanged.

## Context

A standalone run (`yarn dispatch-agents --issue <n>` or `--all-standalone`) leaves its work on one
local branch and pushes nothing (ADR 0010). When the agent finished and the build gate passed, the
orchestrator removed only `status:in-progress` and posted a comment. The issue kept
`ready-for-agent` and `type:afk`, so:

- nothing on the tracker told a finished issue from one never started; the comment or the run log
  was the only record;
- the next sweep selected the issue again and resumed on the existing branch (ADR 0035), spending a
  second agent run on finished work.

The runbook had ruled out `status:done` here, and that still holds. `status:done` means the work is
integrated into the local feature branch (ADR 0002), and the dependency logic counts a `status:done`
issue as finished (`isCompleted`), so it would release dependents for work that exists only on an
unpushed branch.

## Decision

When a standalone run finishes with commits and a passing gate, the issue swaps `ready-for-agent`
for `ready-for-human` and loses `status:in-progress`. It stays open, without `status:done`. The
comment names the branch, its base, and anything the agent listed as outstanding (ADR 0111), and
says that a person reviews the branch and opens its PR next. The PR's `Closes #<n>` closes the
issue on merge.

`ready-for-human` is already the state role for "a person acts next" (ADR 0002), and ADR 0111 uses
it the same way for a PRD slice held open. One label now marks every issue whose agent work is
waiting on a person, and the sweep (which requires `ready-for-agent`) no longer selects it.

A run that ends with no commits, a failing gate, or a crash is unchanged: the issue keeps
`ready-for-agent`, so a re-run resumes it.

## Consequences

- A finished standalone issue is found by its label, `ready-for-human`, instead of by reading its
  comments or the run log.
- To send it back to an agent, a person moves it back to `ready-for-agent`, typically with a
  `## Maintainer Review` comment.
- The labels live in one place, `STANDALONE_HANDOFF_LABELS` in
  `tools/scripts/lib/sandcastle-outcome.ts`, with a test that it never adds `status:done`.

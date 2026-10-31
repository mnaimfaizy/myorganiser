# A Standalone Run's QA is run by agents and reported on its Pull Request

## Status

accepted

Builds on [ADR 0048](0048-a-qa-plan-carries-only-what-automation-does-not-prove.md): a single issue's QA Plan still stays in `tmp/`. Amends [ADR 0138](0138-a-finished-standalone-run-hands-its-issue-to-a-person.md) on who opens the Pull Request. The PRD path keeps its QA Plan Issue.

## Context

A finished Standalone Run waits as `ready-for-human`, and the Maintainer was asking an agent by hand to check the branch, open the Pull Request, handle review comments and verify the fix. Nothing recorded that QA had happened, because a single issue's QA Plan is never published. The repository also had no way to put a screenshot or video on a Pull Request; `qa-plan` pointed at a `walkthrough-artifacts` Skill that is not here, and the repository is public.

## Decision

The `finish-standalone-runs` Skill runs QA with one sub-agent per Pull Request, without asking for approval of the plan.

1. **QA follows the Pull Request.** It runs once CI and code review have settled, so it tests the code that will merge. `docs/sandcastle/RUNBOOK.md`'s "QA the integrated branch locally", before the push, remains the PRD order.
2. **The result is a QA Report.** One text comment names the commit, the scenarios and the result, and a later commit makes it stale. The Maintainer sees the results before it is posted. Nothing enforces it, as ADR 0048 decided for QA Plans.
3. **A QA Artifact is private by default.** It stays in `tmp/qa/pr-<n>/`. Most exist so the Maintainer can check a fix while working on something else, so each upload is their choice, and the default is none. A failed run's QA Artifact stays local.
4. **An uploaded QA Artifact goes on the `qa-evidence` prerelease.** Upload is public at once, so only QA Accounts may appear.

## Considered Options

- **An orphan branch for uploads.** It displays images inline, but binaries stay in repository history permanently.
- **CI artifacts.** They expire, and a local QA run does not produce them.
- **Driving GitHub's comment box in a browser.** It gives inline video, but it is fragile and needs a signed-in session.
- **QA before the Pull Request.** `qa-plan` needs a Pull Request for its merge base, and any fix from the later review would invalidate the result.

## Consequences

- A video appears as a link in a QA Report, not inline.
- An issue's labels do not change: it stays `ready-for-human` until its Pull Request closes it on merge.
- An agent cannot verify a real device or design fidelity, so the QA Report lists those under "Left for a person". An agent never marks them passed.

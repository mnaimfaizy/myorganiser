# A Standalone Run's QA is run by agents and reported on its Pull Request

## Status

accepted

Builds on [ADR 0048](0048-a-qa-plan-carries-only-what-automation-does-not-prove.md): a single issue's QA Plan still stays in `tmp/`. Amends [ADR 0138](0138-a-finished-standalone-run-hands-its-issue-to-a-person.md) on who opens the Pull Request. The PRD path keeps its QA Plan Issue.

## Context

A finished Standalone Run waits as `ready-for-human`, and the Maintainer was asking an agent by hand to check the branch, open the Pull Request, handle review comments and verify the fix. Nothing recorded that QA had happened, because a single issue's QA Plan is never published. The repository also had no way to put a screenshot or video on a Pull Request; `qa-plan` pointed at a `walkthrough-artifacts` Skill that is not here, and the repository is public.

## Decision

The `finish-standalone-runs` Skill runs QA with one separate agent session per Pull Request, without asking for approval of the plan. The session running the Skill orchestrates: it schedules the QA sessions so none competes for a worktree, port, database or device, starting with one pilot and then one at a time unless a second stack saves real time.

1. **QA follows the Pull Request.** It runs once CI and code review have settled, so it tests the code that will merge. `docs/sandcastle/RUNBOOK.md`'s "QA the integrated branch locally", before the push, remains the PRD order.
2. **The result is a QA Report.** One text comment names the commit, the scenarios and the result, and a later commit makes it stale. The Maintainer sees the results before it is posted. Nothing enforces it, as ADR 0048 decided for QA Plans.
3. **A QA Artifact is private by default.** It stays in `tmp/qa/pr-<n>/`. Most exist so the Maintainer can check a fix while working on something else, so each upload is their choice, and the default is none. A failed run's QA Artifact stays local.
4. **An uploaded QA Artifact goes on the `qa-evidence` prerelease.** Upload is public at once, so only QA Accounts may appear.

## Considered Options

- **One QA sub-agent per Pull Request.** A sub-agent cannot use the built-in browser, a simulator or an emulator, so it could only script the web app, and that is further from what a person would see. Trying it on five real runs also showed the permission check can refuse it.
- **Starting every QA session at once.** The stack's resources are fixed and each extra stack costs an install and a database, so this trades conflicts and disk for little time.
- **An orphan branch for uploads.** It displays images inline, but binaries stay in repository history permanently.
- **CI artifacts.** They expire, and a local QA run does not produce them.
- **Driving GitHub's comment box in a browser.** It gives inline video, but it is fragile and needs a signed-in session.
- **QA before the Pull Request.** `qa-plan` needs a Pull Request for its merge base, and any fix from the later review would invalidate the result.

## Consequences

- A video appears as a link in a QA Report, not inline.
- An issue's labels do not change: it stays `ready-for-human` until its Pull Request closes it on merge.
- A QA session can exercise the mobile app on a simulator or emulator. It cannot verify a real device, a screen reader or design fidelity, so the QA Report lists those under "Left for a person". An agent never marks them passed.
- QA depends on a harness that offers separate sessions. Without one, the orchestrating session runs the plans itself, one at a time, and says so.

## Amendment (2026-11-15): one continuous run

Pass 1 used to end with "Stop. Do not poll". The Maintainer then had to watch CI and the code review on every Pull Request and start Pass 2 by hand, although nothing in that wait needed them (PRD #1585, issue #1587).

`finish-standalone-runs` is now one continuous run. It opens the Pull Requests and runs `yarn runs:ready <pr>…` in the background. That one command waits in one process, re-reading each Pull Request's facts, and exits when something changes. The run then continues into reviews and QA in the same session, stopping only for a real decision. Pass 1 and Pass 2 remain as resume points, because GitHub still holds the state for a new session. The agent never checks in a loop of its own.

1. **Ready for QA** means every required check is green on the latest commit, the code-review summary names that commit in full, no thread from the automated review is unresolved, and no comment from an `OWNER`, `MEMBER` or `COLLABORATOR` is unanswered. A required check still running, or a review not yet at the head, is pending and is waited on.
2. **Needs a decision** ends the wait at once. That is a red required check, a review of the head that asks for changes, an unresolved automated-review thread, an unanswered trusted comment, or a comment from outside the repository. Two more conditions go beyond the issue's own list. A Pull Request that conflicts with its base needs a decision, as the issue's Maintainer Review decided, because QA on code that must change is wasted. So does one that is merged, closed or a draft, since it is no longer QA's to test. Review findings and trusted comments go to `address-pr-review`; the rest go to the Maintainer in one batched decision.
3. **Trust is an allow-list.** Only the three associations above are a person's words to answer. Every other association, a missing or unknown one, and every bot but the review publisher is outside. An outside comment is shown by author, association and link only, never its text, and never acted on. The publisher is matched by login before any association, because GitHub calls its bot a `CONTRIBUTOR`.
4. **The run's own voice is marked.** The run posts as the Maintainer, so its login alone cannot tell an agent's comment from the Maintainer's. Every comment or reply an agent posts on a Pull Request carries a marker alone on its own line: `<!-- agent-reply -->`, or the QA Report's, the Merge Train's or the code review's own marker. A comment from that login with one of these markers, an allow-list, is the run's voice and is never a comment to answer. One with no marker is the Maintainer's own words and is a trusted comment. The Maintainer decided this over ignoring that login's comments altogether, which would have hidden the Maintainer's own requests (issue #1587).
5. **The review command is not words.** A conversation comment whose body starts with `/code-review`, from one of the three trusted associations, is the command that asks for a code review. It needs no answer, wherever it comes from. This matches `code-review.yml`'s own trigger rule, and a test pins the prefix and the associations against that file. It is an allow-list of exactly that one prefix: every other unmarked comment from the run's login still needs an answer, and an outside author's command is still an outside comment. Without it, the Maintainer's own trigger comment would hold the wait until an agent replied to a command (decided with the Chief of Staff for issue #1587).
6. **Answered** means a later agent reply, a comment from that login carrying `<!-- agent-reply -->`. In a review thread, it means an agent reply is the last comment, or the thread is resolved. A QA Report or the train's record answers nobody. A minimised comment counts as handled, since only someone with write access can hide one; that is how the Maintainer clears an outside comment.
7. **The wait has a time limit**, 60 minutes by default. At the limit it reports what each Pull Request still waits on. Its exit codes match the Merge Train's: 0 done, 1 stopped, 2 cannot start. No workflow or scheduled agent runs it ([ADR 0148](0148-the-merge-train-auto-merges-only-on-facts-it-reads-for-the-head-it-merges.md) defers that).

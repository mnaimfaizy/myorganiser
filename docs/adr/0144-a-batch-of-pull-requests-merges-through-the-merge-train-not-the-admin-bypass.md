# A batch of Pull Requests merges through the Merge Train, not the admin bypass

## Status

accepted

Records the 2026-11-11 re-decision of [#1376](https://github.com/mnaimfaizy/myorganiser/issues/1376) (Choose how a PR stays mergeable when main moves), reopened by the PR CI duration watch ([#1473](https://github.com/mnaimfaizy/myorganiser/issues/1473)). The no-merge-queue finding of [#1375](https://github.com/mnaimfaizy/myorganiser/issues/1375) still stands.

## Context

`main`'s ruleset requires a branch to be up to date before it merges: strict required status checks. The point is that the exact code that lands has passed. The 2026-10-29 resolution of #1376 kept that rule and set a revisit line at 10% of PR runs starting behind `main`.

The watch then measured 37% (34 of 92 runs, 2026-10-30 → 11-09). The breakdown showed that strict up-to-date was not the cause:

- 30 of the 34 stale runs were Standalone Runs from `yarn dispatch-agents`. Every one of the 34 was the branch's **first** run, made because `main` moved while the agent worked. No run in any window came from bringing a branch up to date.
- The ruleset lets the admin role bypass it at any time. 39 of the 55 merges in that window (71%) landed while `main` had moved past the head, so no check ever ran on the tree that landed.
- That broke `main`. #1441 and #1446 merged 40 seconds apart on 2026-11-07. Each had passed alone, and together they failed Typecheck. `main` stayed red for about 20.5 hours, until #1453.
- The 10% line was set against the baseline's count of runs that caught up with `main` (10 of 100). The watch counts every run that started behind `main`. By that count, the same baseline window was already 14%.

## Decision

1. **Strict up-to-date stays, and is honoured.** The admin bypass is for emergencies, not for routine merges.
2. **A batch merges through the Merge Train.** `yarn merge:train <pr>…` takes Pull Requests in the order given, normally the order the `finish-standalone-runs` Skill recommends. For each one it:
   - brings the branch up to date if `main` has moved past it;
   - waits for every required check of `main`'s ruleset on that new head;
   - merges exactly that head (`--match-head-commit`), without `--admin`.

   It stops at the first red required check, conflict, draft, or required review, and names the Pull Requests it never reached. The required checks are read from the ruleset, not listed in the script. The decisions are pure in `tools/scripts/lib/merge-train.ts`.

3. **The watch measures what the guarantee loses.** The PR CI duration watch's `stale-branch-share` signal (more than 10% of runs) is replaced by `merged-behind-main`: a Pull Request merged into `main` while `main` had moved past its head. The target is 0. The stale-run share is still reported, but it is no longer a signal: a stale first run costs nothing when the branch is brought up to date before it merges.

## Considered Options

- **Drop strict up-to-date and rely on push-to-`main` CI.** No added wait, but it gives up the guarantee and catches a conflict only after it lands. It would also need push-to-`main` runs to stop cancelling queued runs, because bursts of merges currently leave commits unchecked.
- **Keep the ruleset and the bypass, and only move the threshold.** Costs nothing, but about 70% of merges stay unchecked.
- **Move the repository to an organisation and use GitHub's merge queue.** This is the same mechanism run by GitHub, with batching. It is still ruled out for the reasons in #1375.

## Consequences

- Each Pull Request that would have merged behind `main` costs one more PR run on its updated head: about 39 runs over 11 days at the post-PRD rate. Standard runners are free for this public repository.
- A batch of N takes about (N − 1) × 7.4 minutes of unattended wait instead of about a minute of clicking.
- The train needs no ruleset change. The bypass stays, so the watch is what shows when a merge goes around the train.
- If `main` moves under a Pull Request between its checks finishing and its merge, GitHub refuses the merge. The train then reads the PR again and updates it, up to three times, before stopping.

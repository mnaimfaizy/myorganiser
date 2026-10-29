# GitHub merge queue for this repository

**Frozen 2026-10-29.** Answers issue #1375 for the map #1373 (faster PR CI
under five minutes). Question: can this repository, which is public and owned by
a personal account, use a GitHub merge queue, and how would it interact with
the `main` ruleset and workflows? Covered here: availability, the `merge_group`
event, required checks on the PR and in the queue, grouping options, and the
alternative of turning strict up-to-date off. Sources are GitHub Docs (cited by
page URL and by the `github/docs` source file that holds the text) and the
GitHub changelog. Repository facts come from read-only `gh api` calls made on
this date.

## Answer

**No. This repository cannot use a merge queue.** Merge queue is available
only to repositories that an organization owns. A public repository owned by
a personal account does not qualify. The only way to get one would be to
transfer the repository to an organization, which can be a free one. The
alternative that is actually open, turning off strict up-to-date, stops the
stale-branch reruns. It does so by giving up the pre-merge guarantee that
`main` passes the required checks on the exact tree that lands. Push-to-`main`
CI then finds a semantic break after it has landed, not before.

## Availability

- GitHub Docs, the gated-features text shown at the top of "Managing a merge
  queue" (source `data/reusables/gated-features/merge-queue.md`):
  "Pull request merge queues are available in any public repository owned by
  an organization, or in private repositories owned by organizations using
  GitHub Enterprise Cloud."
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue>
- The GA changelog (2023-07-12) uses the same scope: Enterprise Cloud repos,
  "and all public repos owned by organizations."
  <https://github.blog/changelog/2023-07-12-pull-request-merge-queue-is-now-generally-available/>
- No changelog entry found extends merge queue to repositories owned by a
  personal account. The newest related entry, the async merge API (GA
  2026-10-01), can add pull requests to an existing queue but does not change
  who is eligible.
  <https://github.blog/changelog/2026-10-01-github-async-merge-api-generally-available/>
- The repo-level ruleset rule "Require merge queue" is "not available for
  rulesets created at the organization level". It is a repository-level rule,
  but it is still gated by the same availability. Source:
  `content/.../managing-rulesets/available-rules-for-rulesets.md`.
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-merge-queue>

Repository facts (`gh api repos/mnaimfaizy/myorganiser`): `owner.type` is
`User` and `private` is `false`. So the repository falls outside both eligible
cases.

## If the repository moved to an organization: how the queue would work

### The `merge_group` event and which checks must run on it

- "You **must** use the `merge_group` event to trigger your GitHub Actions
  workflow when a pull request is added to a merge queue." A workflow that
  reports a required check needs `on: pull_request:` and `merge_group:`.
  (Managing a merge queue, the CI section.)
- If Actions performs the required checks, "you need to update the workflows
  to include the `merge_group` event as an additional trigger. Otherwise,
  status checks will not be triggered … The merge will fail as the required
  status check will not be reported. The `merge_group` event is separate from
  the `pull_request` and `push` events." (Source
  `data/reusables/actions/merge-group-event-with-required-checks.md`.)
- Event reference: the only activity type is `checks_requested`. `GITHUB_SHA`
  is the SHA of the merge group and `GITHUB_REF` is the ref of the merge
  group. `branches` / `branches-ignore` filters are supported.
  <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group>
- The queue tests temporary branches prefixed `gh-readonly-queue/{base_branch}`,
  which "contain a different `sha` from the pull request". (Managing a merge
  queue.)

**This repo today:** no workflow has a `merge_group` trigger (`grep` of
`.github/workflows/`). `ci.yml` runs on `pull_request`, `push` to
`main`/`release/**`, and `workflow_dispatch`. All six required checks
(Authoritative Lockfile Policy, Secure Install Review, Prepare Dependency
Cache, Setup Affected Context, Lint, Test) are jobs in `ci.yml`, so every one of
them would need to report on `merge_group`. Several jobs key on
`github.event_name == 'pull_request'` and read `github.event.pull_request.*`,
for example the lockfile policy's checkout of `pull_request.head.sha`. On a
`merge_group` run those jobs would need a merge-group path that still reports
the check. The docs count a check as passing when its status is `successful`,
`skipped`, or `neutral` (About protected branches, "Require status checks
before merging"). The affected-base computation would also need the merge
group's base, not a PR base. Inference: a step-level skip that leaves the job
`success`, as the lockfile job does on `push`, would satisfy the queue.

### Required checks on the PR vs in the queue

- "Merge queue and pull requests checks are coupled and configured under
  branch protection rules or rulesets." (Managing a merge queue, CI note.)
  The same required-check list applies to both. There is no separate list for
  the queue.
- "Once a pull request has passed all required branch protection checks, a
  user with write access to the repository can add the pull request to the
  queue. The merge queue will ensure the pull request's changes pass all
  required status checks when applied to the latest version of the target
  branch and any pull requests already in the queue." (Source
  `data/reusables/pull_requests/merge-queue-overview.md`.)
- The queue "provides the same benefits as the **Require branches to be up to
  date before merging** branch protection, but does not require a pull request
  author to update their pull request branch and wait for status checks to
  finish before trying to merge." (Same source.)

So the required checks run twice: once on the PR head (`pull_request`), then
once on the merge group (`merge_group`). The second run replaces the
update-branch reruns that strict mode forces today. Inference: a job can
behave differently per event, as long as every required check name reports
on both events. For example, affected-only work could run on `pull_request`
and the whole tree on `merge_group`.

### Grouping and batching options

From "Managing a merge queue" and the ruleset rule's "Additional settings":

- **Merge method**: merge, rebase, or squash.
- **Build concurrency** (1–100): how many `merge_group.checks_requested`
  events are in flight at once. Setting it to `0` stops dispatch.
- **Minimum / maximum group size** (1–100), plus **wait time** to reach the
  minimum before a smaller group merges. "Merge limits do not combine
  `merge_group` **builds**". They only govern how many already-passing
  entries merge together.
- **Require all queue entries to pass required checks** (called "Only merge
  non-failing pull requests" in branch protection). When it is off, "only
  the commit at the head of the merge group … must pass its required checks".
- **Status check timeout (minutes)**: checks that have not reported by then
  are treated as failed.
- Ordering is FIFO. Each entry's group contains the base plus every entry
  ahead of it. When one entry fails, it is removed and the entries behind it
  are rebuilt without it. Jumping to the top "will cause a full rebuild of all
  in-progress pull requests".

### Other constraints

- "A merge queue cannot be enabled with branch protection rules that use
  wildcard characters (`*`) in the branch name pattern." That note is about
  branch protection rules. The current _ruleset_ targets
  `refs/heads/*main*` and `~DEFAULT_BRANCH`. Inference: before enabling a
  queue, the ruleset would be safest narrowed to `~DEFAULT_BRANCH`.

## The alternative: turn strict up-to-date off

GitHub Docs, About protected branches, "Require status checks before merging"
(source `content/.../managing-protected-branches/about-protected-branches.md`):

| Mode                                                             | Merge requirement                         | GitHub's stated consideration                                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Strict** (today: `strict_required_status_checks_policy: true`) | Branch **must** be up to date with base   | "More builds may be required, as you'll need to bring the head branch up to date after other collaborators update the target branch."            |
| **Loose**                                                        | Branch **does not** have to be up to date | "You'll have fewer required builds … Status checks may fail after you merge your branch if there are incompatible changes with the base branch." |

<https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging>

What loose mode trades away:

1. **The pre-merge whole-tree guarantee.** Under loose mode, a PR's green checks
   were computed against the base it last ran on. Two PRs that each pass on
   their own can merge into a `main` that fails, a semantic conflict with no
   textual conflict. `main` gets a red commit, and the next PR inherits it.
2. **Detection moves after the merge.** Push-to-`main` CI (`ci.yml` `push`
   trigger) becomes the only check of the combined tree. It reports the break
   but cannot prevent it.
3. **That detection is not complete today (repo fact).** `ci.yml` uses
   `concurrency: group: ci-${{ github.workflow }}-${{ github.ref }}` with
   `cancel-in-progress: true`. Several merges in quick succession cancel the
   earlier `main` runs. Only the newest commit gets a full result, so a break
   gets pinned to a range, not a commit. Inference: if loose mode is chosen,
   `main` push runs would need `cancel-in-progress: false`, or an equivalent,
   to keep a per-commit result.
4. **What is kept.** Every PR still has to pass the required checks on its own
   head. Deploy is not triggered by `main` pushes; `deploy-production.yml` is
   a manual dispatch on `release/*` branches. So a red `main` blocks releases,
   not production directly.

What loose mode gains: no rerun on open PRs when `main` moves. The map's
charting saw one branch run CI 11 times. On a single-author repository where
PRs rarely land together, a semantic conflict is unlikely but still possible.

## Summary for the map

- Merge queue is closed to this repository while it is owned by a personal
  account. Opening it requires moving the repo to an organization (a free org
  qualifies for public repos).
- If the repo moved, every required check in `ci.yml` would need a
  `merge_group` trigger and a merge-group code path, and the ruleset would
  gain "Require merge queue". The queue replaces strict up-to-date and keeps
  its guarantee.
- Without moving the repo, loose mode removes the stale-branch reruns. In
  exchange, `main` can go red after a merge, and that is caught only by
  push-to-`main` CI, which `cancel-in-progress` currently makes incomplete.

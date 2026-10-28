# A required check is a fact about the pipeline, not a judgment about the diff

## Status

accepted

## Context

[ADR 0070](0070-a-review-tier-is-a-fact-about-the-diff-and-a-gate-tier-is-a-decision-about-the-work.md)
item 6 introduced the `Agent Verdict` status check, and
[ADR 0071](0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md)
left one question open: whether that check should become required on `main`, gated on the
reviewer's measured recall. This settles it, and settles the surrounding policy the repository has
been running on without writing down.

**What protects `main` today.** A repository ruleset named `*main*`, active, with:

- six required status checks — `Authoritative Lockfile Policy`, `Secure Install Review`,
  `Prepare Dependency Cache`, `Setup Affected Context`, `Lint`, `Test`;
- `require_code_owner_review: true` with `required_approving_review_count: 0`;
- deletion and non-fast-forward protection;
- `bypass_actors: [RepositoryRole]`.

None of that is in a file. `tools/scripts/check-review-pages.ts` carries the six contexts as
`REQUIRED_CHECK_CONTEXTS` and asserts each is still a job name in `ci.yml`, which catches a rename
on the repository side. Nothing compares that list to the ruleset GitHub actually enforces.

**What the reviewer's recall is.** The golden set's frontier cases — the ones the reviewer misses —
have been caught 0, 1 and 1 times out of seven across three valid runs
([the results record](../review/golden-replay-results.md)). A fourth run measured nothing, because
seven parallel sessions exhausted the five-hour subscription window; it was very nearly written
down as `0 of 7`. One case in that set was retired after it turned out to be unwinnable rather than
hard. This is not a detector whose opinion should stand between a change and `main`.

**What the single check was hiding.** `Agent Verdict` failed for two unrelated reasons: a
`request-changes` verdict, and a report the contract rejected — including a reviewer that crashed
or never ran. Those are not the same event. Several pull requests in this stack received no review
at all, because `ai:create-pr` adds labels at creation and the `labeled` runs displaced the
`opened` one from a shared concurrency group; the check reported green each time. It took two
attempts to close, because a label run can both cancel a review that has started and evict one
still queued, and only the first is governed by `cancel-in-progress`. Neither attempt would have
been necessary if the absence of a review were itself visible — which is the point of this ADR.
A merged failure mode is a hidden one.

## Decision

**A check may be required when it asserts a fact about the pipeline. A check that asserts a
judgment about the diff may not.**

1. **The reviewer's two failure modes are two checks.** `Agent Review Ran` fails when the reviewer
   crashed, was cut off by the rate limit, or produced a report the contract rejected.
   `Agent Verdict` fails when the reviewer read the diff and asked for changes.
2. **`Agent Review Ran` is eligible to be required; `Agent Verdict` is not, and will not be
   proposed again on recall grounds.** A reviewer at roughly one catch in seven is useful as an
   opinion and useless as a gate. This is not a threshold waiting to be met: the number is not the
   argument. Even a reviewer with good recall asserts a judgment, and a judgment belongs to a
   human reviewer, which the ruleset already requires through CODEOWNERS.
3. **The bypass and the zero-approval settings stay.** `require_code_owner_review: true` with
   `required_approving_review_count: 0`, a sole owner who is usually also the author, and
   `RepositoryRole` in `bypass_actors` mean the review requirement does not bind the maintainer.
   That is deliberate for a solo repository: the purpose of these rules is to make a failure
   _visible_, not to make it impossible to merge. It follows that visibility is the thing worth
   engineering, which is what decision 1 buys.
4. **The ruleset stays in GitHub and the repository keeps its own statement of it.**
   `REQUIRED_CHECK_CONTEXTS` is that statement. It is not asserted against the live ruleset, and
   this ADR does not pretend otherwise: adding a check to the ruleset means editing that list in
   the same change, and the two can drift silently between them. A check that reads the live
   ruleset would need a token with administration scope, which is a larger grant than this is
   worth.

## Consequences

`Agent Verdict` becomes advisory and appears in no ruleset. A blocking finding still fails a
visible check, still posts inline comments, and still relabels the pull request `review:human` —
it just does not stop a merge.

Adding `Agent Review Ran` to the ruleset is a separate, deliberate step, because it changes what
can merge. It requires three edits that must land together: the ruleset in GitHub,
`REQUIRED_CHECK_CONTEXTS`, and the check that each required context is a job name — which today
resolves names from `ci.yml` only, and would need to resolve them from `code-review.yml` too.
Until those land, the check exists and is advisory like the verdict.

The drift between `REQUIRED_CHECK_CONTEXTS` and the live ruleset is a known, accepted gap. If it
bites — a required check silently removed, or a job renamed on the GitHub side — the answer is a
gate that reads the ruleset with a scoped token, and this ADR is superseded rather than amended.

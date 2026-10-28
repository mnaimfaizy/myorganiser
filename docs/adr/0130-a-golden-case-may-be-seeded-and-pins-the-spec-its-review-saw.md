# A Golden Case may be seeded, and pins the spec its review saw

## Status

accepted

## Context

The automated review approved PR #1139 (commit `7e392306`) with no findings. A deeper review of the
same commit found seven should-fix defects. A seeded-defect run on a throwaway copy of the branch
planted four defects. It caught two as Blocking, reported a hostname reaching a public log only as a
Spec `nit`, and missed `git merge-base --is-ancestor` called with its arguments swapped (issue #1140).

The Golden Set could not hold any of that, for two reasons.

1. A Golden Case was defined as a real commit range in which a documented incident merged, and
   `tools/scripts/check-review-golden-set.ts` requires each head to be reachable from `main`. The
   seeded commits never existed outside a throwaway copy. The swapped-argument miss, the most
   useful signal in the issue, had nowhere to go.
2. Golden Replay never ran the Spec axis. `.github/workflows/review-golden-replay.yml` wrote only
   `{ spec }` into `tmp/code-review/spec.json`, and every case declared `spec: none`. Three of the
   four seeded defects, and both logic findings from the deeper review, contradict numbered
   decisions in issue #1138, so they are Spec-axis defects. Fetching the issue at replay time would
   not fix this. The 08:12 UTC edit to #1138, made while #1139 was being fixed, added both logic
   findings to its Decision 5 almost word for word. The CI review at 06:47 UTC had read the 06:36
   version. A replay against the edited text would score a catch for reading a sentence the
   original reviewer never had.

## Decision

1. **A Golden Case is attributed or seeded.** An attributed case is a real range in which an
   incident merged, as before. A Seeded Case plants one defect, on purpose, in its own commit on top
   of a real commit. That commit is kept alive by a `golden/seeded-<issue>-<slug>` tag. A case
   declares `origin: attributed | seeded`. The checker accepts a seeded head reachable from its tag
   and an attributed head reachable from `main`.
2. **A seeded range is the whole surrounding diff plus the seed.** The base is the real change's
   base, so the planted line is hidden in the same volume of change that hid the original miss. A
   range of the seed commit alone would be a one-line diff any reviewer catches, so it would measure
   nothing.
3. **One defect per Seeded Case.** Tier is per case (ADR 0116). A case holding a defect the reviewer
   always catches next to one it never catches would have one catch rate, and that rate would mean
   neither.
4. **Seeded recall is reported apart from attributed recall, and never pooled with it.** A seeded
   catch shows that the reviewer can find a defect shape. An attributed catch shows that it would
   have found a defect that really shipped. A pooled number would let either one stand in for the
   other.
5. **A case that measures the Spec axis pins its spec as the original review saw it.** The case
   names `spec: { kind: issue, ref, foundBy }` and a committed `specSnapshot` file. The file is taken
   from the issue's edit history at the revision the original review read, and records that
   revision's timestamp. The replay writes the snapshot's title and body into `spec.json`. The
   snapshot is untrusted spec text, exactly as a live issue body is. This extends ADR 0102's rule
   that a replay reads the case tree to the spec: the reviewer is today's, and everything it is held
   to is as it stood.

## Considered options

- **Keep seeded defects out of the Golden Set**, in a separate harness. Rejected: it duplicates the
  replay, scoring and tiering machinery to protect a definition, and the replay is what the cases
  are for.
- **Seed all four defects in one case.** Rejected by item 3.
- **Fetch the spec live at replay time.** Rejected: it leaks later edits, as shown above, and puts
  an issue-reading token in the replay job.
- **Pin the spec as it stood at the range head's commit time.** Rejected: on #1139 it gives the same
  revision, but in general it can predate edits the original review did see. The question a case
  asks is about that review.
- **Narrow Obligations** (for example, one selecting `--is-ancestor`) in place of seeded cases.
  Rejected: such an Obligation would win the case through its selector rather than through the
  reviewer, so the case would stop measuring anything.

## Consequences

- The four seeded defects from issue #1140 are re-planted as four Seeded Cases on top of
  `7e392306`, with range base `8774ceb6`. The swapped-argument and hostname cases start at Frontier.
  The restart-file and same-site `continue-on-error` cases start at Guard. Each keeps its declared
  tier until its record holds ten scored runs (ADR 0116).
- The real range `8774ceb6...7e392306` becomes one attributed Frontier case expecting both logic
  findings, with `minRecall` 1.0. Its spec is the 06:36 UTC snapshot of #1138.
- The existing cases keep `spec: none`. None of them claims to measure the Spec axis.
- A tag under `golden/` is load-bearing. Deleting one breaks its case, and the checker fails on a
  missing tag rather than replaying nothing.

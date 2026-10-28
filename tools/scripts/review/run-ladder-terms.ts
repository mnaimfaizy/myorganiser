/**
 * The words the run ladder speaks (issue #1031, ADR 0123 items 4 and 5;
 * issue #1039, ADR 0126).
 *
 * Kept apart from `run-ladder.ts` so a reader that only needs the
 * vocabulary imports no package. `golden-results.ts` is one: it validates a
 * result line's `void_reason` against `RUN_FAILURES`, and the golden
 * replay's first job reads the results record through it before any
 * dependency is installed. Importing the ladder there pulled in `zod` by
 * way of `obligations.ts`, and replay run 37722854031 failed to list its
 * cases.
 */

/**
 * What fails `Agent Review Ran`, and voids a golden replay (ADR 0101). The
 * third is a finding's executed evidence the transcript does not bear out
 * (issue #1039, ADR 0126).
 */
export const RUN_FAILURES = [
  'brief-not-read',
  'finding-not-returned',
  'evidence-not-executed',
] as const;

/** What fails `Agent Review Ran`, as a type. */
export type RunFailureReason = (typeof RUN_FAILURES)[number];

/**
 * What tightens the effective tier. However many hold, they cost one step
 * together, on top of the separate step a missing spec costs.
 */
export const TIGHTENING_FACTS = [
  'index-not-opened',
  'dispatch-off-template',
  'transcript-unreadable',
  'reply-unparseable',
  'spec-axis-left-executable-file-unopened',
] as const;

/** What tightens the effective tier, as a type. */
export type TighteningFact = (typeof TIGHTENING_FACTS)[number];

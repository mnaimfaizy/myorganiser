// The per-commit Review Tier record (ADR 0148 decision 3; issue #1526).
//
// The Review Tier job output cannot be read after its run and the label is
// never the truth (ADR 0070 item 3). So the Review Tier workflow also posts
// one marker comment per Pull Request, updated in place, that names the full
// head commit and the tier computed for it. The Merge Train reads it back for
// the exact head it is merging. This module is the one definition both halves
// share: what the comment says, how it is read back, and what the writer does
// given the comments already there.
import { SUMMARY_AUTHOR_LOGIN } from '../review/publish.ts';
import { isReviewTier, type ReviewTier } from './review-tier.ts';

export const REVIEW_TIER_RECORD_MARKER = '<!-- review-tier-record -->';

/** The line the record opens with; the full head commit and tier follow. */
export const REVIEW_TIER_RECORD_LEAD = 'Review Tier of';

/**
 * The login the workflow's comments carry in REST (`github-actions[bot]`).
 * GraphQL, which the train reads through, drops the `[bot]` suffix; both are
 * the one identity `SUMMARY_AUTHOR_LOGIN` names.
 */
export const REVIEW_TIER_RECORD_REST_LOGIN = `${SUMMARY_AUTHOR_LOGIN}[bot]`;

/** A record as read back: the commit it names and the tier it says. */
export interface ReviewTierRecord {
  headRefOid: string;
  tier: ReviewTier;
}

export const renderReviewTierRecord = (
  headRefOid: string,
  tier: ReviewTier,
): string =>
  `${REVIEW_TIER_RECORD_MARKER}\n${REVIEW_TIER_RECORD_LEAD} \`${headRefOid}\`: \`${tier}\`\n`;

const RECORD_RE = new RegExp(
  `^${REVIEW_TIER_RECORD_LEAD} \`([0-9a-f]{40})\`: \`([a-z]+)\`$`,
  'm',
);

/**
 * Is this body a record? The workflow's login also posts the code-review
 * summary, whose reviewer text is generated from Pull Request content and can
 * quote the marker, so the marker only counts as the body's first line.
 */
export const isReviewTierRecordBody = (body: string | null | undefined) =>
  (body ?? '').startsWith(`${REVIEW_TIER_RECORD_MARKER}\n`);

/** The record a comment body says, or null when it is not a well-formed one. */
export function parseReviewTierRecord(
  body: string | null | undefined,
): ReviewTierRecord | null {
  if (!isReviewTierRecordBody(body)) return null;
  const match = RECORD_RE.exec(body!);
  if (!match || !isReviewTier(match[2])) return null;
  return { headRefOid: match[1], tier: match[2] };
}

/** One issue comment, in the shape the REST API returns (`user.login`). */
export interface RecordComment {
  id: number;
  login: string | null;
  body: string | null;
}

/** What the writer does: nothing, create the comment, or edit one in place. */
export type RecordWrite =
  | { action: 'unchanged' }
  | { action: 'create'; body: string }
  | { action: 'update'; id: number; body: string };

/**
 * The writer's one decision. Only a comment the workflow's own login wrote is
 * edited, so a marker pasted into anyone else's comment is never touched; the
 * latest such comment is the record and an identical one is left alone.
 */
export function planReviewTierRecord({
  comments,
  headRefOid,
  tier,
}: {
  comments: readonly RecordComment[];
  headRefOid: string;
  tier: ReviewTier;
}): RecordWrite {
  const body = renderReviewTierRecord(headRefOid, tier);
  // The latest own record, the one the reader takes: with two (a racing
  // first publish) the writer must converge on the comment the train reads.
  const own = comments
    .filter(
      (c) =>
        c.login === REVIEW_TIER_RECORD_REST_LOGIN &&
        isReviewTierRecordBody(c.body),
    )
    .at(-1);
  if (!own) return { action: 'create', body };
  return own.body === body
    ? { action: 'unchanged' }
    : { action: 'update', id: own.id, body };
}

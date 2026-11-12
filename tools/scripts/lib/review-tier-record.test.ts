// The per-commit Review Tier record (#1526): what the marker comment says, how
// it is read back, and what the writer does given the comments already there.
// The train's read of the same comment is in merge-train-auto.test.ts.
import assert from 'node:assert/strict';
import test from 'node:test';

import { SUMMARY_MARKER } from '../review/publish.ts';
import {
  REVIEW_TIER_RECORD_MARKER,
  REVIEW_TIER_RECORD_REST_LOGIN,
  isReviewTierRecordBody,
  parseReviewTierRecord,
  planReviewTierRecord,
  renderReviewTierRecord,
  type RecordComment,
} from './review-tier-record.ts';

const HEAD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);
const BOT = REVIEW_TIER_RECORD_REST_LOGIN;

/**
 * The code-review summary the same login posts. Its reviewer text is generated
 * from Pull Request content, so it can quote a record line.
 */
const summaryQuoting = (head: string, tier: 'auto' | 'agent' | 'human') =>
  `${SUMMARY_MARKER}\nAutomated code review of \`${head}\`\n\n${renderReviewTierRecord(head, tier)}`;

test('a rendered record parses back to the commit and tier it names, for every tier', () => {
  for (const tier of ['auto', 'agent', 'human'] as const) {
    assert.deepEqual(
      parseReviewTierRecord(renderReviewTierRecord(HEAD, tier)),
      { headRefOid: HEAD, tier },
      tier,
    );
  }
});

test('a body without the marker is not a record, and a missing body is not one either', () => {
  assert.equal(
    parseReviewTierRecord(`Review Tier of \`${HEAD}\`: \`auto\``),
    null,
  );
  assert.equal(parseReviewTierRecord(null), null);
  assert.equal(parseReviewTierRecord(undefined), null);
});

test('the writer creates the record when the Pull Request has none', () => {
  assert.deepEqual(
    planReviewTierRecord({ comments: [], headRefOid: HEAD, tier: 'auto' }),
    { action: 'create', body: renderReviewTierRecord(HEAD, 'auto') },
  );
});

test('the writer leaves an identical record alone', () => {
  const comments: RecordComment[] = [
    { id: 7, login: BOT, body: renderReviewTierRecord(HEAD, 'agent') },
  ];
  assert.deepEqual(
    planReviewTierRecord({ comments, headRefOid: HEAD, tier: 'agent' }),
    { action: 'unchanged' },
  );
});

test('the writer edits its own record in place when the head changes', () => {
  const comments: RecordComment[] = [
    { id: 7, login: BOT, body: renderReviewTierRecord(HEAD, 'auto') },
  ];
  assert.deepEqual(
    planReviewTierRecord({ comments, headRefOid: NEXT, tier: 'auto' }),
    { action: 'update', id: 7, body: renderReviewTierRecord(NEXT, 'auto') },
  );
});

test('the writer edits its own record in place when only the tier changes', () => {
  const comments: RecordComment[] = [
    { id: 7, login: BOT, body: renderReviewTierRecord(HEAD, 'auto') },
  ];
  assert.deepEqual(
    planReviewTierRecord({ comments, headRefOid: HEAD, tier: 'human' }),
    { action: 'update', id: 7, body: renderReviewTierRecord(HEAD, 'human') },
  );
});

test("a marker pasted into another author's comment is never edited: the writer creates a new record", () => {
  const comments: RecordComment[] = [
    {
      id: 9,
      login: 'mallory',
      body: renderReviewTierRecord(HEAD, 'auto'),
    },
  ];
  assert.deepEqual(
    planReviewTierRecord({ comments, headRefOid: HEAD, tier: 'auto' }),
    { action: 'create', body: renderReviewTierRecord(HEAD, 'auto') },
  );
});

test('a comment the workflow login wrote without the marker is not the record', () => {
  const comments: RecordComment[] = [
    {
      id: 3,
      login: BOT,
      body: `Automated code review of \`${HEAD}\``,
    },
    { id: 4, login: BOT, body: null },
  ];
  assert.deepEqual(
    planReviewTierRecord({ comments, headRefOid: HEAD, tier: 'auto' }),
    { action: 'create', body: renderReviewTierRecord(HEAD, 'auto') },
  );
});

test('with two own records, the writer edits the later one, the one the train reads', () => {
  const comments: RecordComment[] = [
    { id: 11, login: BOT, body: renderReviewTierRecord(HEAD, 'auto') },
    { id: 12, login: BOT, body: renderReviewTierRecord(HEAD, 'auto') },
  ];
  assert.deepEqual(
    planReviewTierRecord({ comments, headRefOid: NEXT, tier: 'auto' }),
    { action: 'update', id: 12, body: renderReviewTierRecord(NEXT, 'auto') },
  );
});

test('with two own records, an identical latest one is unchanged whatever the earlier one says', () => {
  const comments: RecordComment[] = [
    { id: 11, login: BOT, body: renderReviewTierRecord(HEAD, 'auto') },
    { id: 12, login: BOT, body: renderReviewTierRecord(NEXT, 'agent') },
  ];
  assert.deepEqual(
    planReviewTierRecord({ comments, headRefOid: NEXT, tier: 'agent' }),
    { action: 'unchanged' },
  );
});

test('a code-review summary by the same login that quotes a record is not a record', () => {
  assert.equal(parseReviewTierRecord(summaryQuoting(HEAD, 'auto')), null);
});

test('the writer does not edit a code-review summary that quotes a record: it creates its own', () => {
  const comments: RecordComment[] = [
    { id: 5, login: BOT, body: summaryQuoting(HEAD, 'auto') },
  ];
  assert.deepEqual(
    planReviewTierRecord({ comments, headRefOid: NEXT, tier: 'auto' }),
    { action: 'create', body: renderReviewTierRecord(NEXT, 'auto') },
  );
});

test('text before the marker means the body is not a record', () => {
  const body = `Note from a reviewer\n${renderReviewTierRecord(HEAD, 'auto')}`;
  assert.equal(parseReviewTierRecord(body), null);
  assert.equal(isReviewTierRecordBody(body), false);
  const comments: RecordComment[] = [{ id: 6, login: BOT, body }];
  assert.deepEqual(
    planReviewTierRecord({ comments, headRefOid: HEAD, tier: 'auto' }),
    { action: 'create', body: renderReviewTierRecord(HEAD, 'auto') },
  );
});

test('a body is a record only when the marker is its first line', () => {
  assert.equal(
    isReviewTierRecordBody(renderReviewTierRecord(HEAD, 'auto')),
    true,
  );
  assert.equal(isReviewTierRecordBody(summaryQuoting(HEAD, 'auto')), false);
  assert.equal(
    isReviewTierRecordBody(`x${renderReviewTierRecord(HEAD, 'auto')}`),
    false,
  );
  assert.equal(isReviewTierRecordBody(REVIEW_TIER_RECORD_MARKER), false);
  assert.equal(isReviewTierRecordBody(''), false);
  assert.equal(isReviewTierRecordBody(null), false);
  assert.equal(isReviewTierRecordBody(undefined), false);
});

// The publisher of the per-commit Review Tier record (#1526): it lists the
// Pull Request's comments, then posts or edits one record, and a failed call
// is logged and reported as `failed`, never thrown. The planner it drives is
// in lib/review-tier-record.test.ts.
import assert from 'node:assert/strict';
import test from 'node:test';

import { SUMMARY_MARKER } from '../review/publish.ts';
import {
  REVIEW_TIER_RECORD_REST_LOGIN,
  renderReviewTierRecord,
} from '../lib/review-tier-record.ts';
import {
  parseCommentLines,
  publishReviewTierRecord,
} from './publish-review-tier-record.ts';

const PR = '7';
const REPO = 'owner/name';
const HEAD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);
const BOT = REVIEW_TIER_RECORD_REST_LOGIN;
const quiet = (): void => undefined;

interface Stored {
  id: number;
  login: string;
  body: string;
}

/**
 * A fake `gh api` answering the publisher's three calls: the paginated listing
 * (one JSON comment per line, as its `--jq` prints it), a POST that appends a
 * comment as the workflow's login, and a PATCH that edits one in place. `refuse`
 * makes one method throw, as `gh` does on a refused request.
 */
function fakeGh(initial: Stored[] = [], refuse?: 'GET' | 'POST' | 'PATCH') {
  const store = [...initial];
  const calls: { method: string; path: string; body?: string }[] = [];
  let nextId = 100;
  const ghCall = (args: readonly string[]): string => {
    const method = args.includes('--method')
      ? args[args.indexOf('--method') + 1]
      : 'GET';
    const path = args.find((arg) => arg.startsWith('repos/')) ?? '';
    const body = args
      .find((arg) => arg.startsWith('body='))
      ?.slice('body='.length);
    calls.push({ method, path, body });
    if (method === refuse) throw new Error(`HTTP 403 on ${method}`);
    if (method === 'POST') {
      store.push({ id: nextId++, login: BOT, body: body ?? '' });
      return '';
    }
    if (method === 'PATCH') {
      const id = Number(path.split('/').pop());
      const comment = store.find((c) => c.id === id);
      if (comment) comment.body = body ?? '';
      return '';
    }
    return store.map((c) => JSON.stringify(c)).join('\n');
  };
  return { ghCall, calls, store };
}

test('the first publish posts the record, and a later one edits that comment in place', () => {
  const { ghCall, calls, store } = fakeGh();
  const warnings: string[] = [];
  const warn = (msg: string) => warnings.push(msg);

  assert.deepEqual(
    publishReviewTierRecord({
      pr: PR,
      repo: REPO,
      headRefOid: HEAD,
      tier: 'auto',
      ghCall,
      warn,
    }),
    { write: 'create' },
  );
  assert.deepEqual(
    publishReviewTierRecord({
      pr: PR,
      repo: REPO,
      headRefOid: NEXT,
      tier: 'agent',
      ghCall,
      warn,
    }),
    { write: 'update' },
  );

  assert.deepEqual(
    calls.map((c) => c.method),
    ['GET', 'POST', 'GET', 'PATCH'],
  );
  assert.equal(calls[1].path, 'repos/owner/name/issues/7/comments');
  assert.equal(calls[1].body, renderReviewTierRecord(HEAD, 'auto'));
  assert.equal(calls[3].path, 'repos/owner/name/issues/comments/100');
  assert.equal(calls[3].body, renderReviewTierRecord(NEXT, 'agent'));
  assert.deepEqual(store, [
    { id: 100, login: BOT, body: renderReviewTierRecord(NEXT, 'agent') },
  ]);
  assert.deepEqual(warnings, []);
});

test('a publish for a record already current writes nothing, only listing', () => {
  const { ghCall, calls } = fakeGh();
  const args = { pr: PR, repo: REPO, headRefOid: HEAD, tier: 'auto', ghCall };
  publishReviewTierRecord({ ...args, warn: quiet });
  calls.length = 0;

  assert.deepEqual(publishReviewTierRecord({ ...args, warn: quiet }), {
    write: 'unchanged',
  });
  assert.deepEqual(
    calls.map((c) => c.method),
    ['GET'],
  );
});

test("another author's marker comment is never edited: the publisher posts a record of its own", () => {
  const forged = renderReviewTierRecord(HEAD, 'auto');
  const { ghCall, store } = fakeGh([{ id: 9, login: 'mallory', body: forged }]);

  assert.deepEqual(
    publishReviewTierRecord({
      pr: PR,
      repo: REPO,
      headRefOid: HEAD,
      tier: 'human',
      ghCall,
      warn: quiet,
    }),
    { write: 'create' },
  );
  assert.deepEqual(store[0], { id: 9, login: 'mallory', body: forged });
  assert.equal(store[1].login, BOT);
  assert.equal(store[1].body, renderReviewTierRecord(HEAD, 'human'));
});

test('a listing that throws is reported as failed, is logged, and never throws', () => {
  const { ghCall, calls } = fakeGh([], 'GET');
  const warnings: string[] = [];

  const result = publishReviewTierRecord({
    pr: PR,
    repo: REPO,
    headRefOid: HEAD,
    tier: 'auto',
    ghCall,
    warn: (msg) => warnings.push(msg),
  });

  assert.deepEqual(result, { write: 'failed' });
  assert.deepEqual(
    calls.map((c) => c.method),
    ['GET'],
    'nothing is posted after a failed listing',
  );
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    new RegExp(`could not publish the record for ${HEAD}`),
  );
  assert.match(warnings[0], /the train reads human/);
});

test('a refused POST is reported as failed, and no record is stored', () => {
  const { ghCall, store } = fakeGh([], 'POST');
  const warnings: string[] = [];

  assert.deepEqual(
    publishReviewTierRecord({
      pr: PR,
      repo: REPO,
      headRefOid: HEAD,
      tier: 'auto',
      ghCall,
      warn: (msg) => warnings.push(msg),
    }),
    { write: 'failed' },
  );
  assert.deepEqual(store, []);
  assert.equal(warnings.length, 1);
});

test('a refused PATCH is reported as failed, and the record it could not edit stays as it was', () => {
  const before = renderReviewTierRecord(HEAD, 'auto');
  const { ghCall, store } = fakeGh(
    [{ id: 100, login: BOT, body: before }],
    'PATCH',
  );

  assert.deepEqual(
    publishReviewTierRecord({
      pr: PR,
      repo: REPO,
      headRefOid: NEXT,
      tier: 'agent',
      ghCall,
      warn: quiet,
    }),
    { write: 'failed' },
  );
  assert.deepEqual(store, [{ id: 100, login: BOT, body: before }]);
});

test('a tier that is not one of the three, or a head that is not a full commit, fails before any call', () => {
  let calls = 0;
  const ghCall = () => {
    calls += 1;
    return '';
  };
  const warnings: string[] = [];
  const warn = (msg: string) => warnings.push(msg);

  assert.deepEqual(
    publishReviewTierRecord({
      pr: PR,
      repo: REPO,
      headRefOid: HEAD,
      tier: 'maybe',
      ghCall,
      warn,
    }),
    { write: 'failed' },
  );
  assert.deepEqual(
    publishReviewTierRecord({
      pr: PR,
      repo: REPO,
      headRefOid: HEAD.slice(0, 8),
      tier: 'auto',
      ghCall,
      warn,
    }),
    { write: 'failed' },
  );
  assert.equal(calls, 0);
  assert.equal(warnings.length, 2);
});

test('a listing that is not one JSON comment per line is reported as failed, never thrown', () => {
  const warnings: string[] = [];
  const result = publishReviewTierRecord({
    pr: PR,
    repo: REPO,
    headRefOid: HEAD,
    tier: 'auto',
    ghCall: () => 'not json',
    warn: (msg) => warnings.push(msg),
  });

  assert.deepEqual(result, { write: 'failed' });
  assert.equal(warnings.length, 1);
});

test('the listing is one JSON comment per line, and blank lines are skipped', () => {
  assert.deepEqual(
    parseCommentLines(
      '{"id":1,"login":"a","body":null}\n\n{"id":2,"login":"b","body":"x"}\n',
    ),
    [
      { id: 1, login: 'a', body: null },
      { id: 2, login: 'b', body: 'x' },
    ],
  );
  assert.deepEqual(parseCommentLines(''), []);
});

test('a code-review summary by the same login that quotes a record is never PATCHed: the publisher posts its own', () => {
  const summary = `${SUMMARY_MARKER}\nAutomated code review of \`${HEAD}\`\n\n${renderReviewTierRecord(HEAD, 'auto')}`;
  const { ghCall, calls, store } = fakeGh([
    { id: 5, login: BOT, body: summary },
  ]);

  assert.deepEqual(
    publishReviewTierRecord({
      pr: PR,
      repo: REPO,
      headRefOid: NEXT,
      tier: 'agent',
      ghCall,
      warn: quiet,
    }),
    { write: 'create' },
  );
  assert.deepEqual(
    calls.map((c) => c.method),
    ['GET', 'POST'],
  );
  assert.deepEqual(store[0], { id: 5, login: BOT, body: summary });
  assert.equal(store[1].body, renderReviewTierRecord(NEXT, 'agent'));
});

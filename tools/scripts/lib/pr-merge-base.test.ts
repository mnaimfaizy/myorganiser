/**
 * Run with: node --test tools/scripts/lib/pr-merge-base.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkMergeBaseProof,
  isAgentDraftInvocation,
  normalizeMergeBase,
} from './pr-merge-base.ts';

const FULL_SHA = 'bc5964e1a2b3c4d5e6f708192a3b4c5d6e7f8091';

test('normalizes a full SHA to lowercase hex', () => {
  assert.equal(normalizeMergeBase(`  ${FULL_SHA.toUpperCase()}  `), FULL_SHA);
});

test('accepts a seven-character abbreviation', () => {
  assert.equal(normalizeMergeBase('bc5964e'), 'bc5964e');
});

test('rejects values that are not plausible commit SHAs', () => {
  assert.equal(normalizeMergeBase('bc5964'), null, 'too short');
  assert.equal(normalizeMergeBase(`${FULL_SHA}0`), null, 'too long');
  assert.equal(normalizeMergeBase('origin/main'), null, 'not hex');
  assert.equal(normalizeMergeBase(''), null, 'empty');
  assert.equal(normalizeMergeBase(undefined), null, 'absent');
  assert.equal(normalizeMergeBase(null), null, 'null');
});

test('treats a drafted title or body as the agent path', () => {
  assert.equal(isAgentDraftInvocation({ title: 'fix(pr): gate' }), true);
  assert.equal(isAgentDraftInvocation({ bodyFile: '/tmp/body.md' }), true);
  assert.equal(
    isAgentDraftInvocation({ bodyFile: '/tmp/body.md', title: 'fix: x' }),
    true,
  );
  assert.equal(isAgentDraftInvocation({}), false);
  assert.equal(isAgentDraftInvocation(), false);
});

test('closes the --body door as well as --body-file', () => {
  assert.equal(isAgentDraftInvocation({ body: '## Why\nfabricated' }), true);

  const result = checkMergeBaseProof({
    computedMergeBase: FULL_SHA,
    isAgentDraft: isAgentDraftInvocation({ body: '## Why\nfabricated' }),
    suppliedMergeBase: null,
  });

  assert.equal(result.ok, false, 'inline body text needs proof too');
  assert.match(result.message, /Missing --merge-base/);
});

test('accepts an agent draft whose merge base matches', () => {
  assert.deepEqual(
    checkMergeBaseProof({
      computedMergeBase: FULL_SHA,
      isAgentDraft: true,
      suppliedMergeBase: FULL_SHA,
    }),
    { ok: true },
  );
});

test('accepts an abbreviated merge base that prefixes the computed one', () => {
  assert.deepEqual(
    checkMergeBaseProof({
      computedMergeBase: FULL_SHA,
      isAgentDraft: true,
      suppliedMergeBase: 'BC5964E',
    }),
    { ok: true },
  );
});

test('rejects an agent draft with no merge base', () => {
  const result = checkMergeBaseProof({
    computedMergeBase: FULL_SHA,
    isAgentDraft: true,
    suppliedMergeBase: null,
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /Missing --merge-base/);
});

test('rejects an agent draft whose merge base belongs to another branch', () => {
  const result = checkMergeBaseProof({
    computedMergeBase: FULL_SHA,
    isAgentDraft: true,
    suppliedMergeBase: '0b63bfe9182736455463728190a1b2c3d4e5f607',
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /does not match/);
});

test('rejects a merge base that is not a commit SHA', () => {
  const result = checkMergeBaseProof({
    computedMergeBase: FULL_SHA,
    isAgentDraft: true,
    suppliedMergeBase: 'origin/main',
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid --merge-base/);
});

test('rejects when the runner cannot compute a merge base to verify against', () => {
  const result = checkMergeBaseProof({
    computedMergeBase: '',
    isAgentDraft: true,
    suppliedMergeBase: FULL_SHA,
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /Unable to compute the merge base/);
});

test('lets the human and CI fallback path run with no merge base', () => {
  assert.deepEqual(
    checkMergeBaseProof({
      computedMergeBase: FULL_SHA,
      isAgentDraft: false,
      suppliedMergeBase: null,
    }),
    { ok: true },
  );
});

test('still verifies a merge base the fallback path chose to supply', () => {
  const result = checkMergeBaseProof({
    computedMergeBase: FULL_SHA,
    isAgentDraft: false,
    suppliedMergeBase: '0b63bfe',
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /does not match/);
});

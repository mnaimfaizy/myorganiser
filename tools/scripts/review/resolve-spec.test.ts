import assert from 'node:assert/strict';
import test from 'node:test';

import { discoverSpec, isPullRequest } from './resolve-spec.ts';

test('the branch name wins when it carries an issue number', () => {
  assert.deepEqual(
    discoverSpec({
      headRef: 'fix/292-graphify-extraction-gaps',
      commits: ['fix: refs #999'],
    }),
    { kind: 'issue', ref: '#292', foundBy: 'branch' },
  );
});

test('a branch without a number falls back to the first commit reference', () => {
  assert.deepEqual(
    discoverSpec({
      headRef: 'feat/review-tier-classifier',
      commits: ['feat(review): classifier', 'Refs #123 and see #456'],
    }),
    { kind: 'issue', ref: '#123', foundBy: 'commits' },
  );
});

// ADR 0125. The case that asked for it: `fix/1078-…` whose one commit closed
// #1078 and #1079 was reviewed against #1078 alone, and the half of the diff
// #1079 asked for came back as behaviour nobody asked for.
test('every other issue a commit closes is named beside the one found', () => {
  assert.deepEqual(
    discoverSpec({
      headRef: 'fix/1078-tasks-subscriptions-keyboard-focus',
      commits: ['fix(mobile): restore focus', 'Closes #1078', 'Closes #1079'],
    }),
    { kind: 'issue', ref: '#1078', foundBy: 'branch', also: ['#1079'] },
  );
});

test('further issues come from closing keywords only, once each, in commit order', () => {
  assert.deepEqual(
    discoverSpec({
      headRef: 'feat/review-tier-classifier',
      commits: [
        'Closes #10',
        'Refs #20, see #30, issue #40',
        'fixes #50 and Resolved #60',
        'closes #50',
        'Introduced in #70',
        'feat: squash merge (#80)',
      ],
    }),
    { kind: 'issue', ref: '#10', foundBy: 'commits', also: ['#50', '#60'] },
  );
});

test('one keyword closes one issue, as on GitHub', () => {
  assert.deepEqual(
    discoverSpec({ headRef: 'fix/12-a', commits: ['Closes #12, #13'] }),
    { kind: 'issue', ref: '#12', foundBy: 'branch' },
  );
});

test('a reference found first is not closed again as a further issue', () => {
  assert.deepEqual(
    discoverSpec({
      headRef: 'chore/tidy',
      commits: ['Refs #12', 'Closes #12', 'Closes #13'],
    }),
    { kind: 'issue', ref: '#12', foundBy: 'commits', also: ['#13'] },
  );
});

test('a pull request is told from an issue by where it lives', () => {
  assert.equal(
    isPullRequest({ url: 'https://github.com/o/r/pull/1104' }),
    true,
  );
  assert.equal(
    isPullRequest({ url: 'https://github.com/o/r/issues/1079' }),
    false,
  );
  assert.equal(isPullRequest({}), false);
});

test('a bare number is a PR number or a citation, not an issue reference', () => {
  assert.deepEqual(
    discoverSpec({
      headRef: 'chore/tidy',
      commits: [
        'bump to v1.2.3',
        'ADR 0070 item #4 reads',
        'feat: squash merge (#123)',
        'the first run on #678 failed',
      ],
    }),
    { kind: 'none', foundBy: 'none' },
  );
  assert.deepEqual(
    discoverSpec({ headRef: 'release/v1.2.3', commits: ['sha abc#12'] }),
    { kind: 'none', foundBy: 'none' },
  );
});

test('a keyword reference in a commit body is found, case-insensitively', () => {
  for (const line of ['Closes #12', 'fixes #12', 'Refs #12', 'see #12']) {
    assert.deepEqual(
      discoverSpec({ headRef: 'chore/tidy', commits: ['subject', line] }),
      { kind: 'issue', ref: '#12', foundBy: 'commits' },
      line,
    );
  }
});

test('nothing found is a none spec with no ref', () => {
  assert.deepEqual(discoverSpec({ headRef: undefined, commits: [] }), {
    kind: 'none',
    foundBy: 'none',
  });
});

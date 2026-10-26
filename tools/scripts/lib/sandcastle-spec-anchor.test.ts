import assert from 'node:assert/strict';
import test from 'node:test';

import { discoverSpec } from '../review/resolve-spec.mjs';
import {
  branchNameCarriesIssue,
  prdBranchSlug,
  specAnchorMessage,
} from './sandcastle-spec-anchor.ts';

// The anchor is only worth anything if the real resolver reads it, so the
// assertion runs the real resolver rather than re-stating its regex.
test('the anchor message resolves to its issue through the commit step', () => {
  const message = specAnchorMessage({
    branch: 'feat/code-review-trust',
    issue: 713,
    title: 'Code review trust',
  });
  assert.deepEqual(
    discoverSpec({ headRef: 'feat/code-review-trust', commits: [message] }),
    { kind: 'issue', ref: '#713', foundBy: 'commits' },
  );
});

// Which issue is found first is unchanged by ADR 0125. What it adds is that
// the other issue the commits close is spec as well, named in `also`.
test('the anchor loses to a branch name that already carries an issue', () => {
  const message = specAnchorMessage({ branch: 'slice/720-x', issue: 713 });
  assert.deepEqual(
    discoverSpec({ headRef: 'slice/720-x', commits: [message] }),
    { kind: 'issue', ref: '#720', foundBy: 'branch', also: ['#713'] },
  );
});

test('the anchor is the oldest commit, so it wins over later slice references', () => {
  const anchor = specAnchorMessage({ branch: 'feat/trust', issue: 713 });
  assert.deepEqual(
    discoverSpec({
      headRef: 'feat/trust',
      commits: [anchor, 'feat(review): a slice\n\nCloses #720'],
    }),
    { kind: 'issue', ref: '#713', foundBy: 'commits', also: ['#720'] },
  );
});

test('the subject names the branch and the issue', () => {
  const [subject] = specAnchorMessage({
    branch: 'feat/trust',
    issue: 713,
  }).split('\n');
  assert.equal(subject, 'chore(sandcastle): anchor feat/trust to #713');
});

test('the title is optional and omitted cleanly', () => {
  const message = specAnchorMessage({ branch: 'feat/trust', issue: 713 });
  assert.ok(!message.includes('Issue:'));
  assert.ok(message.endsWith('Closes #713'));
});

test('a missing or nonsense issue number is refused, not silently anchored', () => {
  for (const issue of [undefined, 0, -1, 1.5, '713'] as unknown as number[]) {
    assert.throws(
      () => specAnchorMessage({ branch: 'feat/trust', issue }),
      /positive issue number/,
      String(issue),
    );
  }
  assert.throws(
    () => specAnchorMessage({ branch: '', issue: 713 }),
    /branch name/,
  );
});

// The anchor is skipped only when the branch name resolves to THIS issue. A
// branch naming some other number is a different branch, not a carried issue.
test('a branch carries an issue only when the name resolves to that issue', () => {
  assert.equal(branchNameCarriesIssue('slice/720-trust', 720), true);
  assert.equal(branchNameCarriesIssue('fix/292-graphify', 292), true);
  assert.equal(branchNameCarriesIssue('slice/720-trust', 713), false);
  for (const branch of [
    'feat/code-review-trust-harness',
    'claude/add-spec-anchor',
    'copilot/fix-thing',
    'release/v1.2.3',
  ]) {
    assert.equal(branchNameCarriesIssue(branch, 713), false, branch);
  }
});

// Both halves of the same defect: a PRD titled "2026 roadmap" slugs to
// `2026-roadmap`, whose branch matches the resolver's `<type>/<issue>-` shape
// while the number is a slug fragment. Unguarded, the anchor is skipped AND the
// resolver reads #2026 as the spec.
test('a PRD title starting with a number does not mint a branch-name issue', () => {
  for (const title of ['2026 Roadmap cleanup', '404 page redesign', '12']) {
    const branch = `feat/${prdBranchSlug(title)}`;
    assert.equal(
      discoverSpec({ headRef: branch, commits: [] }).foundBy,
      'none',
      branch,
    );
    assert.equal(branchNameCarriesIssue(branch, 713), false, branch);
  }
});

test('an ordinary PRD title slugs unchanged', () => {
  assert.equal(
    prdBranchSlug('Code review trust: harness containment'),
    'code-review-trust-harness-containment',
  );
  assert.equal(prdBranchSlug('Vault v2 rollout'), 'vault-v2-rollout');
});

// The whole point of asking the resolver instead of copying its regex: a branch
// type the copy never anticipated is classified correctly with no edit here.
test('an unanticipated branch type is classified by the resolver, not by a list', () => {
  assert.equal(branchNameCarriesIssue('perf/851-vault-unlock', 851), true);
  assert.equal(branchNameCarriesIssue('spike/9-idea', 9), true);
});

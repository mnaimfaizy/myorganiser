/**
 * Run with: yarn ai:create-pr:test
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORCE_FLAG,
  PUSH_ACTIONS,
  SEPARATOR,
  decidePushPlan,
  findOrphanedRemoteCommits,
  parseCherryOutput,
  parseCommitRecords,
  type DecidePushPlanInput,
} from './pr-push-plan.ts';

const BRANCH = 'docs/some-branch';
const REMOTE_SHA = 'de45a82f229528b8607cb60f19c4c09c8b546ae3';

const plan = (overrides: Partial<DecidePushPlanInput>) =>
  decidePushPlan({
    hasUpstream: true,
    ahead: 0,
    behind: 0,
    branch: BRANCH,
    ...overrides,
  });

test('publishes a branch that has no upstream yet', () => {
  const result = plan({ hasUpstream: false });
  assert.equal(result.action, PUSH_ACTIONS.setUpstream);
  assert.deepEqual(result.args, ['push', '-u', 'origin', 'HEAD']);
});

test('does nothing when the upstream is already at this commit', () => {
  assert.equal(plan({}).action, PUSH_ACTIONS.upToDate);
});

test('pushes normally when strictly ahead', () => {
  const result = plan({ ahead: 3 });
  assert.equal(result.action, PUSH_ACTIONS.fastForward);
  assert.deepEqual(result.args, ['push', 'origin', 'HEAD']);
});

test('refuses when strictly behind', () => {
  const result = plan({ behind: 2 });
  assert.match(result.error!, /behind its upstream/);
  assert.equal(result.action, undefined);
});

test('refuses a diverged branch when the flag is absent, and names the flag', () => {
  const result = plan({ ahead: 2, behind: 1 });
  assert.equal(result.action, undefined);
  assert.match(result.error!, /diverged \(2 local, 1 remote\)/);
  assert.ok(
    result.error!.includes(FORCE_FLAG),
    'the refusal must tell the caller how to proceed',
  );
});

test('forces a rebased branch with a lease pinned to the observed SHA', () => {
  const result = plan({
    ahead: 2,
    behind: 1,
    remoteSha: REMOTE_SHA,
    forceWithLease: true,
  });
  assert.equal(result.action, PUSH_ACTIONS.forceWithLease);
  assert.deepEqual(result.args, [
    'push',
    `${FORCE_FLAG}=${BRANCH}:${REMOTE_SHA}`,
    'origin',
    'HEAD',
  ]);
});

test('never emits a bare lease, which a background fetch would defeat', () => {
  const result = plan({
    ahead: 1,
    behind: 1,
    remoteSha: REMOTE_SHA,
    forceWithLease: true,
  });
  assert.ok(
    !result.args!.includes(FORCE_FLAG),
    'the unpinned flag must never appear on its own',
  );
  assert.ok(result.args!.some((a) => a.startsWith(`${FORCE_FLAG}=`)));
});

test('refuses to force when the upstream SHA could not be resolved', () => {
  for (const remoteSha of [undefined, '', '   ']) {
    const result = plan({
      ahead: 1,
      behind: 1,
      remoteSha,
      forceWithLease: true,
    });
    assert.equal(result.action, undefined, `remoteSha=${remoteSha}`);
    assert.match(result.error!, /lease cannot be pinned|could not be resolved/);
  }
});

test('refuses to force over upstream commits that exist nowhere locally', () => {
  const result = plan({
    ahead: 2,
    behind: 2,
    remoteSha: REMOTE_SHA,
    forceWithLease: true,
    unmatchedRemoteCommits: ['aaaaaaa', 'bbbbbbb'],
  });
  assert.equal(
    result.action,
    undefined,
    'the flag must not override somebody else’s work',
  );
  assert.match(result.error!, /would destroy them/);
  assert.ok(result.error!.includes('aaaaaaa'));
  assert.ok(result.error!.includes('bbbbbbb'));
});

test('refuses unmatched upstream commits even without the flag', () => {
  const result = plan({
    ahead: 1,
    behind: 1,
    unmatchedRemoteCommits: ['aaaaaaa'],
  });
  assert.match(result.error!, /would destroy them/);
});

test('refuses when the commit counts are not numbers', () => {
  assert.match(
    plan({ ahead: Number.NaN, behind: 0 }).error!,
    /Could not count/,
  );
  assert.match(plan({ ahead: 0, behind: undefined }).error!, /Could not count/);
});

test('parses git cherry output into unmatched and equivalent commits', () => {
  const { unmatched, equivalent } = parseCherryOutput(
    [
      '- de45a82f229528b8607cb60f19c4c09c8b546ae3',
      '+ 1111111222222233333334444444555555566666',
      '',
      'not a cherry line',
    ].join('\n'),
  );
  assert.deepEqual(equivalent, ['de45a82f229528b8607cb60f19c4c09c8b546ae3']);
  assert.deepEqual(unmatched, ['1111111222222233333334444444555555566666']);
});

test('parses an empty or absent cherry output as no commits either way', () => {
  for (const input of ['', '   ', undefined, null]) {
    const parsed = parseCherryOutput(input);
    assert.deepEqual(parsed.unmatched, []);
    assert.deepEqual(parsed.equivalent, []);
  }
});

test('a pure rebase — every remote commit superseded — is the forceable case', () => {
  const { unmatched } = parseCherryOutput('- de45a82f229528b8607cb60f19c4c09c');
  const result = plan({
    ahead: 1,
    behind: 1,
    remoteSha: REMOTE_SHA,
    forceWithLease: true,
    unmatchedRemoteCommits: unmatched,
  });
  assert.equal(result.action, PUSH_ACTIONS.forceWithLease);
});

const record = (sha: string, author: string, subject: string): string =>
  [sha, author, subject].join(SEPARATOR);

test('parses git log records, keeping a subject that contains the separator-free text', () => {
  const parsed = parseCommitRecords(
    [
      record('aaaaaaa', 'me@example.com', 'feat: do a thing'),
      '',
      record('bbbbbbb', 'you@example.com', 'fix: undo it'),
    ].join('\n'),
  );
  assert.deepEqual(parsed, [
    { sha: 'aaaaaaa', author: 'me@example.com', subject: 'feat: do a thing' },
    { sha: 'bbbbbbb', author: 'you@example.com', subject: 'fix: undo it' },
  ]);
});

test('parses empty git log output as no commits', () => {
  assert.deepEqual(parseCommitRecords(''), []);
  assert.deepEqual(parseCommitRecords(undefined), []);
});

test('a patch-equivalent upstream commit is accounted for', () => {
  const orphans = findOrphanedRemoteCommits({
    remoteOnly: [
      { sha: 'aaa', author: 'me@x', subject: 'feat: x', patchEquivalent: true },
    ],
    localOnly: [],
  });
  assert.deepEqual(orphans, []);
});

// The regression that made this function necessary: the first version of this module used
// patch-id alone and refused to push its own PR, because the rebase had a conflict.
test('a conflict-resolved rebase is recognised by author and subject', () => {
  const orphans = findOrphanedRemoteCommits({
    remoteOnly: [
      {
        sha: 'old',
        author: 'me@x',
        subject: 'feat(tooling): let ai:create-pr push a rebased branch safely',
        patchEquivalent: false,
      },
    ],
    localOnly: [
      {
        sha: 'new',
        author: 'me@x',
        subject: 'feat(tooling): let ai:create-pr push a rebased branch safely',
      },
    ],
  });
  assert.deepEqual(orphans, [], 'the rewritten commit is the same work');
});

test('a teammate’s commit matches neither patch-id nor identity', () => {
  const orphans = findOrphanedRemoteCommits({
    remoteOnly: [
      {
        sha: 'theirs',
        author: 'them@y',
        subject: 'fix: their bug',
        patchEquivalent: false,
      },
    ],
    localOnly: [{ sha: 'mine', author: 'me@x', subject: 'feat: my thing' }],
  });
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].sha, 'theirs');
});

test('the same subject from a different author is not excused', () => {
  const orphans = findOrphanedRemoteCommits({
    remoteOnly: [
      {
        sha: 'theirs',
        author: 'them@y',
        subject: 'chore: bump',
        patchEquivalent: false,
      },
    ],
    localOnly: [{ sha: 'mine', author: 'me@x', subject: 'chore: bump' }],
  });
  assert.equal(orphans.length, 1, 'authorship is part of the identity');
});

test('one local commit cannot excuse two upstream commits', () => {
  const orphans = findOrphanedRemoteCommits({
    remoteOnly: [
      {
        sha: 'r1',
        author: 'me@x',
        subject: 'chore: bump',
        patchEquivalent: false,
      },
      {
        sha: 'r2',
        author: 'me@x',
        subject: 'chore: bump',
        patchEquivalent: false,
      },
    ],
    localOnly: [{ sha: 'l1', author: 'me@x', subject: 'chore: bump' }],
  });
  assert.equal(orphans.length, 1, 'matching is one-to-one');
  assert.equal(orphans[0].sha, 'r2');
});

test('an empty subject is never matched by identity', () => {
  const orphans = findOrphanedRemoteCommits({
    remoteOnly: [
      { sha: 'theirs', author: 'me@x', subject: '', patchEquivalent: false },
    ],
    localOnly: [{ sha: 'mine', author: 'me@x', subject: '' }],
  });
  assert.equal(
    orphans.length,
    1,
    'an empty subject would otherwise excuse every other empty one',
  );
});

test('the refusal names the orphaned commit and its subject', () => {
  const result = plan({
    ahead: 1,
    behind: 1,
    remoteSha: REMOTE_SHA,
    forceWithLease: true,
    unmatchedRemoteCommits: [{ sha: 'theirs', subject: 'fix: their bug' }],
  });
  assert.match(result.error!, /theirs/);
  assert.match(result.error!, /fix: their bug/);
});

// === The upstream is the base branch ===
//
// Sandcastle created every PRD integration branch with `git branch <name>
// origin/main`, and git's branch.autoSetupMerge default made that branch track
// main. Nothing measured against that upstream describes the branch's own
// remote, so the plan below it cannot be trusted.

test('refuses when the branch tracks the base branch', () => {
  const plan = decidePushPlan({
    hasUpstream: true,
    ahead: 17,
    behind: 7,
    branch: 'feat/ci-owned-host-apply',
    remoteSha: 'a'.repeat(40),
    upstreamBranch: 'main',
    baseBranch: 'main',
  });

  assert.ok(plan.error);
  assert.match(plan.error, /upstream is 'main', which is the PR's base branch/);
  assert.match(
    plan.error,
    /git branch --unset-upstream feat\/ci-owned-host-apply/,
  );
});

test('the base-branch guard runs before the divergence report', () => {
  // Without it, this input produces "forcing would destroy them" naming main's
  // own commits — alarming, and false.
  const plan = decidePushPlan({
    hasUpstream: true,
    ahead: 17,
    behind: 7,
    branch: 'feat/x',
    remoteSha: 'a'.repeat(40),
    unmatchedRemoteCommits: [{ sha: 'b'.repeat(40), subject: 'someone else' }],
    upstreamBranch: 'main',
    baseBranch: 'main',
  });

  assert.match(plan.error!, /base branch/);
  assert.ok(!plan.error!.includes('Forcing would destroy them'));
});

test('does not fire when the base branch is itself being pushed', () => {
  // Pushing main while on main is refused elsewhere, not here.
  const plan = decidePushPlan({
    hasUpstream: true,
    ahead: 1,
    behind: 0,
    branch: 'main',
    upstreamBranch: 'main',
    baseBranch: 'main',
  });

  assert.equal(plan.action, PUSH_ACTIONS.fastForward);
});

test('does not fire for a branch tracking its own remote', () => {
  const plan = decidePushPlan({
    hasUpstream: true,
    ahead: 3,
    behind: 0,
    branch: 'feat/x',
    upstreamBranch: 'feat/x',
    baseBranch: 'main',
  });

  assert.equal(plan.action, PUSH_ACTIONS.fastForward);
});

test('does not fire when the caller supplies no branch names', () => {
  // Older callers pass neither; they must keep working unchanged.
  const plan = decidePushPlan({
    hasUpstream: true,
    ahead: 3,
    behind: 0,
    branch: 'feat/x',
  });

  assert.equal(plan.action, PUSH_ACTIONS.fastForward);
});

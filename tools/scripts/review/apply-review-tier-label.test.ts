import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  DEFAULT_ATTEMPTS,
  applyReviewTierLabel,
} from './apply-review-tier-label.ts';

const SCRIPT = 'tools/scripts/review/apply-review-tier-label.ts';

const graphqlFlake = () => {
  const err = new Error(
    'GraphQL: Something went wrong while executing your query on 2026-09-15T09:55:23Z.',
  );
  err.stderr = err.message;
  return err;
};

const runApply = (over = {}) => {
  const calls = [];
  const sleeps = [];
  const warnings = [];
  const resultP = applyReviewTierLabel({
    pr: 789,
    label: 'review:agent',
    repo: 'mnaimfaizy/myorganiser',
    ghJsonCall: (args) => {
      calls.push(['json', ...args]);
      return { labels: [{ name: 'tooling' }] };
    },
    ghCall: (args) => {
      calls.push(['gh', ...args]);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    warn: (msg) => warnings.push(msg),
    ...over,
  });
  return resultP.then((result) => ({ result, calls, sleeps, warnings }));
};

test('applies the classifier label and removes a stale review:* label', async () => {
  const { result, calls, sleeps, warnings } = await runApply({
    ghJsonCall: () => ({
      labels: [{ name: 'tooling' }, { name: 'review:human' }],
    }),
  });
  assert.deepEqual(result, { applied: true, reason: 'updated' });
  assert.equal(sleeps.length, 0);
  assert.equal(warnings.length, 0);
  const edit = calls.find((c) => c[0] === 'gh');
  assert.deepEqual(edit, [
    'gh',
    'pr',
    'edit',
    '789',
    '--repo',
    'mnaimfaizy/myorganiser',
    '--add-label',
    'review:agent',
    '--remove-label',
    'review:human',
  ]);
});

test('does not call gh pr edit when the pull request already wears the label', async () => {
  const { result, calls } = await runApply({
    ghJsonCall: () => ({ labels: [{ name: 'review:agent' }] }),
  });
  assert.deepEqual(result, { applied: true, reason: 'already-labelled' });
  assert.equal(
    calls.filter((c) => c[0] === 'gh').length,
    0,
    'a no-op must not spend a GraphQL mutation',
  );
});

test('retries a GraphQL flake and succeeds', async () => {
  let edits = 0;
  const { result, sleeps, warnings } = await runApply({
    ghCall: () => {
      edits += 1;
      if (edits < 3) throw graphqlFlake();
    },
  });
  assert.deepEqual(result, { applied: true, reason: 'updated' });
  assert.equal(edits, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
  assert.equal(warnings.length, 0);
});

test('exhausted retries warn and do not throw: the job output still stands', async () => {
  const { result, sleeps, warnings } = await runApply({
    ghCall: () => {
      throw graphqlFlake();
    },
  });
  assert.deepEqual(result, { applied: false, reason: 'exhausted-retries' });
  assert.equal(sleeps.length, DEFAULT_ATTEMPTS - 1);
  assert.match(warnings[0], /could not apply review:agent after 3 attempts/);
  assert.match(warnings[0], /job output still stands/);
});

test('an unknown label is a no-op, not a failed required check', async () => {
  let called = false;
  const { result, warnings } = await runApply({
    label: 'review:ship',
    ghJsonCall: () => {
      called = true;
      return { labels: [] };
    },
  });
  assert.deepEqual(result, {
    applied: false,
    reason: 'not-a-review-tier-label',
  });
  assert.equal(called, false);
  assert.match(warnings[0], /not a review:\* label/);
});

test('CLI: missing args exit 2; a successful apply exits 0', () => {
  const missing = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--pr is required/);

  const noRepo = spawnSync(
    process.execPath,
    [SCRIPT, '--pr', '1', '--label', 'review:human'],
    { encoding: 'utf8' },
  );
  assert.equal(noRepo.status, 2);
  assert.match(noRepo.stderr, /--repo is required/);
});

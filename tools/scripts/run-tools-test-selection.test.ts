// Contracts for the Husky-facing orchestration: selecting suites, composing
// the message, and propagating the exit code. `selectAndRun` is pure given
// its collaborators, so this drives it with stubbed staged files, suites,
// and runner — never a real git repository or a real `node --test` child
// process. The pure selection decision itself is covered by
// tools/scripts/lib/tools-test-selection.ts's own Contract Suite; the three
// functions that touch git, the filesystem, or a child process are IO and
// untested here, the same as any other checker's CLI shell in this codebase.
import assert from 'node:assert/strict';
import test from 'node:test';

import { selectAndRun } from './run-tools-test-selection.ts';

const SUITES = ['tools/scripts/check-a.test.mjs'];

test('a staged script runs its paired suite and exits 0 when it passes', () => {
  const runCalls: string[][] = [];
  const result = selectAndRun({
    stagedFiles: ['tools/scripts/check-a.mjs'],
    suites: SUITES,
    runTest: (selected) => {
      runCalls.push(selected);
      return 0;
    },
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.selected, ['tools/scripts/check-a.test.mjs']);
  assert.deepEqual(runCalls, [['tools/scripts/check-a.test.mjs']]);
  assert.match(result.message, /running 1 suite\(s\)/);
  assert.match(result.message, /check-a\.test\.mjs/);
});

test('a selected suite that fails exits 1', () => {
  const result = selectAndRun({
    stagedFiles: ['tools/scripts/check-a.mjs'],
    suites: SUITES,
    runTest: () => 1,
  });

  assert.equal(result.exitCode, 1);
});

test('a commit with no staged tools/scripts file runs nothing and exits 0', () => {
  let ran = false;
  const result = selectAndRun({
    stagedFiles: ['README.md'],
    suites: SUITES,
    runTest: () => {
      ran = true;
      return 1;
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(ran, false);
  assert.match(result.message, /no staged tools\/scripts suite to run/);
});

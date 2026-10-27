// Contract Suite for lib/spawn-failure.ts.
//
// Run: node --test tools/scripts/lib/spawn-failure.test.ts
// Reached by `yarn tools:test`, which globs every suite under tools/scripts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { spawnFailure } from './spawn-failure.ts';

test('a real execFileSync throw gives up its status and both streams', () => {
  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    assert.fail('expected the child to exit non-zero');
  } catch (error) {
    assert.deepEqual(spawnFailure(error), {
      status: 3,
      stdout: 'out',
      stderr: 'err',
    });
  }
});

test('a child that wrote nothing yields empty strings, never undefined', () => {
  try {
    execFileSync(process.execPath, ['-e', 'process.exit(1)'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.fail('expected the child to exit non-zero');
  } catch (error) {
    assert.deepEqual(spawnFailure(error), {
      status: 1,
      stdout: '',
      stderr: '',
    });
  }
});

test('a value that is not a spawn failure reads as an absent status', () => {
  for (const thrown of [new Error('boom'), 'a string', undefined, null, 7]) {
    assert.deepEqual(
      spawnFailure(thrown),
      { status: undefined, stdout: '', stderr: '' },
      `${String(thrown)} should not invent a status`,
    );
  }
});

test('a non-numeric status is not passed through as one', () => {
  assert.equal(spawnFailure({ status: '1' }).status, undefined);
});

/**
 * Tests for release-cut.ts against a real scratch git repository: the
 * `git status` read, the leftover check, and the failure wrapping that
 * `release:cut` relies on once the release branch exists.
 *
 * Run with: node --test tools/scripts/lib/release-cut.test.ts
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AbandonedCutError,
  assertNothingLeftUnstaged,
  readUnstagedPaths,
  runOrAbandonCut,
} from './release-cut.ts';

const RELEASE_BRANCH = 'release/v1.2.3';

function scratchRepo(t: TestContext) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'release-cut-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const git = (args: string) =>
    execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init -q');
  git('config user.email release-cut@test.invalid');
  git('config user.name release-cut-test');
  git('config commit.gpgsign false');
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"version":"1.0.0"}\n');
  fs.writeFileSync(path.join(cwd, 'routes.ts'), 'export {};\n');
  git('add package.json routes.ts');
  git('commit -q -m init');

  return { cwd, git };
}

test('reads a clean tree as nothing unstaged', (t) => {
  const { cwd } = scratchRepo(t);
  assert.deepEqual(readUnstagedPaths({ cwd }), []);
});

test('reads an unstaged edit on the first status line', (t) => {
  // The first porcelain line starts with a space for an unstaged edit; a
  // trimmed read would take it for a staged one and pass the check.
  const { cwd } = scratchRepo(t);
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"version":"1.2.3"}\n');

  assert.deepEqual(readUnstagedPaths({ cwd }), ['package.json']);
});

test('reads staged edits as nothing unstaged, untracked files as unstaged', (t) => {
  const { cwd, git } = scratchRepo(t);
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"version":"1.2.3"}\n');
  git('add package.json');
  assert.deepEqual(readUnstagedPaths({ cwd }), []);

  fs.writeFileSync(path.join(cwd, 'stray.ts'), 'export {};\n');
  assert.deepEqual(readUnstagedPaths({ cwd }), ['stray.ts']);
});

test('the leftover check passes a fully staged release commit', (t) => {
  const { cwd, git } = scratchRepo(t);
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"version":"1.2.3"}\n');
  git('add package.json');

  assert.doesNotThrow(() => assertNothingLeftUnstaged(RELEASE_BRANCH, { cwd }));
});

test('the leftover check refuses drift and names the way back', (t) => {
  const { cwd, git } = scratchRepo(t);
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"version":"1.2.3"}\n');
  git('add package.json');
  fs.writeFileSync(path.join(cwd, 'routes.ts'), 'export const drift = 1;\n');

  assert.throws(
    () => assertNothingLeftUnstaged(RELEASE_BRANCH, { cwd }),
    (error) =>
      error instanceof AbandonedCutError &&
      error.message.includes('  - routes.ts') &&
      !error.message.includes('  - package.json') &&
      error.message.includes(`git branch -D ${RELEASE_BRANCH}`),
  );
});

test('a failing step becomes an abandoned cut naming the way back', () => {
  assert.throws(
    () =>
      runOrAbandonCut('node -e "process.exit(3)"', RELEASE_BRANCH, {
        stdio: 'ignore',
      }),
    (error) =>
      error instanceof AbandonedCutError &&
      error.message.startsWith('`node -e "process.exit(3)"` failed') &&
      error.message.includes('git checkout -f main') &&
      error.message.includes(`git branch -D ${RELEASE_BRANCH}`),
  );
});

test('a succeeding step runs in the given directory and returns', (t) => {
  const { cwd } = scratchRepo(t);

  runOrAbandonCut(
    "node -e \"require('fs').writeFileSync('ran.txt', '')\"",
    RELEASE_BRANCH,
    { cwd, stdio: 'ignore' },
  );

  assert.ok(fs.existsSync(path.join(cwd, 'ran.txt')));
});

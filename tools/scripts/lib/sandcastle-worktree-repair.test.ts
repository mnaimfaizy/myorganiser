import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { COMPLETION_PROMISE } from './sandcastle-outcome.ts';
import {
  gitEnvironment,
  inspectWorktree,
  isCleanupOnlyFailure,
  repairOrphanedWorktree,
  WORKTREE_STATES,
} from './sandcastle-worktree-repair.ts';
import { isolateGitEnvironment } from './git-environment.ts';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.ts.
isolateGitEnvironment();

const BRANCH = 'slice/1-demo';

const git = (cwd: string, ...args: string[]) => {
  // gitEnvironment: under a pre-commit hook the inherited GIT_INDEX_FILE would
  // send every call in the scratch repo to the hook's own index.
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: gitEnvironment(),
  });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

/** A repo with one commit and a linked worktree on BRANCH, like a slice run. */
function sliceRepo(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'worktree-repair-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  writeFileSync(join(root, 'tracked.txt'), 'base\n');
  git(root, 'add', 'tracked.txt');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'branch', BRANCH);
  const worktreePath = join(root, '.sandcastle', 'worktrees', 'slice-1-demo');
  git(root, 'worktree', 'add', '-q', worktreePath, BRANCH);
  return { root, worktreePath };
}

/** What `git worktree prune` does to the slice from inside the sandbox. */
const orphan = ({ root }: { root: string }) =>
  rmSync(join(root, '.git', 'worktrees', 'slice-1-demo'), {
    recursive: true,
    force: true,
  });

test('a missing directory is absent and left alone', () => {
  const path = join(tmpdir(), 'worktree-repair-does-not-exist');
  assert.equal(inspectWorktree(path), WORKTREE_STATES.absent);
  assert.deepEqual(
    repairOrphanedWorktree({ worktreePath: path, branch: BRANCH }),
    {
      state: WORKTREE_STATES.absent,
      repaired: false,
    },
  );
});

test('a healthy worktree is not rewritten', (t) => {
  const repo = sliceRepo(t);
  const result = repairOrphanedWorktree({
    worktreePath: repo.worktreePath,
    branch: BRANCH,
  });
  assert.deepEqual(result, { state: WORKTREE_STATES.healthy, repaired: false });
});

test('a plain directory with no .git file is foreign and untouched', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'worktree-repair-plain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(inspectWorktree(dir), WORKTREE_STATES.foreign);
});

test('a pruned slice worktree is re-registered on its branch with edits kept', (t) => {
  const repo = sliceRepo(t);
  writeFileSync(join(repo.worktreePath, 'tracked.txt'), 'edited\n');
  writeFileSync(join(repo.worktreePath, 'new.txt'), 'new\n');
  orphan(repo);
  assert.equal(inspectWorktree(repo.worktreePath), WORKTREE_STATES.orphaned);

  const result = repairOrphanedWorktree({
    worktreePath: repo.worktreePath,
    branch: BRANCH,
  });

  assert.deepEqual(result, { state: WORKTREE_STATES.orphaned, repaired: true });
  assert.match(
    git(repo.root, 'worktree', 'list'),
    /slice-1-demo .*\[slice\/1-demo\]/,
  );
  assert.equal(
    spawnSync('git', ['status', '--porcelain'], {
      cwd: repo.worktreePath,
      encoding: 'utf8',
      env: gitEnvironment(),
    }).stdout,
    ' M tracked.txt\n?? new.txt\n',
  );
  assert.equal(
    readFileSync(join(repo.worktreePath, 'tracked.txt'), 'utf8'),
    'edited\n',
  );
});

test('a repaired worktree with no edits reads clean and can be removed', (t) => {
  const repo = sliceRepo(t);
  orphan(repo);
  repairOrphanedWorktree({ worktreePath: repo.worktreePath, branch: BRANCH });
  assert.equal(git(repo.worktreePath, 'status', '--porcelain'), '');
  git(repo.root, 'worktree', 'remove', '--force', repo.worktreePath);
});

test('an orphan whose branch is gone is reported, not half-repaired', (t) => {
  const repo = sliceRepo(t);
  orphan(repo);
  const result = repairOrphanedWorktree({
    worktreePath: repo.worktreePath,
    branch: 'slice/2-missing',
  });
  assert.equal(result.repaired, false);
  assert.match(result.error!, /does not exist/);
  assert.equal(inspectWorktree(repo.worktreePath), WORKTREE_STATES.orphaned);
});

test('an orphan whose pointer leaves .git/worktrees is foreign', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'worktree-repair-odd-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'sub'));
  writeFileSync(
    join(dir, 'sub', '.git'),
    `gitdir: ${join(dir, 'elsewhere')}\n`,
  );
  assert.equal(inspectWorktree(join(dir, 'sub')), WORKTREE_STATES.foreign);
});

const CLEANUP_ERROR =
  "(FiberFailure) WorktreeError: fatal: '/repo/.sandcastle/worktrees/slice-1-demo' is not a working tree";
const runLog = (...lines: string[]) =>
  ['--- Run started: 2026-10-17T07:30:00.000Z ---', ...lines].join('\n');

test('a cleanup failure after the completion promise is a finished run', () => {
  assert.equal(
    isCleanupOnlyFailure({
      errorText: CLEANUP_ERROR,
      logText: runLog('Iteration 1/2', COMPLETION_PROMISE, 'Agent stopped'),
      completionPromise: COMPLETION_PROMISE,
    }),
    true,
  );
});

test('a cleanup failure without the completion promise is still a crash', () => {
  assert.equal(
    isCleanupOnlyFailure({
      errorText: CLEANUP_ERROR,
      logText: runLog('Iteration 1/2', 'HANDOFF: TestScaffold -> TestReviewer'),
      completionPromise: COMPLETION_PROMISE,
    }),
    false,
  );
});

test('a promise from an earlier iteration does not excuse the last one', () => {
  assert.equal(
    isCleanupOnlyFailure({
      errorText: CLEANUP_ERROR,
      logText: runLog(
        'Iteration 1/2',
        COMPLETION_PROMISE,
        'Iteration 2/2',
        'killed',
      ),
      completionPromise: COMPLETION_PROMISE,
    }),
    false,
  );
});

test('any other error after the completion promise is still a crash', () => {
  assert.equal(
    isCleanupOnlyFailure({
      errorText: "AgentError: You've hit your session limit",
      logText: runLog('Iteration 1/2', COMPLETION_PROMISE),
      completionPromise: COMPLETION_PROMISE,
    }),
    false,
  );
});

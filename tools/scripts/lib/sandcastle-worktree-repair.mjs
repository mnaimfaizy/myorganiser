/**
 * Re-registers a slice worktree whose git admin directory was deleted.
 *
 * A linked worktree is two halves: the directory under `.sandcastle/worktrees/`
 * (with a `.git` FILE pointing at its admin directory) and the admin directory
 * itself, `.git/worktrees/<name>/`. Inside the sandbox the admin directory's
 * `gitdir` names a host path the container cannot see, so a `git worktree prune`
 * run there judges the slice's own worktree stale and deletes its admin half.
 * The files survive; git no longer knows them. Every later git call in the
 * directory — the run's own cleanup, the crash checkpoint, the resume rebuild —
 * fails with "is not a working tree", and the slice reads as crashed after its
 * agent finished (PRD #1206, slice #1207).
 *
 * Repair rewrites the admin directory from what is already known — the path the
 * `.git` file names and the slice branch — then rebuilds the index from the
 * branch tip. Working-tree files are never touched, so uncommitted edits stay
 * visible to the checkpoint capture that runs next.
 *
 * Run the tests with: yarn sandcastle:worktree-repair:test
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { lastIterationOutput } from './sandcastle-outcome.mjs';

/**
 * - `absent`   — no directory; nothing to repair.
 * - `healthy`  — the admin directory exists; git can use the worktree.
 * - `orphaned` — the `.git` file points at an admin directory that is gone.
 * - `foreign`  — not a linked worktree this module may touch (no `.git` file,
 *                or a pointer outside a `<repo>/.git/worktrees/` directory).
 */
export const WORKTREE_STATES = Object.freeze({
  absent: 'absent',
  healthy: 'healthy',
  orphaned: 'orphaned',
  foreign: 'foreign',
});

/** The admin directory a worktree's `.git` file names, or null. */
export function readWorktreePointer(worktreePath) {
  const dotGit = join(worktreePath, '.git');
  if (!existsSync(dotGit) || !statSync(dotGit).isFile()) return null;
  const match = readFileSync(dotGit, 'utf8')
    .trim()
    .match(/^gitdir:\s*(.+)$/);
  return match ? resolve(worktreePath, match[1].trim()) : null;
}

export function inspectWorktree(worktreePath) {
  if (!existsSync(worktreePath)) return WORKTREE_STATES.absent;
  const adminDir = readWorktreePointer(worktreePath);
  if (!adminDir || basename(dirname(adminDir)) !== 'worktrees') {
    return WORKTREE_STATES.foreign;
  }
  return existsSync(adminDir)
    ? WORKTREE_STATES.healthy
    : WORKTREE_STATES.orphaned;
}

const git = (cwd, args) =>
  spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

/**
 * Re-register `worktreePath` on `branch` if its admin directory is gone.
 *
 * Returns `{ state, repaired, error? }`. `repaired` is true only when this call
 * rebuilt the admin directory and git then recognised the worktree on `branch`.
 * A failed repair removes what it wrote, leaving the directory as it found it.
 */
export function repairOrphanedWorktree({ worktreePath, branch }) {
  const state = inspectWorktree(worktreePath);
  if (state !== WORKTREE_STATES.orphaned) return { state, repaired: false };

  const adminDir = readWorktreePointer(worktreePath);
  const commonDir = dirname(dirname(adminDir));
  if (!existsSync(join(commonDir, 'HEAD'))) {
    return {
      state,
      repaired: false,
      error: `${commonDir} is not a git directory`,
    };
  }
  const ref = `refs/heads/${branch}`;
  if (git(commonDir, ['rev-parse', '--verify', '--quiet', ref]).status !== 0) {
    return { state, repaired: false, error: `branch ${branch} does not exist` };
  }

  mkdirSync(adminDir, { recursive: true });
  writeFileSync(join(adminDir, 'commondir'), '../..\n');
  writeFileSync(
    join(adminDir, 'gitdir'),
    `${join(resolve(worktreePath), '.git')}\n`,
  );
  writeFileSync(join(adminDir, 'HEAD'), `ref: ${ref}\n`);

  // The index went with the admin directory. Rebuild it from the branch tip so
  // status reports exactly what differs on disk, not every file as new.
  const readTree = git(worktreePath, ['read-tree', 'HEAD']);
  git(worktreePath, ['update-index', '-q', '--refresh']);
  const head = git(worktreePath, ['symbolic-ref', '--short', 'HEAD']);
  if (readTree.status !== 0 || head.stdout.trim() !== branch) {
    rmSync(adminDir, { recursive: true, force: true });
    return {
      state,
      repaired: false,
      error: (
        readTree.stderr ||
        head.stderr ||
        'git rejected the repair'
      ).trim(),
    };
  }
  return { state, repaired: true };
}

/**
 * Did the run fail only because sandcastle's own cleanup met an orphaned
 * worktree, after the agent had already finished?
 *
 * Sandcastle has no hook between the agent finishing and its cleanup, so the
 * repair above cannot run in time; the cleanup throws and `run()` rejects with
 * no result. When the thrown error is that cleanup failure and the last
 * iteration in the log carries the completion promise, the work is finished:
 * the orchestrator repairs the worktree and finalizes it like any completed run
 * instead of reporting a crash.
 *
 * @param {{ errorText: string, logText: string, completionPromise: string }} input
 */
export function isCleanupOnlyFailure({
  errorText,
  logText,
  completionPromise,
}) {
  return (
    /is not a working tree/.test(String(errorText ?? '')) &&
    lastIterationOutput(logText).includes(completionPromise)
  );
}

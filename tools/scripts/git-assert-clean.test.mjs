// Contract suite for git-assert-clean.mjs.
//
// The script is the second half of every "regenerate a derived artifact, then
// assert the tree did not move" gate: `openapi:check` and, since ADR 0098,
// `design-tokens:check`. It took a `label` argument when the second call site
// arrived, so what is asserted here is the pair of things that argument changed:
// the default still reads `openapi-check`, and a caller that names itself is the
// name that appears in the output. A gate that reports the wrong gate's name is
// the ADR 0098 failure mode one level down — a true message about the wrong
// thing — and the exit code is what CI reads either way.
//
// Spawned rather than imported: the script decides at module scope and calls
// process.exit, so there is nothing to call. Each case gets its own throwaway
// repository, because the subject is literally `git status --porcelain` in cwd.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isolateGitEnvironment } from './lib/git-environment.ts';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.ts.
isolateGitEnvironment();

const SCRIPT = fileURLToPath(
  new URL('./git-assert-clean.mjs', import.meta.url),
);

/** A repository with one commit, so a clean tree is actually reachable. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'git-assert-clean-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      stdio: 'ignore',
    });
  git('init', '--quiet');
  // Identity and signing are set locally: a contributor's global config must not
  // decide whether this suite can commit.
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'tracked.txt'), 'one\n');
  git('add', 'tracked.txt');
  git('commit', '--quiet', '-m', 'seed');
  return { dir, git };
};

const run = (dir, ...args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
  });

test('a clean tree passes, and the default label is the openapi one', () => {
  const { dir } = repo();
  try {
    const out = run(dir);
    assert.equal(out.status, 0);
    assert.match(out.stdout, /\[openapi-check\] Working tree is clean\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a caller that names itself is the name in the output', () => {
  const { dir } = repo();
  try {
    const out = run(dir, 'design-tokens-check');
    assert.equal(out.status, 0);
    assert.match(out.stdout, /\[design-tokens-check\] Working tree is clean\./);
    // The point of the argument: the other gate's name must not appear at all.
    assert.doesNotMatch(out.stdout, /openapi-check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a dirty tree fails under either label, naming what moved', () => {
  for (const [args, expected] of [
    [[], 'openapi-check'],
    [['design-tokens-check'], 'design-tokens-check'],
  ]) {
    const { dir } = repo();
    try {
      // A modification and an untracked file: porcelain reports both, and the
      // whole value of this gate is that it prints which.
      writeFileSync(join(dir, 'tracked.txt'), 'two\n');
      writeFileSync(join(dir, 'generated.txt'), 'new\n');
      const out = run(dir, ...args);
      assert.equal(out.status, 1);
      assert.match(
        out.stderr,
        new RegExp(
          `\\[${expected}\\] Working tree is not clean after generation\\.`,
        ),
      );
      assert.match(out.stderr, /tracked\.txt/);
      assert.match(out.stderr, /generated\.txt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

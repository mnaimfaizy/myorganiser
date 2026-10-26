import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isolateGitEnvironment } from './git-environment.ts';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.ts.
isolateGitEnvironment();

const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(SCRIPTS_DIR, '../..');

const git = (cwd: string, ...args: string[]): string => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

function listSuites(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : listSuites(path);
    }
    return /\.test\.(mjs|ts)$/.test(entry.name) ? [path] : [];
  });
}

/** A suite that spawns processes and builds a repository with `git init`. */
const initsRepository = (source: string): boolean =>
  /from 'node:child_process'/.test(source) &&
  /['"]init['"]|\bgit init\b/.test(source);

/**
 * An outer repository with a linked worktree, and the environment git exports
 * to a pre-commit hook run in that worktree.
 */
function hookedWorktree(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'git-environment-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const primary = join(root, 'primary');
  git(root, 'init', '-q', '-b', 'main', primary);
  git(primary, 'config', 'user.email', 'outer@example.com');
  git(primary, 'config', 'user.name', 'outer');
  git(primary, 'commit', '-q', '--allow-empty', '-m', 'outer');
  git(primary, 'worktree', 'add', '-q', '-b', 'hooked', join(root, 'linked'));
  const adminDir = git(join(root, 'linked'), 'rev-parse', '--absolute-git-dir');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_DIR: adminDir,
    GIT_INDEX_FILE: join(adminDir, 'index'),
  };
  // A nested `node --test` that inherits this skips itself instead of running.
  delete env.NODE_TEST_CONTEXT;

  const snapshot = () => ({
    branch: git(primary, 'rev-parse', 'refs/heads/hooked'),
    config: readFileSync(join(primary, '.git', 'config'), 'utf8'),
  });
  return { root, primary, env, before: snapshot(), snapshot };
}

test('isolateGitEnvironment deletes every GIT_* variable and keeps the rest', () => {
  process.env.GIT_DIR = '/elsewhere/.git';
  process.env.GIT_INDEX_FILE = '/elsewhere/.git/index';
  process.env.NOT_GIT_DIR = 'kept';

  isolateGitEnvironment();

  assert.equal(process.env.GIT_DIR, undefined);
  assert.equal(process.env.GIT_INDEX_FILE, undefined);
  assert.equal(process.env.NOT_GIT_DIR, 'kept');
  delete process.env.NOT_GIT_DIR;
});

test('every tools/scripts suite that runs git init isolates its git environment', () => {
  const initSuites = listSuites(SCRIPTS_DIR).filter((path) =>
    initsRepository(readFileSync(path, 'utf8')),
  );
  const names = initSuites.map((path) => relative(REPO_ROOT, path));
  // A detector that matched nothing would pass vacuously.
  assert.ok(
    names.includes('tools/scripts/check-fix-attribution.test.mjs'),
    `detector missed a known git-init suite; found: ${names.join(', ')}`,
  );

  const unisolated = initSuites
    .filter(
      (path) =>
        !/^isolateGitEnvironment\(\);$/m.test(readFileSync(path, 'utf8')),
    )
    .map((path) => relative(REPO_ROOT, path));
  assert.deepEqual(
    unisolated,
    [],
    'call isolateGitEnvironment() from tools/scripts/lib/git-environment.ts at module top level',
  );
});

test('under a hook GIT_DIR, an unisolated git init flips the primary checkout to bare', (t) => {
  // The control: proves `hookedWorktree` reproduces the hook, so the next
  // test's "untouched" is evidence and not a harness that never leaked.
  const hooked = hookedWorktree(t);
  const fixture = join(hooked.root, 'fixture.mjs');
  writeFileSync(
    fixture,
    `import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
spawnSync('git', ['init', '-q'], { cwd: mkdtempSync(join(tmpdir(), 'leak-')) });
`,
  );

  spawnSync(process.execPath, [fixture], { env: hooked.env });

  assert.equal(git(hooked.primary, 'config', 'core.bare'), 'true');
});

test('a git-init suite run under a hook GIT_DIR leaves the outer repository untouched', (t) => {
  const hooked = hookedWorktree(t);

  const result = spawnSync(
    process.execPath,
    ['--test', join(SCRIPTS_DIR, 'check-fix-attribution.test.mjs')],
    { cwd: REPO_ROOT, env: hooked.env, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(hooked.snapshot(), hooked.before);
});

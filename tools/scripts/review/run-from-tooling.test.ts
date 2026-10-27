// run-from-tooling.ts (ADR 0102): the one place that gives a review script
// the tooling copy as its working directory and the caller's repository as
// its git. Each test spawns it the way the replay and the shared action do.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(
  new URL('./run-from-tooling.ts', import.meta.url),
);
const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const REPO_GIT_DIR = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
  cwd: REPO,
  encoding: 'utf8',
}).trim();

const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'run-from-tooling-')));
  scratch.push(dir);
  return dir;
};

/**
 * An extracted tooling copy, as the replay makes one: this script plus a
 * probe under tools/scripts that reports where it ran and exits with the code
 * it is given.
 */
const toolingCopy = () => {
  const root = tempDir();
  mkdirSync(join(root, 'tools', 'scripts', 'review'), { recursive: true });
  const copy = join(root, 'tools', 'scripts', 'review', 'run-from-tooling.ts');
  copyFileSync(SCRIPT, copy);
  writeFileSync(
    join(root, 'tools', 'scripts', 'probe.mjs'),
    [
      'console.log(JSON.stringify({ cwd: process.cwd(), gitDir: process.env.GIT_DIR, args: process.argv.slice(2) }));',
      'process.exit(Number(process.argv[2] ?? 0));',
    ].join('\n'),
  );
  return { root, copy };
};

const run = (script, args, cwd) =>
  spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });

test('no script argument is a usage error, exit 2', () => {
  const r = run(SCRIPT, [], REPO);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: run-from-tooling\.mjs <script>/);
});

test('a caller outside any git repository is refused, exit 2', () => {
  const outside = tempDir();
  const r = run(SCRIPT, ['review/select-obligations.ts'], outside);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /is not in a git repository/);
});

test("the script runs in the tooling copy against the caller's repository", () => {
  const { root, copy } = toolingCopy();
  const r = run(copy, ['probe.mjs', '0', '--out', '/abs/path'], REPO);
  assert.equal(r.status, 0, r.stderr);
  const seen = JSON.parse(r.stdout);
  assert.equal(seen.cwd, root);
  assert.equal(seen.gitDir, REPO_GIT_DIR);
  assert.deepEqual(seen.args, ['0', '--out', '/abs/path']);
});

test("the wrapped script's own exit status is passed through", () => {
  const { copy } = toolingCopy();
  assert.equal(run(copy, ['probe.mjs', '1'], REPO).status, 1);
  assert.equal(run(copy, ['probe.mjs', '7'], REPO).status, 7);
});

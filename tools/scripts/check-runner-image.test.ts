import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKER = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-runner-image.ts',
);

function createRepo(t: TestContext, files: Record<string, string>) {
  const workspace = mkdtempSync(join(tmpdir(), 'runner-image-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(workspace, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return workspace;
}

const run = (cwd: string) =>
  spawnSync(process.execPath, [CHECKER, cwd], { encoding: 'utf8' });

const pinned = (jobId: string) =>
  `  ${jobId}:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo ok\n`;

test('passes when every job pins ubuntu-24.04', (t) => {
  const cwd = createRepo(t, {
    '.github/workflows/ci.yml': `name: CI\njobs:\n${pinned('test')}${pinned('lint')}`,
  });
  const result = run(cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK — 2 job\(s\) pin ubuntu-24\.04/);
});

test('fails a job on ubuntu-latest and names the file and job', (t) => {
  const cwd = createRepo(t, {
    '.github/workflows/ci.yml': `name: CI\njobs:\n${pinned('lint')}  test:\n    runs-on: ubuntu-latest\n`,
  });
  const result = run(cwd);
  assert.equal(result.status, 1, result.stdout);
  assert.match(
    result.stderr,
    /\.github\/workflows\/ci\.yml job test runs-on is ubuntu-latest/,
  );
});

test('fails a job with no runs-on', (t) => {
  const cwd = createRepo(t, {
    '.github/workflows/ci.yml':
      'name: CI\njobs:\n  test:\n    steps:\n      - run: echo ok\n',
  });
  const result = run(cwd);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /job test runs-on is missing/);
});

test('accepts a quoted pin and rejects a second runs-on in the same job', (t) => {
  const quoted = createRepo(t, {
    '.github/workflows/ci.yml':
      'name: CI\njobs:\n  test:\n    runs-on: "ubuntu-24.04"\n',
  });
  assert.equal(run(quoted).status, 0);

  const doubled = createRepo(t, {
    '.github/workflows/ci.yml':
      'name: CI\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    runs-on: ubuntu-latest\n',
  });
  const result = run(doubled);
  assert.equal(result.status, 1, result.stdout);
  assert.match(
    result.stderr,
    /job test runs-on is ubuntu-24\.04, ubuntu-latest/,
  );
});

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isolateGitEnvironment } from '../lib/git-environment.mjs';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.mjs.
isolateGitEnvironment();

const HERE = dirname(fileURLToPath(import.meta.url));
const DETECTOR = join(HERE, 'dependency-manifest-changed.mjs');

/**
 * The detector diffs two commits, so every fixture is a real repository with
 * a base commit and a head commit on top of it.
 */
function createRepo(t, files) {
  const workspace = mkdtempSync(join(tmpdir(), 'dependency-manifest-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  git(workspace, 'init', '-q');
  for (const [path, contents] of Object.entries(files)) {
    write(workspace, path, contents);
  }
  return { workspace, base: commit(workspace, 'base') };
}

function git(workspace, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args],
    { cwd: workspace, encoding: 'utf8' },
  ).trim();
}

function write(workspace, relative, contents) {
  const path = join(workspace, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function commit(workspace, message) {
  git(workspace, 'add', '-A');
  git(workspace, 'commit', '-q', '--allow-empty', '-m', message);
  return git(workspace, 'rev-parse', 'HEAD');
}

const manifest = (fields) => `${JSON.stringify(fields, null, 2)}\n`;

function detect({ workspace, base }, head = 'HEAD') {
  return spawnSync(process.execPath, [DETECTOR, base, head], {
    cwd: workspace,
    encoding: 'utf8',
  });
}

function assertAudit(result, expected) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), String(expected), result.stderr);
}

test('a manifest that only moved is not a dependency change', (t) => {
  const repo = createRepo(t, {
    'libs/web-ui/package.json': manifest({
      name: 'web-ui',
      packageManager: 'yarn@4.13.0',
    }),
  });
  git(repo.workspace, 'mv', 'libs/web-ui', 'libs/web-ui-moved');
  commit(repo.workspace, 'move');

  assertAudit(detect(repo), false);
});

test('a moved manifest whose dependencies also changed is audited', (t) => {
  const repo = createRepo(t, {
    'libs/a/package.json': manifest({ name: 'a', dependencies: { x: '1' } }),
  });
  git(repo.workspace, 'mv', 'libs/a', 'libs/b');
  write(
    repo.workspace,
    'libs/b/package.json',
    manifest({ name: 'a', dependencies: { x: '2' } }),
  );
  commit(repo.workspace, 'move and bump');

  const result = detect(repo);
  assertAudit(result, true);
  assert.match(result.stderr, /libs\/b\/package\.json dependency fields/);
});

test('a new manifest carrying dependencies is audited', (t) => {
  const repo = createRepo(t, { 'README.md': 'x\n' });
  write(
    repo.workspace,
    'libs/new/package.json',
    manifest({ dependencies: { z: '1' } }),
  );
  commit(repo.workspace, 'add');

  assertAudit(detect(repo), true);
});

test('a deleted manifest carrying dependencies is audited', (t) => {
  const repo = createRepo(t, {
    'libs/gone/package.json': manifest({ dependencies: { y: '1' } }),
    'README.md': 'x\n',
  });
  git(repo.workspace, 'rm', '-rq', 'libs/gone');
  commit(repo.workspace, 'delete');

  assertAudit(detect(repo), true);
});

test('a scripts-only manifest edit is not a dependency change', (t) => {
  const repo = createRepo(t, {
    'package.json': manifest({ name: 'root', scripts: { t: 'a' } }),
  });
  write(
    repo.workspace,
    'package.json',
    manifest({ name: 'root', scripts: { t: 'b' } }),
  );
  commit(repo.workspace, 'scripts');

  assertAudit(detect(repo), false);
});

test('reordering dependency keys alone is not a dependency change', (t) => {
  const repo = createRepo(t, {
    'package.json': manifest({ dependencies: { a: '1', b: '2' } }),
  });
  write(
    repo.workspace,
    'package.json',
    manifest({ dependencies: { b: '2', a: '1' } }),
  );
  commit(repo.workspace, 'reorder');

  assertAudit(detect(repo), false);
});

for (const file of ['yarn.lock', '.yarnrc.yml']) {
  test(`an edit to ${file} is always audited`, (t) => {
    const repo = createRepo(t, { [file]: 'one\n' });
    write(repo.workspace, file, 'two\n');
    commit(repo.workspace, 'edit');

    assertAudit(detect(repo), true);
  });

  test(`a rename of ${file} is always audited`, (t) => {
    const repo = createRepo(t, { [file]: 'same\n' });
    git(repo.workspace, 'mv', file, `${file}.old`);
    commit(repo.workspace, 'rename');

    assertAudit(detect(repo), true);
  });
}

test('an unparseable manifest exits non-zero so the workflow audits anyway', (t) => {
  const repo = createRepo(t, { 'package.json': manifest({ name: 'root' }) });
  write(repo.workspace, 'package.json', '{ not json');
  commit(repo.workspace, 'break');

  const result = detect(repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unparseable JSON/);
});

test('missing arguments exit 2 with usage', () => {
  const result = spawnSync(process.execPath, [DETECTOR], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage/);
});

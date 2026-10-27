// Contract Suite for check-tools-mjs.ts: it fails on the drift its header
// claims to catch — an `.mjs` anywhere under the scripts directory — and
// passes the real tree.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-tools-mjs.ts');
const REPO_ROOT = resolve(HERE, '../..');

function createScriptsDir(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tools-mjs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFile(scriptsDir: string, relPath: string, content = '') {
  const path = join(scriptsDir, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function runChecker(scriptsDir: string, cwd = process.cwd()) {
  return spawnSync(process.execPath, [CHECKER, scriptsDir], {
    cwd,
    encoding: 'utf8',
  });
}

test('passes the real tools/scripts tree', () => {
  const result = runChecker('tools/scripts', REPO_ROOT);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 \.mjs files/);
});

test('passes a tree of .ts scripts, suites, and non-script files', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeFile(scriptsDir, 'check-a.ts', 'export {};\n');
  writeFile(scriptsDir, 'check-a.test.ts', 'export {};\n');
  writeFile(scriptsDir, 'lib/helper.ts', 'export {};\n');
  writeFile(scriptsDir, 'youtube-cron.sh', '#!/bin/sh\n');
  writeFile(scriptsDir, 'package.json', '{}\n');

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 0, result.stderr);
});

test('fails on a top-level .mjs script, naming it', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeFile(scriptsDir, 'check-a.ts', 'export {};\n');
  writeFile(scriptsDir, 'check-b.mjs', 'export {};\n');

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /check-b\.mjs/);
  assert.doesNotMatch(result.stderr, /check-a\.ts/);
});

test('fails on an .mjs at any depth, naming every one', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeFile(scriptsDir, 'lib/helper.mjs');
  writeFile(scriptsDir, 'review/fixtures/x.test.mjs');

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /lib\/helper\.mjs/);
  assert.match(result.stderr, /review\/fixtures\/x\.test\.mjs/);
});

test('ignores an .mjs inside node_modules', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeFile(scriptsDir, 'node_modules/some-pkg/index.mjs');

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 0, result.stderr);
});

test('exits 2 when the scripts directory does not exist', (t) => {
  const scriptsDir = createScriptsDir(t);

  const result = runChecker(join(scriptsDir, 'missing'));

  assert.equal(result.status, 2);
  assert.match(result.stderr, /is not a directory/);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKER = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-ts-suppressions.mjs',
);

function createScriptsDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-suppressions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeTsFile(scriptsDir, relPath, content) {
  const path = join(scriptsDir, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function runChecker(scriptsDir) {
  return spawnSync(process.execPath, [CHECKER, scriptsDir], {
    encoding: 'utf8',
  });
}

test('passes a clean .ts file with no suppression comments', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(scriptsDir, 'check-clean.ts', 'export const n: number = 1;\n');

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 \.ts file\(s\) scanned/);
});

test('passes when there are no .ts files at all', (t) => {
  const scriptsDir = createScriptsDir(t);

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 \.ts file\(s\) scanned/);
});

test('rejects @ts-nocheck', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(
    scriptsDir,
    'check-bad.ts',
    '// @ts-nocheck\nexport const n: number = 1;\n',
  );

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /check-bad\.ts:1/);
  assert.match(result.stderr, /@ts-nocheck/);
});

test('rejects @ts-ignore', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(
    scriptsDir,
    'check-bad.ts',
    'export const n: number = 1;\n// @ts-ignore\nconst bad: number = "oops";\n',
  );

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /check-bad\.ts:2/);
  assert.match(result.stderr, /@ts-ignore/);
});

test('rejects a reasonless @ts-expect-error', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(
    scriptsDir,
    'check-bad.ts',
    'export const n: number = 1;\n// @ts-expect-error\nconst bad: number = "oops";\n',
  );

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /check-bad\.ts:2/);
  assert.match(result.stderr, /no written reason/);
});

test('accepts an @ts-expect-error with a written reason', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(
    scriptsDir,
    'check-good.ts',
    'export const n: number = 1;\n' +
      '// @ts-expect-error upstream type is wrong until the next release\n' +
      'const bad: number = "oops";\n',
  );

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 0, result.stderr);
});

test('names every violation across nested directories, not just the first', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(
    scriptsDir,
    'check-top.ts',
    '// @ts-nocheck\nexport const n: number = 1;\n',
  );
  writeTsFile(
    scriptsDir,
    join('lib', 'check-nested.ts'),
    '// @ts-ignore\nexport const n: number = 1;\n',
  );

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /check-top\.ts:1/);
  assert.match(result.stderr, /lib[\\/]check-nested\.ts:1/);
});

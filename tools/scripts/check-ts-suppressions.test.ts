import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKER = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-ts-suppressions.ts',
);

function createScriptsDir(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-suppressions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeTsFile(scriptsDir: string, relPath: string, content: string) {
  const path = join(scriptsDir, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function runChecker(scriptsDir: string) {
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

// The checker and this suite are the two files that have to spell the
// directives out, so neither is scanned — the header says so, and this is
// what makes that claim true rather than a hope.
test('excludes itself and its own suite, which name what they forbid', (t) => {
  const scriptsDir = createScriptsDir(t);
  for (const name of [
    'check-ts-suppressions.ts',
    'check-ts-suppressions.test.ts',
  ])
    writeTsFile(scriptsDir, name, '// @ts-nocheck\nexport const n = 1;\n');

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 \.ts file\(s\) scanned/);
});

// copilot-hooks/__tests__ is still Jest (ADR 0135), typechecked today by
// tools/tsconfig.spec.json's jest types, not yet this rule's convention.
test('excludes copilot-hooks/__tests__, the still-Jest specs', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(
    scriptsDir,
    join('copilot-hooks', '__tests__', 'a.spec.ts'),
    '// @ts-nocheck\ndescribe("x", () => {});\n',
  );

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 \.ts file\(s\) scanned/);
});

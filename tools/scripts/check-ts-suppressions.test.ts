// Contract Suite for check-ts-suppressions.ts.
//
// The three directive names are assembled from parts below, and written
// without their leading `@` in prose, so this suite does not match the check
// it drives and needs no exemption from its scan. The checker's header
// explains the same move; `check-product-name.test.ts` spells the name it
// forbids the same way.
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

const AT = ['@', 'ts-'].join('');
const NOCHECK = `${AT}nocheck`;
const IGNORE = `${AT}ignore`;
const EXPECT_ERROR = `${AT}expect-error`;

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

test(`rejects ${NOCHECK}`, (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(
    scriptsDir,
    'check-bad.ts',
    `// ${NOCHECK}\nexport const n: number = 1;\n`,
  );

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /check-bad\.ts:1/);
  assert.match(result.stderr, new RegExp(NOCHECK));
});

test(`rejects ${IGNORE}`, (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(
    scriptsDir,
    'check-bad.ts',
    `export const n: number = 1;\n// ${IGNORE}\nconst bad: number = "oops";\n`,
  );

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /check-bad\.ts:2/);
  assert.match(result.stderr, new RegExp(IGNORE));
});

test(`rejects a reasonless ${EXPECT_ERROR}`, (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(
    scriptsDir,
    'check-bad.ts',
    `export const n: number = 1;\n// ${EXPECT_ERROR}\nconst bad: number = "oops";\n`,
  );

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /check-bad\.ts:2/);
  assert.match(result.stderr, /no written reason/);
});

test(`accepts an ${EXPECT_ERROR} with a written reason`, (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(
    scriptsDir,
    'check-good.ts',
    'export const n: number = 1;\n' +
      `// ${EXPECT_ERROR} upstream type is wrong until the next release\n` +
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
    `// ${NOCHECK}\nexport const n: number = 1;\n`,
  );
  writeTsFile(
    scriptsDir,
    join('lib', 'check-nested.ts'),
    `// ${IGNORE}\nexport const n: number = 1;\n`,
  );

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /check-top\.ts:1/);
  assert.match(result.stderr, /lib[\\/]check-nested\.ts:1/);
});

// copilot-hooks/__tests__ was excluded while its specs were still Jest; since
// ADR 0135 moved them to `node --test`, copilot-hooks is in scope like any
// other directory.
test('scans copilot-hooks suites like every other directory', (t) => {
  const scriptsDir = createScriptsDir(t);
  writeTsFile(
    scriptsDir,
    join('copilot-hooks', 'a.test.ts'),
    `// ${NOCHECK}\nexport const n: number = 1;\n`,
  );

  const result = runChecker(scriptsDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /copilot-hooks[\\/]a\.test\.ts:1/);
});

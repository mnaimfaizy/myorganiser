// Contracts for grade-scenarios.ts's command-line surface (ADR 0147 decision 3).
// The grading rule itself is covered in ./lib/grade-scenarios.test.ts; these
// tests run the real script as a subprocess and pin its exit codes and its
// JSON stdout: 0 = graded and not "QA failed", 1 = graded and "QA failed",
// 2 = could not grade (bad invocation or input).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'grade-scenarios.ts');
const USAGE = 'usage: node tools/qa/grade-scenarios.ts --input <file.json | ->';

const FIX_PASS = {
  changeKind: 'fix',
  scenarios: [{ id: 'S1', before: 'fail', after: 'pass' }],
};

function runCli(args: string[], stdin?: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    input: stdin,
  });
}

function runWithStdin(input: unknown) {
  return runCli(['--input', '-'], JSON.stringify(input));
}

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'grade-scenarios-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('exit 0 with a "QA passed" report on stdin', () => {
  const result = runWithStdin(FIX_PASS);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    headline: 'QA passed',
    scenarios: [{ id: 'S1', result: 'PASS', maintainerDecision: false }],
  });
});

test('exit 0 for "QA passed, ... listed" when a fix is Not proven', () => {
  const result = runWithStdin({
    changeKind: 'fix',
    scenarios: [{ id: 'S1', before: 'pass', after: 'pass' }],
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(
    report.headline,
    'QA passed, not proven or pre-existing items listed',
  );
  assert.equal(report.scenarios[0].result, 'Not proven');
});

test('exit 0 for a pre-existing failure, and the maintainer decision is set', () => {
  const result = runWithStdin({
    changeKind: 'fix',
    scenarios: [{ id: 'S1', before: 'fail', after: 'fail' }],
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(
    report.headline,
    'QA passed, not proven or pre-existing items listed',
  );
  assert.deepEqual(report.scenarios, [
    { id: 'S1', result: 'FAIL: pre-existing', maintainerDecision: true },
  ]);
});

test('exit 1 with a "QA failed" report when a fix regresses', () => {
  const result = runWithStdin({
    changeKind: 'fix',
    scenarios: [{ id: 'S1', before: 'pass', after: 'fail' }],
  });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.headline, 'QA failed');
  assert.equal(report.scenarios[0].result, 'FAIL: regression');
});

test('exit 1 for a feature that fails After with Before cannot-run, with no rerun flag in the report', () => {
  const result = runWithStdin({
    changeKind: 'feature',
    scenarios: [{ id: 'S1', before: 'cannot-run', after: 'fail' }],
  });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    headline: 'QA failed',
    scenarios: [
      { id: 'S1', result: 'FAIL: regression', maintainerDecision: false },
    ],
  });
});

test('exit 2 and names the scenario when a feature fails After with Before not-run', () => {
  const result = runWithStdin({
    changeKind: 'feature',
    scenarios: [{ id: 'S3-export', before: 'not-run', after: 'fail' }],
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /qa:grade: scenario "S3-export" failed After and Before was not run: re-run on the merge-base first/,
  );
});

test('exit 2 and names the scenario when a fix fails After with Before not-run', () => {
  const result = runWithStdin({
    changeKind: 'fix',
    scenarios: [{ id: 'S4-save', before: 'not-run', after: 'fail' }],
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /qa:grade: scenario "S4-save" failed After and Before was not run/,
  );
});

test('--input <file> grades a file the same way as stdin', (t) => {
  const path = join(tempDir(t), 'plan.json');
  writeFileSync(path, JSON.stringify(FIX_PASS));
  const result = runCli(['--input', path]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).headline, 'QA passed');
});

test('exit 2 with usage when --input is missing', () => {
  const result = runCli([]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /qa:grade: usage:/);
});

test('exit 2 with usage when --input has no value', () => {
  const result = runCli(['--input']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /qa:grade: usage:/);
});

test('exit 2 with usage for an unknown extra argument', () => {
  const result = runCli(
    ['--input', '-', '--verbose'],
    JSON.stringify(FIX_PASS),
  );
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /qa:grade: usage:/);
});

test('exit 2 when the input file cannot be read', (t) => {
  const path = join(tempDir(t), 'missing.json');
  const result = runCli(['--input', path]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /qa:grade: cannot read input/);
});

test('exit 2 when stdin is not valid JSON', () => {
  const result = runCli(['--input', '-'], '{not json');
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /qa:grade: input is not valid JSON/);
});

test('exit 2 when the input fails validation', () => {
  const result = runWithStdin({ changeKind: 'bugfix', scenarios: [] });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /qa:grade: changeKind must be one of: fix, feature/,
  );
});

test('exit 2 for an empty scenario list rather than a green headline', () => {
  const result = runWithStdin({ changeKind: 'fix', scenarios: [] });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /qa:grade: no scenarios to grade/);
});

test('--help exits 0 and prints the usage line on stdout', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), USAGE);
});

test('-h behaves like --help', () => {
  const result = runCli(['-h']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), USAGE);
});

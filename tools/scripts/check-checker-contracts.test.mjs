// Contracts for check-checker-contracts.mjs's command-line surface, following
// check-nx-declared-targets.test.mjs's shape: the checker runs as a real
// subprocess against a fixture workspace, because it reads
// tools/scripts/check-*.mjs from disk the same way tools/scripts/lib/gate-coverage.ts
// does. Unlike the Declared Target ratchet this checker never shells out to
// git, so the fixture is a plain temp directory rather than a git repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const CHECKER = join(HERE, 'check-checker-contracts.mjs');

function createWorkspace(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'checker-contracts-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  return workspace;
}

function write(workspace, relative, contents) {
  const path = join(workspace, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2),
  );
}

function writeBaseline(workspace, baseline, overrides = {}) {
  write(workspace, 'tools/config/checker-contract-baseline.json', {
    schemaVersion: 1,
    comment: 'fixture baseline',
    baseline,
    ...overrides,
  });
}

const run = (workspace, ...args) =>
  spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: workspace,
    encoding: 'utf8',
  });

test('exits 0 against the real repository with the committed baseline', () => {
  const result = spawnSync(process.execPath, [CHECKER], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /checker-contracts: OK — /);
});

test('passes when every checker without a suite is in the baseline', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  write(workspace, 'tools/scripts/check-a.test.mjs', '// noop\n');
  write(workspace, 'tools/scripts/check-b.mjs', '// noop\n');
  writeBaseline(workspace, ['tools/scripts/check-b.mjs']);
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /OK — 1\/2 checker\(s\) carry a contract suite, 1 tracked as debt in the 1-entry baseline/,
  );
});

test('fails a checker with no suite and no baseline entry, naming the checker', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  writeBaseline(workspace, []);
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /tools\/scripts\/check-a\.mjs: no contract suite \(expected tools\/scripts\/check-a\.test\.mjs\) and no entry in/,
  );
});

// Regression: hasContractSuite's `.replace(/\.mjs$/, '.test.mjs')` matched
// nothing on a `.ts` path and returned it unchanged, so this checked whether
// check-a.ts existed (always true) instead of check-a.test.ts, silently
// reporting debt as covered. ADR 0135's expand step makes check-*.ts a real
// checker shape, so this suite covers it the same way the .mjs cases above do.
test('fails a check-*.ts checker with no suite and no baseline entry, naming the checker', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.ts', '// noop\n');
  writeBaseline(workspace, []);
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /tools\/scripts\/check-a\.ts: no contract suite \(expected tools\/scripts\/check-a\.test\.ts\) and no entry in/,
  );
});

test('passes a check-*.ts checker that carries its .test.ts sibling', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.ts', '// noop\n');
  write(workspace, 'tools/scripts/check-a.test.ts', '// noop\n');
  writeBaseline(workspace, []);
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK — 1\/1 checker\(s\) carry a contract suite/);
});

test('fails a baseline entry whose checker now has a suite, as stale', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  write(workspace, 'tools/scripts/check-a.test.mjs', '// noop\n');
  writeBaseline(workspace, ['tools/scripts/check-a.mjs']);
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /baseline entry tools\/scripts\/check-a\.mjs has no matching checker without a contract suite/,
  );
});

test('fails a baseline entry whose checker no longer exists, as stale', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  writeBaseline(workspace, [
    'tools/scripts/check-a.mjs',
    'tools/scripts/check-gone.mjs',
  ]);
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /baseline entry tools\/scripts\/check-gone\.mjs has no matching checker without a contract suite/,
  );
  assert.doesNotMatch(result.stderr, /check-a\.mjs: no contract suite/);
});

test('reports both a new-debt finding and a stale finding in one run', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  write(workspace, 'tools/scripts/check-a.test.mjs', '// noop\n');
  write(workspace, 'tools/scripts/check-b.mjs', '// noop\n');
  writeBaseline(workspace, ['tools/scripts/check-a.mjs']);
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /check-b\.mjs: no contract suite/);
  assert.match(
    result.stderr,
    /baseline entry tools\/scripts\/check-a\.mjs has no matching checker/,
  );
});

test('does not require a checker file that is itself a test file', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  write(workspace, 'tools/scripts/check-a.test.mjs', '// noop\n');
  writeBaseline(workspace, []);
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('exits 2 when the baseline is missing entirely', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not found/);
});

test('exits 2 when the baseline is not valid JSON', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/config/checker-contract-baseline.json', '{ not json');
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not valid JSON/);
});

test('exits 2 when the baseline has the wrong schema version', (t) => {
  const workspace = createWorkspace(t);
  writeBaseline(workspace, [], { schemaVersion: 2 });
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /expected "schemaVersion": 1/);
});

test('exits 2 when "baseline" is not an array', (t) => {
  const workspace = createWorkspace(t);
  writeBaseline(workspace, []);
  write(workspace, 'tools/config/checker-contract-baseline.json', {
    schemaVersion: 1,
    comment: 'fixture',
    baseline: { not: 'an array' },
  });
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /expected a "baseline" array/);
});

test('exits 2 when a baseline entry is duplicated', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  writeBaseline(workspace, [
    'tools/scripts/check-a.mjs',
    'tools/scripts/check-a.mjs',
  ]);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /is duplicated in the baseline/);
});

test('exits 2 when a baseline entry is not a tools\\/scripts\\/check-*.{mjs,ts} path', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  writeBaseline(workspace, ['tools/scripts/check-a.test.mjs']);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /"tools\/scripts\/check-a\.test\.mjs" is not a tools\/scripts\/check-\*\.\{mjs,ts\} path/,
  );
});

test('exits 2 when no checkers are found', (t) => {
  const workspace = createWorkspace(t);
  mkdirSync(join(workspace, 'tools', 'scripts'), { recursive: true });
  writeBaseline(workspace, []);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no check-\*\.\{mjs,ts\} checkers found/);
});

test('--print lists every baseline entry and every classified checker', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'tools/scripts/check-a.mjs', '// noop\n');
  write(workspace, 'tools/scripts/check-a.test.mjs', '// noop\n');
  write(workspace, 'tools/scripts/check-b.mjs', '// noop\n');
  writeBaseline(workspace, ['tools/scripts/check-b.mjs']);
  const result = run(workspace, '--print');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 baseline entry/);
  assert.match(result.stdout, /baseline: tools\/scripts\/check-b\.mjs/);
  assert.match(
    result.stdout,
    /2 checker\(s\) classified, 1 without a contract suite/,
  );
  assert.match(result.stdout, /covered: tools\/scripts\/check-a\.mjs/);
  assert.match(result.stdout, /debt: tools\/scripts\/check-b\.mjs/);
});

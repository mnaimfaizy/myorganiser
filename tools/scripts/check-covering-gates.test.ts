// Contract Suite for check-covering-gates.ts: the exit code a pipeline reads
// and the message a developer reads. The defect worth catching is a path-gated
// Covering Gate whose triggers stop covering an obligation's trigger path —
// that must exit 1 and name the gate, the obligation and the uncovered glob, so
// a reviewer cannot suppress a finding on a gate the path gate skipped (ADR
// 0074). A catalogue or config the checker cannot read must exit 2, not pass.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-covering-gates.ts');
const REPO_ROOT = resolve(HERE, '..', '..');
const OBLIGATION_ID = 'run-the-gate-that-covers-this-change';
const UNCOVERED_GLOB = 'apps/backend/src/swagger/**';

const obligations = (glob = UNCOVERED_GLOB) =>
  JSON.stringify({
    schemaVersion: 1,
    obligations: [
      {
        id: OBLIGATION_ID,
        trigger: {
          paths: [{ glob, coveringGate: 'openapi:check' }],
        },
      },
    ],
  });

const gateTriggers = (triggers: string[]) =>
  JSON.stringify({
    schemaVersion: 1,
    sharedInputs: ['package.json'],
    suites: [
      {
        id: 'openapi:check',
        ciStep: 'Check OpenAPI spec and generated client are in sync',
        why: 'Generated API surface.',
        triggers,
      },
    ],
  });

const PASSING_TRIGGERS = gateTriggers(['apps/backend/src/**']);
const NARROW_TRIGGERS = gateTriggers(['apps/backend/src/prisma/**']);

/**
 * A miniature repository holding only the two config files the checker reads.
 * `null` leaves a file absent, so a fixture can exercise the missing case.
 */
function createFixture(
  t: TestContext,
  files: { obligations: string | null; gateTriggers: string | null },
): string {
  const workspace = mkdtempSync(join(tmpdir(), 'covering-gates-cli-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(join(workspace, 'tools/config'), { recursive: true });
  if (files.obligations !== null) {
    writeFileSync(
      join(workspace, 'tools/config/review-obligations.json'),
      files.obligations,
    );
  }
  if (files.gateTriggers !== null) {
    writeFileSync(
      join(workspace, 'tools/config/gate-triggers.json'),
      files.gateTriggers,
    );
  }
  return workspace;
}

const runChecker = (cwd: string, args: string[] = []) =>
  spawnSync(process.execPath, [CHECKER, ...args], { cwd, encoding: 'utf8' });

test('exits 0 when the path-gated gate covers the obligation trigger', (t) => {
  const workspace = createFixture(t, {
    obligations: obligations(),
    gateTriggers: PASSING_TRIGGERS,
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /1 obligation trigger\(s\) covered/);
});

test('exits 1 naming the gate, the obligation and the uncovered glob when triggers are narrower', (t) => {
  const workspace = createFixture(t, {
    obligations: obligations(),
    gateTriggers: NARROW_TRIGGERS,
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /openapi:check/);
  assert.match(result.stderr, new RegExp(OBLIGATION_ID));
  assert.match(result.stderr, /apps\/backend\/src\/swagger\/\*\*/);
});

test('--print lists each gate and glob pair on a passing fixture and exits 0', (t) => {
  const workspace = createFixture(t, {
    obligations: obligations(),
    gateTriggers: PASSING_TRIGGERS,
  });

  const result = runChecker(workspace, ['--print']);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(
    result.stdout,
    new RegExp(
      `openapi:check must cover apps/backend/src/swagger/\\*\\* \\(${OBLIGATION_ID}\\)`,
    ),
  );
});

test('exits 2 when review-obligations.json is missing', (t) => {
  const workspace = createFixture(t, {
    obligations: null,
    gateTriggers: PASSING_TRIGGERS,
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /review-obligations\.json/);
});

test('exits 2 when review-obligations.json is not valid JSON', (t) => {
  const workspace = createFixture(t, {
    obligations: '{ not json',
    gateTriggers: PASSING_TRIGGERS,
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /review-obligations\.json/);
});

test('exits 2 when review-obligations.json has no obligations array', (t) => {
  const workspace = createFixture(t, {
    obligations: JSON.stringify({ schemaVersion: 1 }),
    gateTriggers: PASSING_TRIGGERS,
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /expected an "obligations" array/);
});

test('exits 2 when gate-triggers.json is missing', (t) => {
  const workspace = createFixture(t, {
    obligations: obligations(),
    gateTriggers: null,
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /gate-triggers\.json not found/);
});

test('the real tree passes: every path-gated Covering Gate covers its obligation', () => {
  const result = runChecker(REPO_ROOT);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /obligation trigger\(s\) covered/);
});

// Contracts for the checker's command-line surface: the exit code a pipeline
// reads, and the message a developer reads. The decision itself is covered by
// tools/scripts/lib/gate-coverage.test.ts against fixtures; what is asserted
// here is the mapping onto exit 0 / 1 / 2, and that a failure names each
// unwired checker rather than reporting a count.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const CHECKER = join(HERE, 'check-gate-coverage.ts');

const run = (cwd: string) =>
  spawnSync(process.execPath, [CHECKER], { cwd, encoding: 'utf8' });

/**
 * A miniature repository: two checkers, one wired through the pre-commit hook
 * and one wired nowhere. The checker resolves everything from the working
 * directory, so a fixture needs no stubbing.
 */
function createWorkspace(t: TestContext, optOutConfig: unknown): string {
  const workspace = mkdtempSync(join(tmpdir(), 'gate-coverage-cli-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  mkdirSync(join(workspace, 'tools/scripts'), { recursive: true });
  mkdirSync(join(workspace, 'tools/config'), { recursive: true });
  mkdirSync(join(workspace, '.husky'), { recursive: true });

  writeFileSync(join(workspace, 'tools/scripts/check-wired.mjs'), '');
  writeFileSync(join(workspace, 'tools/scripts/check-orphan.mjs'), '');
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({
      scripts: {
        'wired:check': 'node tools/scripts/check-wired.mjs',
        'orphan:check': 'node tools/scripts/check-orphan.mjs',
      },
    }),
  );
  writeFileSync(
    join(workspace, '.husky/pre-commit'),
    'corepack yarn wired:check\n',
  );
  writeFileSync(
    join(workspace, 'tools/config/gate-coverage-optout.json'),
    JSON.stringify(optOutConfig),
  );

  return workspace;
}

test('exits 0 and reports the counts against the real repository', () => {
  const result = run(REPO_ROOT);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /gate-coverage: \d+ checkers wired/);
  assert.match(result.stdout, /non-gates declared with a reason/);
  assert.match(result.stdout, /gate-coverage: \d+ suites wired/);
  assert.match(result.stdout, /\d+ suites opted out/);
});

/**
 * A fixture with one wired checker and one unwired Contract Suite, so the
 * suite rule's failure (ADR 0135) can be asserted without the checker rule
 * (ADR 0043) also firing.
 */
function createWorkspaceWithSuite(
  t: TestContext,
  optOutConfig: unknown,
): string {
  const workspace = mkdtempSync(join(tmpdir(), 'gate-coverage-cli-suite-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  mkdirSync(join(workspace, 'tools/scripts'), { recursive: true });
  mkdirSync(join(workspace, 'tools/config'), { recursive: true });
  mkdirSync(join(workspace, '.husky'), { recursive: true });

  writeFileSync(join(workspace, 'tools/scripts/check-wired.mjs'), '');
  writeFileSync(join(workspace, 'tools/scripts/check-wired.test.mjs'), '');
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({
      scripts: {
        'wired:check': 'node tools/scripts/check-wired.mjs',
      },
    }),
  );
  writeFileSync(
    join(workspace, '.husky/pre-commit'),
    'corepack yarn wired:check\n',
  );
  writeFileSync(
    join(workspace, 'tools/config/gate-coverage-optout.json'),
    JSON.stringify(optOutConfig),
  );

  return workspace;
}

test('exits 1 naming each unwired suite, not a count', (t) => {
  const workspace = createWorkspaceWithSuite(t, {
    schemaVersion: 1,
    optOut: [],
  });

  const result = run(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ADR 0135/);
  assert.match(result.stderr, /tools\/scripts\/check-wired\.test\.mjs/);
  assert.match(
    result.stderr,
    /runnable as: node --test tools\/scripts\/check-wired\.test\.mjs/,
  );
});

test('exits 0 when the unwired suite carries an opt-out with a reason', (t) => {
  const workspace = createWorkspaceWithSuite(t, {
    schemaVersion: 1,
    optOut: [
      {
        check: 'check-wired.test.mjs',
        reason: 'Benchmark contract run by hand only, never in a pipeline.',
      },
    ],
  });

  const result = run(workspace);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /1 suites opted out/);
});

test('exits 1 naming each unwired checker, not a count', (t) => {
  const workspace = createWorkspace(t, { schemaVersion: 1, optOut: [] });

  const result = run(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /tools\/scripts\/check-orphan\.mjs/);
  assert.match(result.stderr, /runnable as: yarn orphan:check/);
  assert.ok(
    !result.stderr.includes('check-wired.mjs'),
    'a wired checker must not appear in the failure',
  );
});

test('exits 0 when the unwired checker carries an opt-out with a reason', (t) => {
  const workspace = createWorkspace(t, {
    schemaVersion: 1,
    optOut: [
      {
        check: 'check-orphan.mjs',
        reason:
          'Not a gate — it prints a benchmark and has no fact to fail on.',
      },
    ],
  });

  const result = run(workspace);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /1 checkers opted out/);
});

test('exits 2 when an opt-out entry carries no written reason', (t) => {
  const workspace = createWorkspace(t, {
    schemaVersion: 1,
    optOut: [{ check: 'check-orphan.mjs' }],
  });

  const result = run(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /the check could not run/);
  assert.match(result.stderr, /carries no written reason/);
});

test('exits 2 when the opt-out list is missing entirely', (t) => {
  const workspace = createWorkspace(t, {
    schemaVersion: 1,
    optOut: [],
  });
  rmSync(join(workspace, 'tools/config/gate-coverage-optout.json'));

  const result = run(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /gate-coverage-optout\.json not found/);
});

// Contract Suite for the `Prisma Migration Gate` job in .github/workflows/ci.yml
// (ADR 0094, ADR 0140, issue #1394): Tier 2 of the Prisma migration gate, split
// out of `Test` so a pull request that cannot have touched a migration never
// starts the Postgres service. The defect worth catching is the drift check
// drifting back into `Test` or losing its job-level `if:`, so the Postgres
// container starts on every pull request again; a `Test` job that keeps a
// service container it no longer needs; or the drift step running before the
// Prisma client it needs is generated, the backfill step moving before the
// drift step or losing its one-file selector, or re-inlining the npx commands
// in place of the package.json script the config's suite id must name. The `if:` sits at
// job level, so it is read here with its own helper: the shared slicer's
// `ifOf` reads a step's eight-space `if:` and would miss it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  expectedGateIfTerms,
  readGateTriggers,
  type GateTriggerSuite,
} from '../lib/gate-triggers.ts';
// Exact step-name matching is the point: a renamed step fails here rather than
// matching the step beside it.
import { jobBlock, orTerms, runOf, stepNamed } from '../lib/workflow-yaml.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const CI = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
const config = readGateTriggers({ cwd: REPO_ROOT });

const TEST = jobBlock(CI, 'test');
const GATE_JOB = 'prisma-migration-gate';
const GATE = jobBlock(CI, GATE_JOB);
const GENERATE = 'Generate Prisma client';

/** The live config's drift suite. Throws when it is missing, so a rename fails loudly. */
const driftSuite = (): GateTriggerSuite => {
  const suite = config.suites.find(
    (entry) => entry.id === 'prisma:migration:drift',
  );
  assert.ok(suite, 'prisma:migration:drift must be a suite in the config');
  return suite;
};

/** A job's own `if:`, unwrapped; a job's `if:` sits at four spaces. */
const jobIf = (job: string): string | undefined =>
  job.match(/^ {4}if: (.+)$/m)?.[1]?.trim();

/** The offset of a step header inside the job, matched as a whole line. */
const stepAt = (job: string, name: string): number => {
  stepNamed(job, name);
  const at = job.indexOf(`      - name: ${name}\n`);
  assert.notEqual(at, -1, `no step header line for "${name}"`);
  return at;
};

test('the test job carries no service containers', () => {
  assert.doesNotMatch(TEST, /^ {4}services:$/m);
});

test('the gate job is named Prisma Migration Gate, needs setup and runs Postgres 16', () => {
  assert.match(GATE, /^ {4}name: Prisma Migration Gate$/m);
  assert.match(GATE, /^ {4}needs: setup$/m);
  assert.match(GATE, /^ {4}services:$/m);
  assert.match(GATE, /^ {6}postgres:$/m);
  assert.match(GATE, /^ {8}image: postgres:16$/m);
});

test('the drift step lives in the gate job and not in Test', () => {
  const drift = driftSuite();
  assert.equal(drift.job, GATE_JOB, 'the drift suite must name the gate job');
  assert.throws(
    () => stepNamed(TEST, drift.ciStep),
    /no step named exactly/,
    'the drift step must not be a step in Test, where it would need a service it no longer has',
  );
  stepNamed(GATE, drift.ciStep);
});

test('the gate job runs under the run-all fallback or its own flag', () => {
  assert.deepEqual(orTerms(jobIf(GATE)), expectedGateIfTerms(driftSuite()));
});

test('Generate Prisma client runs before the drift check', () => {
  const drift = driftSuite();
  assert.ok(
    stepAt(GATE, GENERATE) < stepAt(GATE, drift.ciStep),
    'the drift check needs the generated Prisma client, so generation must run first',
  );
});

test('the backfill test runs after the drift step and selects only its one file', () => {
  const drift = driftSuite();
  const backfill = 'Run Prisma migration backfill test';
  assert.ok(
    stepAt(GATE, backfill) > stepAt(GATE, drift.ciStep),
    'the backfill test needs the migrations the drift step applies, so it must run after it',
  );
  assert.ok(
    stepNamed(GATE, backfill).includes(
      "--testPathPatterns='backfillUserCreatedAt\\.int\\.test\\.ts$'",
    ),
    'the backfill step must select exactly backfillUserCreatedAt.int.test.ts',
  );
});

test('the drift step runs the package.json gate script, not inline npx', () => {
  assert.equal(
    runOf(stepNamed(GATE, driftSuite().ciStep)),
    'corepack yarn prisma:migration:drift',
  );
});

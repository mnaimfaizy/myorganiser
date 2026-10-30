// Contract Suite for the wiring around the dependency-manifest detector in the
// `secure-install-review` job of .github/workflows/ci.yml (issue #1390, ADR
// 0124). The detector's own logic is tested in dependency-manifest-changed.test.ts;
// this suite only pins the workflow around it. The defect worth catching is a
// reorder or an `if:` edit that runs the script-free install, the frozen-lockfile
// check or the npm audit under the wrong condition: silently reinstating the slow
// path on every pull request, or skipping the install, lockfile check or audit on
// a push to main or when the detector errored. An error in the detector must
// always get the full review (ADR 0124).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Exact step-name matching is the point: a renamed step fails here rather than
// matching the step beside it.
import { jobBlock, stepNamed } from '../lib/workflow-yaml.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const CI = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
const JOB = jobBlock(CI, 'secure-install-review');

const DETECT = 'Check whether dependency manifests changed';
const INSTALL = 'Install dependency metadata without scripts';
const LOCKFILE = 'Verify frozen lockfile';
const AUDIT = 'Run Yarn npm audit';
const EXPLAIN = 'Explain skipped install review';

const GATE_TERMS = [
  "github.event_name != 'pull_request'",
  "steps.dependency-files.outputs.run_audit == 'true'",
].sort();

/** The `if:` expression of a step, unwrapped; a step's `if:` sits at eight spaces. */
const ifOf = (step: string): string | undefined =>
  step.match(/^ {8}if: (.+)$/m)?.[1]?.trim();

/** The OR-terms of a step's `if:`, sorted so term order does not matter. */
const orTerms = (condition: string | undefined): string[] => {
  assert.ok(condition, 'step has no if:');
  return condition
    .split('||')
    .map((term) => term.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .sort();
};

/** The offset of a step header inside the job, matched as a whole line. */
const stepAt = (name: string): number => {
  stepNamed(JOB, name);
  const at = JOB.indexOf(`      - name: ${name}\n`);
  assert.notEqual(at, -1, `no step header line for "${name}"`);
  return at;
};

test('the manifest detector runs before the install', () => {
  assert.ok(
    stepAt(DETECT) < stepAt(INSTALL),
    'the detector must run before the install so a no-dependency pull request can skip it',
  );
});

test('the install step runs on a push or when dependency files changed', () => {
  assert.deepEqual(orTerms(ifOf(stepNamed(JOB, INSTALL))), GATE_TERMS);
});

const runLineOf = (step: string): string | undefined =>
  step.match(/^ {8}run: (.+)$/m)?.[1]?.trim();

test('the install runs without scripts and the audit runs the full high-severity check', () => {
  assert.equal(
    runLineOf(stepNamed(JOB, INSTALL)),
    'corepack yarn install --immutable --mode=skip-build',
  );
  assert.equal(
    runLineOf(stepNamed(JOB, AUDIT)),
    'corepack yarn npm audit --all --recursive --severity high',
  );
});

test('the frozen-lockfile step shares the install gate exactly', () => {
  assert.deepEqual(orTerms(ifOf(stepNamed(JOB, LOCKFILE))), GATE_TERMS);
});

test('the npm audit step shares the install gate exactly', () => {
  assert.deepEqual(orTerms(ifOf(stepNamed(JOB, AUDIT))), GATE_TERMS);
});

test('the skipped-review explanation runs only on a pull request that changed no dependencies', () => {
  assert.equal(
    ifOf(stepNamed(JOB, EXPLAIN)),
    "github.event_name == 'pull_request' && steps.dependency-files.outputs.run_audit != 'true'",
  );
});

test('the skipped-review explanation names the install, the lockfile check and the audit', () => {
  // Only the run block: the step name already contains "install".
  const step = stepNamed(JOB, EXPLAIN);
  const run = step.slice(step.indexOf('        run: |'));
  assert.match(run, /install/i);
  assert.match(run, /lockfile/i);
  assert.match(run, /audit/i);
});

test('the detector step itself runs only on pull requests', () => {
  assert.equal(
    ifOf(stepNamed(JOB, DETECT)),
    "github.event_name == 'pull_request'",
  );
});

test('the detector fails open: its error branch writes run_audit=true and never false', () => {
  const step = stepNamed(JOB, DETECT);
  const run = step.slice(step.indexOf('        run: |'));
  const errorBranch = run.slice(
    run.indexOf('if ! result='),
    run.indexOf('if [ "$result"'),
  );
  assert.match(errorBranch, /run_audit=true/);
  assert.doesNotMatch(errorBranch, /run_audit=false/);
});

test('exactly one step in the job is an explanation of a skipped review', () => {
  const explanations = JOB.match(/^ {6}- name: Explain skipped/gm) ?? [];
  assert.equal(explanations.length, 1);
});

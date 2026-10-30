// Contract Suite for the job layout in .github/workflows/ci.yml after issue
// #1396 merged `Prepare Dependency Cache` into `Setup Affected Context`. The
// defect worth catching is a future edit that re-splits Setup back into two
// jobs, re-adds `lint` or `test` to the `needs:` of `e2e`, `e2e-live-logout`
// or `build-backend`, or lets `build-frontend` run again on a pull request,
// without anyone noticing. The `build-frontend` `if:` sits at job level, so it
// is read with a local helper: the shared slicer's `ifOf` reads a step's
// eight-space `if:` and would miss it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Exact step-name matching is the point: a renamed step fails here rather than
// matching the step beside it.
import {
  escapeRegExp,
  ifOf,
  jobBlock,
  stepNamed,
} from '../lib/workflow-yaml.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const CI = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

const SETUP = jobBlock(CI, 'setup');
const E2E = jobBlock(CI, 'e2e');
const E2E_LIVE_LOGOUT = jobBlock(CI, 'e2e-live-logout');
const BUILD_BACKEND = jobBlock(CI, 'build-backend');
const BUILD_FRONTEND = jobBlock(CI, 'build-frontend');
const BUILD_STORYBOOK = jobBlock(CI, 'build-storybook');

/**
 * The job ids a job's `needs:` names, sorted. Reads both the scalar form
 * (`needs: setup`) and the block-list form (`needs:` then `- setup` lines),
 * and throws when the job has no `needs:` key at all.
 */
const needsOf = (job: string): string[] => {
  const scalar = /^ {4}needs: (\S.*)$/m.exec(job);
  if (scalar) return [scalar[1].trim()];
  const block = /^ {4}needs:[ \t]*$\n((?: {6}- \S.*\n?)*)/m.exec(job);
  assert.ok(block, 'job has no needs: key');
  return [...block[1].matchAll(/^ {6}- (\S+)[ \t]*$/gm)]
    .map((match) => match[1])
    .sort();
};

/** A job's own `if:`, unwrapped. A job's `if:` sits at four spaces. */
const jobIf = (job: string): string => {
  const match = /^ {4}if: (.+)$/m.exec(job);
  assert.ok(match, 'job has no job-level if:');
  return match[1].trim();
};

/** The `outputs:` block of the setup job, from its key to its `steps:` key. */
const outputsOf = (job: string): string => {
  const start = job.search(/^ {4}outputs:[ \t]*$/m);
  assert.notEqual(start, -1, 'job has no outputs: key');
  const rest = job.slice(start);
  const end = rest.search(/^ {4}steps:[ \t]*$/m);
  return end === -1 ? rest : rest.slice(0, end);
};

test('no job named prepare-dependencies or Prepare Dependency Cache remains', () => {
  assert.throws(
    () => jobBlock(CI, 'prepare-dependencies'),
    /no job named prepare-dependencies/,
  );
  assert.doesNotMatch(CI, /^ {4}name: Prepare Dependency Cache[ \t]*$/m);
  assert.doesNotMatch(CI, /^ {4}needs:.*\bprepare-dependencies\b/m);
  assert.doesNotMatch(CI, /^ {6}- prepare-dependencies[ \t]*$/m);
});

test('the setup job needs only secure-install-review', () => {
  assert.deepEqual(needsOf(SETUP), ['secure-install-review']);
});

test('the setup job still exposes every affected-range and gate_* output', () => {
  const outputs = outputsOf(SETUP);
  const required = [
    'nx_base',
    'nx_head',
    'affected_projects',
    'gate_run_all',
    'gate_tools_test',
    'gate_upstream_briefs_test',
    'gate_openapi_check',
    'gate_prisma_migration_drift',
    'gate_typecheck_tools_scripts',
  ];
  for (const key of required) {
    assert.match(
      outputs,
      new RegExp(
        `^ {6}${escapeRegExp(key)}: \\$\\{\\{ steps\\.[a-z-]+\\.outputs\\.[a-z_]+ \\}\\}$`,
        'm',
      ),
      `setup must still expose the ${key} output`,
    );
  }
});

test('the setup job restores its dependency cache and installs only on a miss', () => {
  assert.match(
    SETUP,
    /^ {6}- name: Restore dependency cache$/m,
    'setup must restore the dependency cache itself, since Prepare Dependency Cache is gone',
  );
  assert.equal(
    ifOf(stepNamed(SETUP, 'Install dependencies')),
    "steps.dependency-cache.outputs.cache-hit != 'true'",
  );
});

test('e2e needs only setup, not lint or test', () => {
  assert.deepEqual(needsOf(E2E), ['setup']);
});

test('e2e-live-logout needs only setup, not lint or test', () => {
  assert.deepEqual(needsOf(E2E_LIVE_LOGOUT), ['setup']);
});

test('build-backend needs only setup, not lint or test', () => {
  assert.deepEqual(needsOf(BUILD_BACKEND), ['setup']);
});

test('build-frontend skips pull_request runs, ANDed with its web affected-project term', () => {
  const condition = jobIf(BUILD_FRONTEND);
  assert.match(
    condition,
    /github\.event_name != 'pull_request'/,
    'build-frontend must exclude pull_request runs',
  );
  assert.match(
    condition,
    /contains\(fromJson\(needs\.setup\.outputs\.affected_projects\), 'web'\)/,
    'build-frontend must still require the web affected project',
  );
  assert.match(
    condition,
    /^\$\{\{ github\.event_name != 'pull_request' && contains\(fromJson\(needs\.setup\.outputs\.affected_projects\), 'web'\) \}\}$/,
    'the pull_request exclusion and the web term must be ANDed, not ORed',
  );
});

test('build-frontend keeps its lint and test wait list unchanged', () => {
  assert.deepEqual(needsOf(BUILD_FRONTEND), ['lint', 'setup', 'test']);
});

test('build-storybook needs setup instead of the removed prepare-dependencies job', () => {
  assert.deepEqual(needsOf(BUILD_STORYBOOK), ['setup']);
});

test('build-backend Install dependencies stays conditional on a dependency cache miss', () => {
  assert.equal(
    ifOf(stepNamed(BUILD_BACKEND, 'Install dependencies')),
    "steps.dependency-cache.outputs.cache-hit != 'true'",
  );
});

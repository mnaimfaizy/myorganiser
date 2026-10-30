// Contract Suite for workflow-yaml.ts, the one home for slicing a workflow into
// job and step blocks. The defect worth catching is the drift the module was
// extracted to end: a step matched by prefix, so `- name: Lint` also selects
// `- name: Lint affected projects` and a suite asserts the neighbour's `if:`
// while passing. Also pinned: a job key outside `jobs:` cannot be mistaken for
// the job, a missing job or missing `jobs:` fails naming what is absent, and
// regex metacharacters in a name match literally. For `ifOf` and `runOf` the
// defect is reading a neighbouring key at another depth as the step's own, and
// reporting a step that has no `if:` as one whose condition is empty. The
// fixture is inline, so the suite never reads a real workflow.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeRegExp,
  ifOf,
  jobBlock,
  orTerms,
  runOf,
  stepNamed,
} from './workflow-yaml.ts';

// `env:` carries a `test:` key ahead of `jobs:`, so a search not anchored under
// `jobs:` would return that block instead of the real `test` job.
const WORKFLOW = [
  'name: CI',
  'env:',
  '  test:',
  '    value: outside-jobs',
  'jobs:',
  '  setup:',
  '    steps:',
  '      - name: Lint',
  '        if: always()',
  '        run: lint-only',
  '      - name: Lint affected projects',
  '        if: github.event_name == 1',
  '        run: lint-affected',
  '  test:',
  '    steps:',
  '      - name: Run (a.b) suite',
  '        run: run-suite',
  '',
].join('\n');

const SETUP = jobBlock(WORKFLOW, 'setup');
const TEST = jobBlock(WORKFLOW, 'test');

test('escapeRegExp makes metacharacters match literally', () => {
  const pattern = new RegExp(`^${escapeRegExp('a.b*c(d)|e[f]')}$`);
  assert.equal(pattern.test('a.b*c(d)|e[f]'), true);
  assert.equal(pattern.test('axbbcdXeZf'), false);
});

test('jobBlock returns the named job body and stops at the next job key', () => {
  assert.match(SETUP, /run: lint-only/);
  assert.match(SETUP, /run: lint-affected/);
  assert.doesNotMatch(
    SETUP,
    /run-suite/,
    'the setup body must stop before the test job',
  );
});

test('jobBlock ignores a key of the same name outside jobs:', () => {
  assert.match(TEST, /run: run-suite/);
  assert.doesNotMatch(TEST, /outside-jobs/);
});

test('jobBlock throws naming the job when no such job exists', () => {
  assert.throws(() => jobBlock(WORKFLOW, 'missing'), /no job named missing/);
});

test('jobBlock throws when the source has no jobs: key', () => {
  assert.throws(
    () => jobBlock('name: CI\nenv:\n  test:\n    value: x\n', 'test'),
    /workflow has no jobs:/,
  );
});

test('stepNamed matches a name exactly and does not run into the next step', () => {
  const step = stepNamed(SETUP, 'Lint');

  assert.match(step, /- name: Lint\n/);
  assert.match(step, /if: always\(\)/, 'the step keeps its own if: line');
  assert.match(step, /run: lint-only/, 'the step keeps its own run: line');
  assert.doesNotMatch(step, /Lint affected projects/);
  assert.doesNotMatch(step, /lint-affected/);
});

test('stepNamed returns the neighbour when asked for its full name', () => {
  const step = stepNamed(SETUP, 'Lint affected projects');

  assert.match(step, /run: lint-affected/);
  assert.doesNotMatch(step, /lint-only/);
});

test('stepNamed throws for a name that is only a prefix of a real step', () => {
  assert.throws(
    () => stepNamed(SETUP, 'Lint affected'),
    /no step named exactly "Lint affected"/,
  );
});

test('stepNamed matches a name containing regex metacharacters literally', () => {
  const step = stepNamed(TEST, 'Run (a.b) suite');
  assert.match(step, /run: run-suite/);

  assert.throws(
    () => stepNamed(TEST, 'Run (axb) suite'),
    /no step named exactly "Run \(axb\) suite"/,
  );
});

test("ifOf reads a step's own condition and is undefined when it has none", () => {
  assert.equal(ifOf(stepNamed(SETUP, 'Lint')), 'always()');
  assert.equal(
    ifOf(stepNamed(SETUP, 'Lint affected projects')),
    'github.event_name == 1',
  );
  assert.equal(ifOf(stepNamed(TEST, 'Run (a.b) suite')), undefined);
});

test('ifOf ignores a condition nested deeper than the step', () => {
  const step = [
    '      - name: Guarded',
    '        uses: some/action@v1',
    '        with:',
    '          if: not-the-step-condition',
    '',
  ].join('\n');

  assert.equal(ifOf(step), undefined);
});

test('runOf reads a single-line run and is empty for a block scalar', () => {
  assert.equal(runOf(stepNamed(TEST, 'Run (a.b) suite')), 'run-suite');
  assert.equal(
    runOf(
      [
        '      - name: Scripted',
        '        run: |',
        '          echo hi',
        '',
      ].join('\n'),
    ),
    '',
  );
});

test('orTerms splits on || and sorts the terms so their order does not matter', () => {
  assert.deepEqual(orTerms("b == 'true' || a == 'true'"), [
    "a == 'true'",
    "b == 'true'",
  ]);
  assert.deepEqual(
    orTerms("b == 'true' || a == 'true'"),
    orTerms("a == 'true' || b == 'true'"),
  );
});

test('orTerms strips a ${{ }} wrapper', () => {
  assert.deepEqual(orTerms("${{ github.event_name == 'push' }}"), [
    "github.event_name == 'push'",
  ]);
});

test('orTerms strips parentheses around each term', () => {
  assert.deepEqual(orTerms("(a == 'true') || (b == 'true')"), [
    "a == 'true'",
    "b == 'true'",
  ]);
});

test('orTerms collapses internal whitespace within a term', () => {
  assert.deepEqual(orTerms("a   ==\n   'true'   ||   b == 'true'"), [
    "a == 'true'",
    "b == 'true'",
  ]);
});

test('orTerms throws naming the missing if: when given undefined', () => {
  assert.throws(() => orTerms(undefined), /if: is required/);
});

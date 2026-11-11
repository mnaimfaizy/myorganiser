// Contracts for the scenario grading rule (ADR 0147 decision 3), exercised
// through its public entry: gradeScenario, gradeScenarios, headlineFor,
// parseGradingInput, and GradingInputError. Pure functions, so no fixtures
// and no subprocess; the command-line surface is in ../grade-scenarios.test.ts.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  GradingInputError,
  gradeScenario,
  gradeScenarios,
  headlineFor,
  parseGradingInput,
  type AfterOutcome,
  type BeforeOutcome,
  type ChangeKind,
  type ScenarioResult,
} from './grade-scenarios.ts';

interface MatrixRow {
  before: BeforeOutcome;
  after: AfterOutcome;
  result: ScenarioResult;
  maintainerDecision: boolean;
}

// Every graded (before, after) pair for a fix. An After failure with Before
// not-run is refused rather than graded; see the refusal table below.
const FIX_MATRIX: readonly MatrixRow[] = [
  {
    before: 'pass',
    after: 'pass',
    result: 'Not proven',
    maintainerDecision: false,
  },
  { before: 'fail', after: 'pass', result: 'PASS', maintainerDecision: false },
  {
    before: 'cannot-run',
    after: 'pass',
    result: 'Not proven',
    maintainerDecision: false,
  },
  {
    before: 'not-run',
    after: 'pass',
    result: 'Not proven',
    maintainerDecision: false,
  },
  {
    before: 'fail',
    after: 'fail',
    result: 'FAIL: pre-existing',
    maintainerDecision: true,
  },
  {
    before: 'pass',
    after: 'fail',
    result: 'FAIL: regression',
    maintainerDecision: false,
  },
  {
    before: 'cannot-run',
    after: 'fail',
    result: 'FAIL: regression',
    maintainerDecision: false,
  },
  {
    before: 'pass',
    after: 'cannot-run',
    result: 'Left for a person',
    maintainerDecision: false,
  },
  {
    before: 'fail',
    after: 'cannot-run',
    result: 'Left for a person',
    maintainerDecision: false,
  },
  {
    before: 'cannot-run',
    after: 'cannot-run',
    result: 'Left for a person',
    maintainerDecision: false,
  },
  {
    before: 'not-run',
    after: 'cannot-run',
    result: 'Left for a person',
    maintainerDecision: false,
  },
];

// Every graded (before, after) pair for a feature. An After pass is PASS
// whatever Before did. An After failure with Before not-run is refused.
const FEATURE_MATRIX: readonly MatrixRow[] = [
  { before: 'pass', after: 'pass', result: 'PASS', maintainerDecision: false },
  { before: 'fail', after: 'pass', result: 'PASS', maintainerDecision: false },
  {
    before: 'cannot-run',
    after: 'pass',
    result: 'PASS',
    maintainerDecision: false,
  },
  {
    before: 'not-run',
    after: 'pass',
    result: 'PASS',
    maintainerDecision: false,
  },
  {
    before: 'fail',
    after: 'fail',
    result: 'FAIL: pre-existing',
    maintainerDecision: true,
  },
  {
    before: 'pass',
    after: 'fail',
    result: 'FAIL: regression',
    maintainerDecision: false,
  },
  {
    before: 'cannot-run',
    after: 'fail',
    result: 'FAIL: regression',
    maintainerDecision: false,
  },
  {
    before: 'pass',
    after: 'cannot-run',
    result: 'Left for a person',
    maintainerDecision: false,
  },
  {
    before: 'fail',
    after: 'cannot-run',
    result: 'Left for a person',
    maintainerDecision: false,
  },
  {
    before: 'cannot-run',
    after: 'cannot-run',
    result: 'Left for a person',
    maintainerDecision: false,
  },
  {
    before: 'not-run',
    after: 'cannot-run',
    result: 'Left for a person',
    maintainerDecision: false,
  },
];

function assertMatrix(
  changeKind: ChangeKind,
  rows: readonly MatrixRow[],
): void {
  for (const row of rows) {
    test(`${changeKind}: before ${row.before} / after ${row.after} => ${row.result}`, () => {
      const graded = gradeScenario(changeKind, {
        id: 'S1',
        before: row.before,
        after: row.after,
      });
      assert.deepEqual(graded, {
        id: 'S1',
        result: row.result,
        maintainerDecision: row.maintainerDecision,
      });
    });
  }
}

describe('gradeScenario: fix matrix', () => {
  assertMatrix('fix', FIX_MATRIX);
});

describe('gradeScenario: feature matrix', () => {
  assertMatrix('feature', FEATURE_MATRIX);
});

function assertRefused(fn: () => unknown, scenarioId: string): void {
  assert.throws(
    fn,
    (error: unknown) =>
      error instanceof GradingInputError &&
      error.message.includes(`scenario "${scenarioId}"`) &&
      error.message.includes('re-run on the merge-base first'),
  );
}

// An After failure with Before not-run is refused for both change kinds: the
// merge-base re-run has to tell pre-existing from regression first.
const REFUSED_CHANGE_KINDS: readonly ChangeKind[] = ['fix', 'feature'];

describe('gradeScenario: After failure with Before not-run is refused', () => {
  for (const changeKind of REFUSED_CHANGE_KINDS) {
    test(`${changeKind}: before not-run / after fail throws GradingInputError naming the scenario`, () => {
      assertRefused(
        () =>
          gradeScenario(changeKind, {
            id: 'S9-checkout',
            before: 'not-run',
            after: 'fail',
          }),
        'S9-checkout',
      );
    });
  }
});

test('gradeScenario keeps the scenario id on the graded result', () => {
  const graded = gradeScenario('fix', {
    id: 'S7-login',
    before: 'fail',
    after: 'pass',
  });
  assert.equal(graded.id, 'S7-login');
});

test('headlineFor: all PASS is "QA passed"', () => {
  assert.equal(headlineFor(['PASS', 'PASS']), 'QA passed');
});

test('headlineFor: an empty result list throws GradingInputError, not a green headline', () => {
  assert.throws(
    () => headlineFor([]),
    (error: unknown) =>
      error instanceof GradingInputError && /no scenarios/.test(error.message),
  );
});

test('headlineFor: unproven, pre-existing, or left items without a regression list them', () => {
  const expected = 'QA passed, not proven or pre-existing items listed';
  assert.equal(headlineFor(['PASS', 'Not proven']), expected);
  assert.equal(headlineFor(['PASS', 'FAIL: pre-existing']), expected);
  assert.equal(headlineFor(['PASS', 'Left for a person']), expected);
  assert.equal(
    headlineFor(['Not proven', 'FAIL: pre-existing', 'Left for a person']),
    expected,
  );
});

test('headlineFor: any regression is "QA failed", even beside passes and pre-existing items', () => {
  assert.equal(headlineFor(['FAIL: regression']), 'QA failed');
  assert.equal(headlineFor(['PASS', 'FAIL: regression']), 'QA failed');
  assert.equal(
    headlineFor(['FAIL: pre-existing', 'FAIL: regression', 'PASS']),
    'QA failed',
  );
});

test('gradeScenarios: a mixed fix grades each scenario and headlines the unproven one', () => {
  const report = gradeScenarios({
    changeKind: 'fix',
    scenarios: [
      { id: 'S1', before: 'fail', after: 'pass' },
      { id: 'S2', before: 'pass', after: 'pass' },
    ],
  });
  assert.equal(
    report.headline,
    'QA passed, not proven or pre-existing items listed',
  );
  assert.deepEqual(
    report.scenarios.map((scenario) => [scenario.id, scenario.result]),
    [
      ['S1', 'PASS'],
      ['S2', 'Not proven'],
    ],
  );
});

test('gradeScenarios: one regression makes the whole report "QA failed"', () => {
  const report = gradeScenarios({
    changeKind: 'fix',
    scenarios: [
      { id: 'S1', before: 'fail', after: 'pass' },
      { id: 'S2', before: 'pass', after: 'fail' },
    ],
  });
  assert.equal(report.headline, 'QA failed');
  assert.equal(report.scenarios[1]?.result, 'FAIL: regression');
});

test('gradeScenarios: a feature failing After with Before cannot-run is a regression, not refused', () => {
  const report = gradeScenarios({
    changeKind: 'feature',
    scenarios: [{ id: 'S1', before: 'cannot-run', after: 'fail' }],
  });
  assert.equal(report.headline, 'QA failed');
  assert.deepEqual(report.scenarios, [
    { id: 'S1', result: 'FAIL: regression', maintainerDecision: false },
  ]);
});

test('gradeScenarios: a single Before not-run failure refuses the whole report, not just that scenario', () => {
  assert.throws(
    () =>
      gradeScenarios({
        changeKind: 'feature',
        scenarios: [
          { id: 'S1', before: 'pass', after: 'pass' },
          { id: 'S2', before: 'not-run', after: 'fail' },
        ],
      }),
    (error: unknown) =>
      error instanceof GradingInputError &&
      error.message.includes('scenario "S2"') &&
      error.message.includes('re-run on the merge-base first'),
  );
});

test('gradeScenarios: an empty scenario list is a GradingInputError, not a green headline', () => {
  assert.throws(
    () => gradeScenarios({ changeKind: 'fix', scenarios: [] }),
    (error: unknown) =>
      error instanceof GradingInputError && /no scenarios/.test(error.message),
  );
});

test('parseGradingInput: accepts a valid fix input and returns it unchanged', () => {
  const raw = {
    changeKind: 'fix',
    scenarios: [{ id: 'S1', before: 'fail', after: 'pass' }],
  };
  assert.deepEqual(parseGradingInput(raw), raw);
});

test('parseGradingInput: accepts a feature input with cannot-run After', () => {
  const raw = {
    changeKind: 'feature',
    scenarios: [{ id: 'S1', before: 'not-run', after: 'cannot-run' }],
  };
  assert.deepEqual(parseGradingInput(raw), raw);
});

function assertInputError(raw: unknown, message: RegExp): void {
  assert.throws(
    () => parseGradingInput(raw),
    (error: unknown) =>
      error instanceof GradingInputError && message.test(error.message),
  );
}

const VALID_SCENARIO = { id: 'S1', before: 'fail', after: 'pass' };

const REJECTED_INPUTS: readonly {
  name: string;
  raw: unknown;
  message: RegExp;
}[] = [
  { name: 'null', raw: null, message: /must be a JSON object/ },
  { name: 'an array', raw: [], message: /must be a JSON object/ },
  { name: 'a string', raw: 'fix', message: /must be a JSON object/ },
  { name: 'a number', raw: 5, message: /must be a JSON object/ },
  {
    name: 'an unknown changeKind',
    raw: { changeKind: 'bugfix', scenarios: [VALID_SCENARIO] },
    message: /changeKind must be one of/,
  },
  {
    name: 'a missing changeKind',
    raw: { scenarios: [VALID_SCENARIO] },
    message: /changeKind must be one of/,
  },
  {
    name: 'non-array scenarios',
    raw: { changeKind: 'fix', scenarios: 'S1' },
    message: /scenarios must be an array/,
  },
  {
    name: 'a null scenario',
    raw: { changeKind: 'fix', scenarios: [null] },
    message: /scenarios\[0\] must be an object/,
  },
  {
    name: 'an array scenario',
    raw: { changeKind: 'fix', scenarios: [[]] },
    message: /scenarios\[0\] must be an object/,
  },
  {
    name: 'a missing id',
    raw: { changeKind: 'fix', scenarios: [{ before: 'fail', after: 'pass' }] },
    message: /scenarios\[0\]\.id must be a non-empty string/,
  },
  {
    name: 'an empty id',
    raw: { changeKind: 'fix', scenarios: [{ ...VALID_SCENARIO, id: '' }] },
    message: /scenarios\[0\]\.id must be a non-empty string/,
  },
  {
    name: 'a whitespace-only id',
    raw: { changeKind: 'fix', scenarios: [{ ...VALID_SCENARIO, id: '   ' }] },
    message: /scenarios\[0\]\.id must be a non-empty string/,
  },
  {
    name: 'a non-string id',
    raw: { changeKind: 'fix', scenarios: [{ ...VALID_SCENARIO, id: 1 }] },
    message: /scenarios\[0\]\.id must be a non-empty string/,
  },
  {
    name: 'a duplicate id',
    raw: {
      changeKind: 'fix',
      scenarios: [VALID_SCENARIO, { ...VALID_SCENARIO }],
    },
    message: /scenarios\[1\]\.id "S1" is a duplicate/,
  },
  {
    name: 'an unknown before',
    raw: {
      changeKind: 'fix',
      scenarios: [{ id: 'S1', before: 'unknown', after: 'pass' }],
    },
    message: /scenario "S1": before must be one of/,
  },
  {
    name: 'a missing before',
    raw: { changeKind: 'fix', scenarios: [{ id: 'S1', after: 'pass' }] },
    message: /scenario "S1": before must be one of/,
  },
  {
    name: 'after not-run',
    raw: {
      changeKind: 'fix',
      scenarios: [{ id: 'S1', before: 'fail', after: 'not-run' }],
    },
    message: /scenario "S1": after must be one of/,
  },
  {
    name: 'a non-string after',
    raw: {
      changeKind: 'fix',
      scenarios: [{ id: 'S1', before: 'fail', after: true }],
    },
    message: /scenario "S1": after must be one of/,
  },
];

describe('parseGradingInput: rejected input', () => {
  for (const { name, raw, message } of REJECTED_INPUTS) {
    test(`rejects ${name} with GradingInputError`, () => {
      assertInputError(raw, message);
    });
  }
});

test('GradingInputError is an Error named GradingInputError', () => {
  const error = new GradingInputError('boom');
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'GradingInputError');
  assert.equal(error.message, 'boom');
});

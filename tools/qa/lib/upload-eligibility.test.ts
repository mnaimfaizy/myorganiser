// Contracts for which QA Artifacts may be offered for upload (ADR 0147
// decisions 5 and 6), exercised through isUploadEligible over every
// ScenarioResult and every ArtifactSide. The expected answers are written out
// below as a literal table, not derived from the implementation, so a change to
// the rule shows up as a failing cell.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  ARTIFACT_SIDES,
  type ArtifactSide,
  isUploadEligible,
} from './upload-eligibility.ts';
import { SCENARIO_RESULTS, type ScenarioResult } from './grade-scenarios.ts';

type Row = Record<ArtifactSide, boolean>;

// Every combined file is eligible except FAIL: regression's (decision 6).
// A lone before or after is never eligible (decision 5).
const EXPECTED: Readonly<Record<ScenarioResult, Row>> = {
  PASS: { before: false, after: false, combined: true },
  'FAIL: regression': { before: false, after: false, combined: false },
  'FAIL: pre-existing': { before: false, after: false, combined: true },
  'Not proven': { before: false, after: false, combined: true },
  'Left for a person': { before: false, after: false, combined: true },
};

describe('upload eligibility: the table covers the real vocabulary', () => {
  test('every scenario result has an expected row', () => {
    assert.deepEqual(
      Object.keys(EXPECTED).sort(),
      [...SCENARIO_RESULTS].sort(),
    );
  });

  test('the sides are before, after and combined', () => {
    assert.deepEqual([...ARTIFACT_SIDES], [
      'before',
      'after',
      'combined',
    ] satisfies ArtifactSide[]);
  });
});

describe('upload eligibility: every result and side matches the table', () => {
  for (const result of SCENARIO_RESULTS) {
    for (const side of ARTIFACT_SIDES) {
      test(`${side} is ${EXPECTED[result][side] ? 'eligible' : 'not eligible'} for "${result}"`, () => {
        assert.equal(isUploadEligible(result, side), EXPECTED[result][side]);
      });
    }
  }
});

describe('upload eligibility: the invariants behind the table', () => {
  test('a lone before or after is never eligible, whatever the result', () => {
    for (const result of SCENARIO_RESULTS) {
      for (const side of ['before', 'after'] as const) {
        assert.equal(
          isUploadEligible(result, side),
          false,
          `${side} ${result}`,
        );
      }
    }
  });

  test('FAIL: regression is never eligible on any side', () => {
    for (const side of ARTIFACT_SIDES) {
      assert.equal(isUploadEligible('FAIL: regression', side), false, side);
    }
  });

  test('the only result whose combined file is withheld is FAIL: regression', () => {
    const withheld = SCENARIO_RESULTS.filter(
      (result) => !isUploadEligible(result, 'combined'),
    );
    assert.deepEqual(withheld, ['FAIL: regression']);
  });
});

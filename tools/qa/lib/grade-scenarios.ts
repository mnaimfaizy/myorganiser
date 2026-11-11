/**
 * Scenario grading for a QA Plan (ADR 0147 decision 3).
 *
 * A scenario has five results, and the QA Report headline follows from them.
 * This module is the one place that rule is written, so the headline is
 * applied the same way every time instead of by a QA session's judgement.
 *
 * Pure: every input is passed in, nothing touches disk or a process. The
 * command-line wrapper is `tools/qa/grade-scenarios.ts`.
 *
 * Calls the ADR does not spell out, each failing toward the louder outcome:
 *
 *   1. An After failure whose Before is "not run" is not graded at all. ADR
 *      0147 has the merge-base re-run after the failure tell pre-existing
 *      from regression, so grading it now would either block a merge on a
 *      failure that may be pre-existing or pass one that is not. It throws a
 *      GradingInputError naming the scenario: re-run it on the merge-base
 *      first. This holds for a fix too, which should never reach grading
 *      without a Before.
 *   2. An After failure whose Before "cannot run" is FAIL: regression: nothing
 *      shows the failure was already there, and Not proven would put a failing
 *      scenario under a headline that says nothing regressed.
 *   3. An After that cannot run is Left for a person, whatever Before did.
 */

export const CHANGE_KINDS = ['fix', 'feature'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const BEFORE_OUTCOMES = [
  'pass',
  'fail',
  'not-run',
  'cannot-run',
] as const;
export type BeforeOutcome = (typeof BEFORE_OUTCOMES)[number];

export const AFTER_OUTCOMES = ['pass', 'fail', 'cannot-run'] as const;
export type AfterOutcome = (typeof AFTER_OUTCOMES)[number];

export const SCENARIO_RESULTS = [
  'PASS',
  'FAIL: regression',
  'FAIL: pre-existing',
  'Not proven',
  'Left for a person',
] as const;
export type ScenarioResult = (typeof SCENARIO_RESULTS)[number];

export const HEADLINES = [
  'QA passed',
  'QA passed, not proven or pre-existing items listed',
  'QA failed',
] as const;
export type Headline = (typeof HEADLINES)[number];

export interface ScenarioInput {
  id: string;
  before: BeforeOutcome;
  after: AfterOutcome;
}

export interface GradingInput {
  changeKind: ChangeKind;
  scenarios: readonly ScenarioInput[];
}

export interface GradedScenario {
  id: string;
  result: ScenarioResult;
  /** A FAIL: pre-existing always goes to the Maintainer's batched decision. */
  maintainerDecision: boolean;
}

export interface GradingReport {
  headline: Headline;
  scenarios: GradedScenario[];
}

/** The input could not be graded — a bad invocation, not a QA result. */
export class GradingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradingInputError';
  }
}

function resultFor(
  changeKind: ChangeKind,
  before: BeforeOutcome,
  after: AfterOutcome,
): ScenarioResult {
  if (after === 'cannot-run') return 'Left for a person';

  if (after === 'fail') {
    return before === 'fail' ? 'FAIL: pre-existing' : 'FAIL: regression';
  }

  // After passed.
  if (changeKind === 'feature') return 'PASS';
  // A fix proves itself only when Before showed the defect.
  return before === 'fail' ? 'PASS' : 'Not proven';
}

export function gradeScenario(
  changeKind: ChangeKind,
  scenario: ScenarioInput,
): GradedScenario {
  if (scenario.after === 'fail' && scenario.before === 'not-run') {
    throw new GradingInputError(
      `scenario "${scenario.id}" failed After and Before was not run: re-run on the merge-base first`,
    );
  }
  const result = resultFor(changeKind, scenario.before, scenario.after);
  return {
    id: scenario.id,
    result,
    maintainerDecision: result === 'FAIL: pre-existing',
  };
}

export function headlineFor(results: readonly ScenarioResult[]): Headline {
  // "Every scenario passed" is vacuously true of none, and a headline that
  // checked nothing is the green this gate must not produce.
  if (results.length === 0)
    throw new GradingInputError('no scenarios to grade');
  if (results.every((result) => result === 'PASS')) return 'QA passed';
  if (results.some((result) => result === 'FAIL: regression')) {
    return 'QA failed';
  }
  return 'QA passed, not proven or pre-existing items listed';
}

export function gradeScenarios(input: GradingInput): GradingReport {
  if (input.scenarios.length === 0) {
    // "Every scenario passed" is vacuously true of none, and a headline that
    // checked nothing is the green this gate must not produce.
    throw new GradingInputError('no scenarios to grade');
  }
  const scenarios = input.scenarios.map((scenario) =>
    gradeScenario(input.changeKind, scenario),
  );
  return {
    headline: headlineFor(scenarios.map((scenario) => scenario.result)),
    scenarios,
  };
}

function isOneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
  );
}

/**
 * Narrows parsed JSON to a `GradingInput`, naming the first thing wrong with
 * it. Never echoes more than the offending field's name and its scenario id.
 */
export function parseGradingInput(raw: unknown): GradingInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new GradingInputError('input must be a JSON object');
  }
  const { changeKind, scenarios } = raw as Record<string, unknown>;
  if (!isOneOf(CHANGE_KINDS, changeKind)) {
    throw new GradingInputError(
      `changeKind must be one of: ${CHANGE_KINDS.join(', ')}`,
    );
  }
  if (!Array.isArray(scenarios)) {
    throw new GradingInputError('scenarios must be an array');
  }
  const seen = new Set<string>();
  const parsed = scenarios.map((entry: unknown, index): ScenarioInput => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new GradingInputError(`scenarios[${index}] must be an object`);
    }
    const { id, before, after } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id.trim() === '') {
      throw new GradingInputError(
        `scenarios[${index}].id must be a non-empty string`,
      );
    }
    if (seen.has(id)) {
      throw new GradingInputError(
        `scenarios[${index}].id "${id}" is a duplicate`,
      );
    }
    seen.add(id);
    if (!isOneOf(BEFORE_OUTCOMES, before)) {
      throw new GradingInputError(
        `scenario "${id}": before must be one of: ${BEFORE_OUTCOMES.join(', ')}`,
      );
    }
    if (!isOneOf(AFTER_OUTCOMES, after)) {
      throw new GradingInputError(
        `scenario "${id}": after must be one of: ${AFTER_OUTCOMES.join(', ')}`,
      );
    }
    return { id, before, after };
  });
  return { changeKind, scenarios: parsed };
}

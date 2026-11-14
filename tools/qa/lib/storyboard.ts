/**
 * The Storyboard model (PRD #1544): what a screen scenario's QA Artifact
 * says, before anything is drawn.
 *
 * A Storyboard stands alone. Its band names the scenario, its graded result
 * and the commits each side ran on; one side card per side gives that side's
 * Expected and Observed and whether it showed what it was expected to; one
 * row per step puts Before beside After, the last step marked as the one the
 * check is made on.
 *
 * Two rules keep it from being misread:
 *
 *   - A side's mark is judged against **that side's own** expected outcome
 *     (`expectedOutcome`), never the runner's pass or fail. For a fix, Before
 *     failing is the defect reproduced, so it is "as expected". A side with
 *     no declared expected result is "not judged", never marked either way.
 *   - The band's result is the graded result, passed in. It is never derived
 *     from the side marks.
 *
 * Anything that stops a Storyboard being made is returned in `problems`, not
 * thrown; the executor refuses the combined file on any problem without
 * knowing what it is. The model has a column per side that ran, except that
 * one column (After's) stands for both when they are alike (`band.alike`):
 * the expected results are identical and both sides showed them. A run After
 * only has one column; a different step count between sides is a problem.
 *
 * Pure: nothing touches disk, a process or a browser. The page is drawn by
 * `storyboard-html.ts` and rendered by `storyboard-render.ts`.
 */
import type { ScenarioResult } from './grade-scenarios.ts';
import type { RunOutcome } from './qa-run.ts';
import type { ExpectedResults, StepRecord } from './qa-scenario.ts';
import type { Side } from './qa-stack.ts';
import { SIDES } from './qa-switch.ts';

/** What one side's run left for its side card and its column. */
export interface StoryboardSideInput {
  outcome: RunOutcome;
  /** What a passing run reported it observed. */
  observed?: string;
  /** First line of a failure's (or a cannot-run's) message. */
  message?: string;
  steps: readonly StepRecord[];
}

export interface StoryboardInput {
  id: string;
  title: string;
  expected: ExpectedResults;
  /** The graded result: the band's, and nothing else's. */
  result: ScenarioResult;
  commits: Record<Side, string>;
  sides: Partial<Record<Side, StoryboardSideInput>>;
}

export interface Band {
  id: string;
  title: string;
  result: ScenarioResult;
  commits: Record<Side, string>;
  /** Set to `ALIKE_TEXT` when one column stands for both sides; else absent. */
  alike?: typeof ALIKE_TEXT;
}

/**
 * Whether a side showed the outcome it was expected to; `not-judged` when the
 * scenario declared no expected result for it (a feature re-run on the
 * merge-base), since there is nothing to judge it against.
 */
export const MARKS = ['as-expected', 'not-as-expected', 'not-judged'] as const;
export type Mark = (typeof MARKS)[number];

/** The words each mark is shown with. */
export const MARK_TEXT = {
  'as-expected': '✓ as expected',
  'not-as-expected': '✗ not as expected',
  'not-judged': '– not judged: no expected result declared',
} as const satisfies Record<Mark, string>;

export interface SideCard {
  side: Side;
  expected: string;
  observed: string;
  mark: Mark;
}

export interface StoryboardRow {
  /** 1-based. */
  index: number;
  /** One step per column, or `null` where that side took no step at this index. */
  cells: Record<Side, StepRecord | null>;
  /** The step the scenario's check is made on. */
  checked: boolean;
}

export interface Storyboard {
  band: Band;
  columns: readonly Side[];
  sides: SideCard[];
  rows: StoryboardRow[];
  /** Why no Storyboard may be made from this input; empty when it may. */
  problems: string[];
}

/** The band's words when one column stands for Before and After alike. */
export const ALIKE_TEXT = 'Before and After alike';

/** Shown on a side card when the scenario declared no expected result for it. */
export const NOT_DECLARED = '(no expected result declared for this side)';

/** Shown when a passing run reported nothing it observed. */
export const NOTHING_OBSERVED = '(the run reported nothing it observed)';

/**
 * The outcome a side is expected to have. After is expected to pass. Before
 * is expected to fail, because it shows the defect (or the missing feature),
 * unless both sides were expected to show the same thing: a regression guard
 * (#1542 S2), where Before passing is the expected behaviour.
 */
export function expectedOutcome(
  side: Side,
  expected: ExpectedResults,
): RunOutcome {
  if (side === 'after') return 'pass';
  return declaresSame(expected) ? 'pass' : 'fail';
}

/** Whether the scenario expects the same result on both sides. */
function declaresSame(expected: ExpectedResults): boolean {
  return expected.before === expected.after;
}

/** A side's mark: against its own declared expectation, or none when it declared nothing. */
function markOf(
  side: Side,
  run: StoryboardSideInput,
  expected: ExpectedResults,
): Mark {
  if (expected[side] === undefined) return 'not-judged';
  return run.outcome === expectedOutcome(side, expected)
    ? 'as-expected'
    : 'not-as-expected';
}

/** What a side observed: a passing run's report, or a failure's message. */
function observedText(run: StoryboardSideInput): string {
  const text = run.outcome === 'pass' ? run.observed : run.message;
  return text === undefined || text.trim() === '' ? NOTHING_OBSERVED : text;
}

/** Each side's step at a row index, or `null` where that side took none. */
function cellsAt(
  sides: StoryboardInput['sides'],
  i: number,
): Record<Side, StepRecord | null> {
  const cells: Partial<Record<Side, StepRecord | null>> = {};
  for (const side of SIDES) cells[side] = sides[side]?.steps[i] ?? null;
  return cells as Record<Side, StepRecord | null>;
}

export function buildStoryboard(input: StoryboardInput): Storyboard {
  const problems: string[] = [];
  const columns = SIDES.filter((side) => input.sides[side] !== undefined);

  const sides: SideCard[] = [];
  for (const side of columns) {
    const run = input.sides[side];
    if (!run) continue;
    if (run.steps.length === 0) {
      problems.push(`${side}: no step() was called, so no Storyboard was made`);
    }
    const expected = input.expected[side] ?? NOT_DECLARED;
    sides.push({
      side,
      expected,
      observed: observedText(run),
      mark: markOf(side, run, input.expected),
    });
  }

  // Steps are matched across sides by index, so both sides must have taken
  // the same number (a side with none already has its own problem). A ragged
  // grid is never drawn silently.
  const counts = columns.map((side) => input.sides[side]?.steps.length ?? 0);
  if (!counts.includes(0) && new Set(counts).size > 1) {
    problems.push(
      `Before took ${input.sides.before?.steps.length ?? 0} step(s) and After took ${input.sides.after?.steps.length ?? 0}; steps are matched by index, so no Storyboard was made`,
    );
  }

  // One column "Before and After alike" only when the scenario declares the
  // same expected result for both sides and both observed it. Rows never
  // collapse individually: the Before cells stay in each row as evidence.
  const alike =
    columns.length === 2 &&
    declaresSame(input.expected) &&
    sides.every((card) => card.mark === 'as-expected');
  const shown: readonly Side[] = alike ? ['after'] : columns;

  const rowCount = Math.max(0, ...counts);
  const rows: StoryboardRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push({
      index: i + 1,
      cells: cellsAt(input.sides, i),
      checked: i === rowCount - 1,
    });
  }

  return {
    band: {
      id: input.id,
      title: input.title,
      result: input.result,
      commits: input.commits,
      ...(alike ? { alike: ALIKE_TEXT } : {}),
    },
    columns: shown,
    sides,
    rows,
    problems,
  };
}

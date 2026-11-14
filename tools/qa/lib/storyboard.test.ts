// Contracts for the Storyboard model (PRD #1544), exercised through storyboard.ts's
// public exports: what a reader sees on each side card, in each row and in the
// band, and which problems stop a Storyboard being made. Pure: nothing here
// touches disk, a process or a browser.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ScenarioResult } from './grade-scenarios.ts';
import type { ExpectedResults, StepRecord } from './qa-scenario.ts';
import type { Side } from './qa-stack.ts';
import {
  ALIKE_TEXT,
  MARK_TEXT,
  NOT_DECLARED,
  NOTHING_OBSERVED,
  type StoryboardInput,
  type StoryboardSideInput,
  buildStoryboard,
  checkedStepIndex,
  expectedOutcome,
} from './storyboard.ts';

const COMMITS = { before: 'a'.repeat(40), after: 'b'.repeat(40) };
/** A fix: Before is expected to fail (the defect), After to pass. */
const DIFFERENT: ExpectedResults = {
  before: 'the defect shows',
  after: 'the fix shows',
};
/** A regression guard: both sides are expected to show the same result. */
const SAME: ExpectedResults = {
  before: 'the same label',
  after: 'the same label',
};

function step(
  side: Side,
  index: number,
  caption = `step ${index}`,
): StepRecord {
  return {
    side,
    index,
    device: 'Desktop',
    tab: '',
    label: 'Device Desktop',
    caption,
    still: `steps/S1/${side}/${String(index).padStart(2, '0')}.png`,
    subject: null,
    atMs: 0,
  };
}

function board(
  sides: Partial<Record<Side, StoryboardSideInput>>,
  overrides: Partial<Pick<StoryboardInput, 'expected' | 'result'>> = {},
) {
  return buildStoryboard({
    id: 'S1',
    title: 'Save an item',
    expected: DIFFERENT,
    result: 'PASS',
    commits: COMMITS,
    sides,
    ...overrides,
  });
}

const markOf = (
  storyboard: ReturnType<typeof board>,
  side: Side,
): string | undefined =>
  storyboard.sides.find((card) => card.side === side)?.mark;

describe('buildStoryboard: a fix that reproduces its defect', () => {
  test('Before fails as expected and After passes as expected, each card showing its own observed text', () => {
    const storyboard = board({
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [step('before', 1)],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [step('after', 1)],
      },
    });
    assert.deepEqual(storyboard.sides, [
      {
        side: 'before',
        expected: 'the defect shows',
        observed: 'the defect shows here',
        mark: 'as-expected',
      },
      {
        side: 'after',
        expected: 'the fix shows',
        observed: 'the fix shows here',
        mark: 'as-expected',
      },
    ]);
    assert.deepEqual(storyboard.problems, []);
    assert.deepEqual(storyboard.band, {
      id: 'S1',
      title: 'Save an item',
      result: 'PASS',
      commits: COMMITS,
    });
  });

  test('a side whose outcome differs from the one it is expected to have is not-as-expected', () => {
    const passing = {
      outcome: 'pass',
      observed: 'the fix shows',
      steps: [step('after', 1)],
    } as const;
    const failing = {
      outcome: 'fail',
      message: 'the defect shows',
      steps: [step('before', 1)],
    } as const;
    const cases: [string, Partial<Record<Side, StoryboardSideInput>>, Side][] =
      [
        [
          'Before passes on a fix whose expected results differ',
          {
            before: {
              outcome: 'pass',
              observed: 'the label shows',
              steps: [step('before', 1)],
            },
            after: passing,
          },
          'before',
        ],
        [
          'After fails',
          {
            before: failing,
            after: {
              outcome: 'fail',
              message: 'still broken',
              steps: [step('after', 1)],
            },
          },
          'after',
        ],
        [
          'Before cannot run',
          {
            before: {
              outcome: 'cannot-run',
              message: 'no account',
              steps: [step('before', 1)],
            },
            after: passing,
          },
          'before',
        ],
        [
          'After cannot run',
          {
            before: failing,
            after: {
              outcome: 'cannot-run',
              message: 'no account',
              steps: [step('after', 1)],
            },
          },
          'after',
        ],
      ];
    for (const [name, sides, side] of cases) {
      assert.equal(markOf(board(sides), side), 'not-as-expected', name);
    }
  });
});

describe('buildStoryboard: a regression guard, where both sides are expected to show the same result', () => {
  const after: StoryboardSideInput = {
    outcome: 'pass',
    observed: 'the same label',
    steps: [step('after', 1)],
  };

  test('Before passing is as-expected', () => {
    const storyboard = board(
      {
        before: {
          outcome: 'pass',
          observed: 'the same label',
          steps: [step('before', 1)],
        },
        after,
      },
      { expected: SAME },
    );
    assert.equal(markOf(storyboard, 'before'), 'as-expected');
  });

  test('Before failing is not-as-expected', () => {
    const storyboard = board(
      {
        before: {
          outcome: 'fail',
          message: 'the label is gone',
          steps: [step('before', 1)],
        },
        after,
      },
      { expected: SAME },
    );
    assert.equal(markOf(storyboard, 'before'), 'not-as-expected');
  });
});

describe('expectedOutcome', () => {
  test('After is expected to pass; Before to fail, unless both sides are expected to show the same result', () => {
    assert.equal(expectedOutcome('after', DIFFERENT), 'pass');
    assert.equal(expectedOutcome('after', SAME), 'pass');
    assert.equal(expectedOutcome('before', DIFFERENT), 'fail');
    assert.equal(expectedOutcome('before', SAME), 'pass');
  });
});

describe('buildStoryboard: the band', () => {
  for (const result of [
    'Not proven',
    'FAIL: regression',
  ] as const satisfies readonly ScenarioResult[]) {
    test(`shows the graded result (${result}), not one derived from the marks`, () => {
      // Both sides are as-expected, so a derived result would read PASS.
      const storyboard = board(
        {
          before: {
            outcome: 'fail',
            message: 'the defect shows here',
            steps: [step('before', 1)],
          },
          after: {
            outcome: 'pass',
            observed: 'the fix shows here',
            steps: [step('after', 1)],
          },
        },
        { result },
      );
      assert.deepEqual(
        storyboard.sides.map((card) => card.mark),
        ['as-expected', 'as-expected'],
      );
      assert.equal(storyboard.band.result, result);
    });
  }
});

describe('buildStoryboard: the rows', () => {
  const uneven = () =>
    board({
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [step('before', 1), step('before', 2)],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [step('after', 1), step('after', 2), step('after', 3)],
      },
    });

  test('one row per step index, zipped by index and numbered from 1', () => {
    const { rows } = uneven();
    assert.deepEqual(
      rows.map((row) => row.index),
      [1, 2, 3],
    );
    assert.deepEqual(rows[1].cells.before, step('before', 2));
    assert.deepEqual(rows[1].cells.after, step('after', 2));
  });

  test('only the last row is checked, and a side with no step at that index is null', () => {
    const { rows } = uneven();
    assert.deepEqual(
      rows.map((row) => row.checked),
      [false, false, true],
    );
    assert.equal(rows[2].cells.before, null);
    assert.deepEqual(rows[2].cells.after, step('after', 3));
  });
});

describe('buildStoryboard: the problems', () => {
  test('a side that ran with no step is a problem, once per such side, and steps on both sides leave none', () => {
    const oneZero = board({
      before: { outcome: 'fail', message: 'm', steps: [] },
      after: {
        outcome: 'pass',
        observed: 'o',
        steps: [step('after', 1)],
      },
    });
    assert.deepEqual(oneZero.problems, [
      'before: no step() was called, so no Storyboard was made',
    ]);

    const bothZero = board({
      before: { outcome: 'fail', message: 'm', steps: [] },
      after: { outcome: 'pass', observed: 'o', steps: [] },
    });
    assert.deepEqual(bothZero.problems, [
      'before: no step() was called, so no Storyboard was made',
      'after: no step() was called, so no Storyboard was made',
    ]);

    const both = board({
      before: {
        outcome: 'fail',
        message: 'm',
        steps: [step('before', 1)],
      },
      after: {
        outcome: 'pass',
        observed: 'o',
        steps: [step('after', 1)],
      },
    });
    assert.deepEqual(both.problems, []);
  });
});

describe('buildStoryboard: what a side observed', () => {
  test('a passing run with no observed text, or only spaces, and a failing run with no message show NOTHING_OBSERVED', () => {
    const spaces = board({
      before: { outcome: 'fail', steps: [step('before', 1)] },
      after: {
        outcome: 'pass',
        observed: '   ',
        steps: [step('after', 1)],
      },
    });
    assert.deepEqual(
      spaces.sides.map((card) => card.observed),
      [NOTHING_OBSERVED, NOTHING_OBSERVED],
    );

    const noObserved = board({
      before: {
        outcome: 'fail',
        message: 'm',
        steps: [step('before', 1)],
      },
      after: { outcome: 'pass', steps: [step('after', 1)] },
    });
    assert.equal(noObserved.sides[1].observed, NOTHING_OBSERVED);
  });
});

describe('buildStoryboard: the columns and the mark words', () => {
  test('columns lists only the sides that ran, Before then After, whatever order they were given in', () => {
    const afterOnly = board({
      after: {
        outcome: 'pass',
        observed: 'o',
        steps: [step('after', 1)],
      },
    });
    assert.deepEqual(afterOnly.columns, ['after']);

    const both = board({
      after: {
        outcome: 'pass',
        observed: 'o',
        steps: [step('after', 1)],
      },
      before: {
        outcome: 'fail',
        message: 'm',
        steps: [step('before', 1)],
      },
    });
    assert.deepEqual(both.columns, ['before', 'after']);
  });

  test('each mark is shown with its fixed words', () => {
    assert.deepEqual(MARK_TEXT, {
      'as-expected': '✓ as expected',
      'not-as-expected': '✗ not as expected',
      'not-judged': '– not judged: no expected result declared',
    });
  });
});

describe('buildStoryboard: alike, when one column stands for both sides', () => {
  const bothPass = (): Partial<Record<Side, StoryboardSideInput>> => ({
    before: {
      outcome: 'pass',
      observed: 'the same label',
      steps: [step('before', 1), step('before', 2)],
    },
    after: {
      outcome: 'pass',
      observed: 'the same label',
      steps: [step('after', 1), step('after', 2)],
    },
  });

  test('identical expected results that both sides observed give one After column, the alike band text, and the graded result', () => {
    const storyboard = board(bothPass(), {
      expected: SAME,
      result: 'Not proven',
    });
    assert.deepEqual(storyboard.columns, ['after']);
    assert.equal(storyboard.band.alike, ALIKE_TEXT);
    assert.equal(storyboard.band.result, 'Not proven');
    assert.deepEqual(storyboard.problems, []);
  });

  test('rows never collapse: each row keeps its Before cell beside the After one', () => {
    const { rows } = board(bothPass(), { expected: SAME });
    assert.deepEqual(
      rows.map((row) => row.cells.before),
      [step('before', 1), step('before', 2)],
    );
    assert.deepEqual(
      rows.map((row) => row.cells.after),
      [step('after', 1), step('after', 2)],
    );
  });

  test('identical expected results where one side is not as expected give two columns and no alike band', () => {
    const cases: [string, Partial<Record<Side, StoryboardSideInput>>, Side][] =
      [
        [
          'Before fails where it is expected to pass',
          {
            before: {
              outcome: 'fail',
              message: 'the label is gone',
              steps: [step('before', 1)],
            },
            after: {
              outcome: 'pass',
              observed: 'the same label',
              steps: [step('after', 1)],
            },
          },
          'before',
        ],
        [
          'After fails',
          {
            before: {
              outcome: 'pass',
              observed: 'the same label',
              steps: [step('before', 1)],
            },
            after: {
              outcome: 'fail',
              message: 'the label is gone',
              steps: [step('after', 1)],
            },
          },
          'after',
        ],
      ];
    for (const [name, sides, side] of cases) {
      const storyboard = board(sides, { expected: SAME });
      assert.deepEqual(storyboard.columns, ['before', 'after'], name);
      assert.equal(storyboard.band.alike, undefined, name);
      assert.equal(markOf(storyboard, side), 'not-as-expected', name);
    }
  });

  test('different expected results give two columns even when both sides are as expected', () => {
    const storyboard = board({
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [step('before', 1)],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [step('after', 1)],
      },
    });
    assert.deepEqual(
      storyboard.sides.map((card) => card.mark),
      ['as-expected', 'as-expected'],
    );
    assert.deepEqual(storyboard.columns, ['before', 'after']);
    assert.equal(storyboard.band.alike, undefined);
  });

  test('a Before and After with different step counts is a problem, even when their expected results are alike', () => {
    const storyboard = board(
      {
        before: {
          outcome: 'pass',
          observed: 'the same label',
          steps: [step('before', 1)],
        },
        after: {
          outcome: 'pass',
          observed: 'the same label',
          steps: [step('after', 1), step('after', 2)],
        },
      },
      { expected: SAME },
    );
    assert.deepEqual(storyboard.problems, [
      'Before took 1 step(s) and After took 2; steps are matched by index, so no Storyboard was made',
    ]);
  });
});

describe('buildStoryboard: a feature with one side or no expected.before', () => {
  test('a feature run After only is one After column, needs no expected.before, and has no problem', () => {
    const storyboard = board(
      {
        after: {
          outcome: 'pass',
          observed: 'the fix shows here',
          steps: [step('after', 1), step('after', 2)],
        },
      },
      { expected: { after: 'the fix shows' } },
    );
    assert.deepEqual(storyboard.columns, ['after']);
    assert.deepEqual(storyboard.sides, [
      {
        side: 'after',
        expected: 'the fix shows',
        observed: 'the fix shows here',
        mark: 'as-expected',
      },
    ]);
    assert.deepEqual(storyboard.problems, []);
    assert.equal(storyboard.band.alike, undefined);
    assert.deepEqual(
      storyboard.rows.map((row) => row.cells.before),
      [null, null],
    );
  });

  test('a feature re-run on the merge-base with no expected.before gives two columns, Before expects nothing declared, and no alike band', () => {
    const storyboard = board(
      {
        before: {
          outcome: 'fail',
          message: 'the defect is still there',
          steps: [step('before', 1)],
        },
        after: {
          outcome: 'fail',
          message: 'still broken',
          steps: [step('after', 1)],
        },
      },
      { expected: { after: 'the fix shows' }, result: 'FAIL: pre-existing' },
    );
    assert.deepEqual(storyboard.columns, ['before', 'after']);
    assert.deepEqual(
      storyboard.sides.map((card) => [card.side, card.expected, card.mark]),
      [
        ['before', NOT_DECLARED, 'not-judged'],
        ['after', 'the fix shows', 'not-as-expected'],
      ],
    );
    assert.equal(storyboard.band.alike, undefined);
  });
});

describe('buildStoryboard: a side with no declared expected result is not judged', () => {
  const mergeBase = { after: 'the fix shows' };

  test('a feature re-run on the merge-base whose Before fails, with no expected.before, is not-judged', () => {
    const storyboard = board(
      {
        before: {
          outcome: 'fail',
          message: 'the feature is missing',
          steps: [step('before', 1)],
        },
        after: {
          outcome: 'pass',
          observed: 'the feature shows',
          steps: [step('after', 1)],
        },
      },
      { expected: mergeBase },
    );
    assert.equal(markOf(storyboard, 'before'), 'not-judged');
    assert.equal(
      storyboard.sides.find((card) => card.side === 'before')?.expected,
      NOT_DECLARED,
    );
  });

  test('a feature re-run on the merge-base whose Before passes, with no expected.before, is also not-judged', () => {
    const storyboard = board(
      {
        before: {
          outcome: 'pass',
          observed: 'the feature shows already',
          steps: [step('before', 1)],
        },
        after: {
          outcome: 'pass',
          observed: 'the feature shows',
          steps: [step('after', 1)],
        },
      },
      { expected: mergeBase },
    );
    assert.equal(markOf(storyboard, 'before'), 'not-judged');
    assert.equal(markOf(storyboard, 'after'), 'as-expected');
  });

  test('a not-judged mark does not change the band: the graded result is the one passed in, whatever the marks', () => {
    for (const result of [
      'PASS',
      'FAIL: pre-existing',
      'Not proven',
    ] as const satisfies readonly ScenarioResult[]) {
      const storyboard = board(
        {
          before: {
            outcome: 'pass',
            observed: 'shows',
            steps: [step('before', 1)],
          },
          after: {
            outcome: 'pass',
            observed: 'shows',
            steps: [step('after', 1)],
          },
        },
        { expected: mergeBase, result },
      );
      assert.equal(markOf(storyboard, 'before'), 'not-judged');
      assert.equal(storyboard.band.result, result, result);
      assert.equal(storyboard.band.alike, undefined, result);
      assert.deepEqual(storyboard.problems, [], result);
    }
  });
});

describe('buildStoryboard: a side that declares its expected result is judged as before', () => {
  const one = (outcome: 'pass' | 'fail'): StoryboardSideInput =>
    outcome === 'pass'
      ? { outcome, observed: 'shows', steps: [step('after', 1)] }
      : { outcome, message: 'does not show', steps: [step('after', 1)] };

  test('a fix judges Before by failing and After by passing, a regression guard by the same result on both', () => {
    const cases: [
      string,
      Partial<Record<Side, StoryboardSideInput>>,
      ExpectedResults,
      Side,
      string,
    ][] = [
      [
        'fix: Before fails',
        { before: one('fail'), after: one('pass') },
        DIFFERENT,
        'before',
        'as-expected',
      ],
      [
        'fix: Before passes',
        { before: one('pass'), after: one('pass') },
        DIFFERENT,
        'before',
        'not-as-expected',
      ],
      [
        'fix: After passes',
        { before: one('fail'), after: one('pass') },
        DIFFERENT,
        'after',
        'as-expected',
      ],
      [
        'fix: After fails',
        { before: one('fail'), after: one('fail') },
        DIFFERENT,
        'after',
        'not-as-expected',
      ],
      [
        'regression guard: Before passes',
        { before: one('pass'), after: one('pass') },
        SAME,
        'before',
        'as-expected',
      ],
      [
        'regression guard: Before fails',
        { before: one('fail'), after: one('pass') },
        SAME,
        'before',
        'not-as-expected',
      ],
      [
        'After only: passes',
        { after: one('pass') },
        { after: 'the fix shows' },
        'after',
        'as-expected',
      ],
      [
        'After only: fails',
        { after: one('fail') },
        { after: 'the fix shows' },
        'after',
        'not-as-expected',
      ],
    ];
    for (const [name, sides, expected, side, mark] of cases) {
      assert.equal(markOf(board(sides, { expected }), side), mark, name);
    }
  });
});

/** A step the script marked `checked`. */
const marked = (side: Side, index: number): StepRecord => ({
  ...step(side, index),
  checked: true,
});

describe('checkedStepIndex: the step the check is made on', () => {
  test('the marked step, else the last; the first mark when there are several; 0 with no steps', () => {
    const steps = (...marks: number[]) =>
      [1, 2, 3].map((index) => ({
        index,
        ...(marks.includes(index) ? { checked: true as const } : {}),
      }));
    assert.equal(checkedStepIndex(steps()), 3, 'no mark: the last');
    assert.equal(checkedStepIndex(steps(2)), 2, 'a mark on an earlier step');
    assert.equal(checkedStepIndex(steps(1, 2)), 1, 'several marks: the first');
    assert.equal(checkedStepIndex([]), 0, 'no steps');
  });
});

describe('buildStoryboard: the checked step', () => {
  const passing = (side: Side, steps: StepRecord[]): StoryboardSideInput => ({
    outcome: 'pass',
    observed: 'shows',
    steps,
  });
  const checkedRows = (storyboard: ReturnType<typeof board>) =>
    storyboard.rows.map((row) => row.checked);

  test('with no mark, the last row is the checked one', () => {
    const storyboard = board({
      before: passing('before', [
        step('before', 1),
        step('before', 2),
        step('before', 3),
      ]),
      after: passing('after', [
        step('after', 1),
        step('after', 2),
        step('after', 3),
      ]),
    });
    assert.deepEqual(checkedRows(storyboard), [false, false, true]);
    assert.deepEqual(storyboard.problems, []);
  });

  test('a step marked on both sides is the checked row, and the last step is not', () => {
    const storyboard = board({
      before: passing('before', [
        step('before', 1),
        marked('before', 2),
        step('before', 3),
      ]),
      after: passing('after', [
        step('after', 1),
        marked('after', 2),
        step('after', 3),
      ]),
    });
    assert.deepEqual(checkedRows(storyboard), [false, true, false]);
    assert.deepEqual(storyboard.problems, []);
  });

  test('a side that marks the last step, with the other unmarked, agrees and draws the last row checked', () => {
    const storyboard = board({
      before: passing('before', [step('before', 1), marked('before', 2)]),
      after: passing('after', [step('after', 1), step('after', 2)]),
    });
    assert.deepEqual(checkedRows(storyboard), [false, true]);
    assert.deepEqual(storyboard.problems, []);
  });

  test('a side marking an earlier step while the other leaves the last checked is a problem naming both steps', () => {
    const storyboard = board({
      before: passing('before', [marked('before', 1), step('before', 2)]),
      after: passing('after', [step('after', 1), step('after', 2)]),
    });
    assert.deepEqual(storyboard.problems, [
      'Before checks step 1 and After checks step 2; steps are matched by index, so both sides must check the same step and no Storyboard was made',
    ]);
  });

  test('a side that marks two steps is a problem naming that side', () => {
    const storyboard = board({
      before: passing('before', [marked('before', 1), marked('before', 2)]),
      after: passing('after', [marked('after', 1), step('after', 2)]),
    });
    assert.deepEqual(storyboard.problems, [
      'before marked 2 steps as checked; at most one may be, so no Storyboard was made',
    ]);
  });

  test('sides that check different steps are a problem, and the Storyboard is not made from them', () => {
    const storyboard = board({
      before: passing('before', [marked('before', 1), step('before', 2)]),
      after: passing('after', [step('after', 1), marked('after', 2)]),
    });
    assert.deepEqual(storyboard.problems, [
      'Before checks step 1 and After checks step 2; steps are matched by index, so both sides must check the same step and no Storyboard was made',
    ]);
  });

  test('the alike one-column path still draws its checked row', () => {
    const storyboard = board(
      {
        before: passing('before', [step('before', 1), marked('before', 2)]),
        after: passing('after', [step('after', 1), marked('after', 2)]),
      },
      { expected: SAME },
    );
    assert.deepEqual(storyboard.columns, ['after']);
    assert.equal(storyboard.band.alike, ALIKE_TEXT);
    assert.deepEqual(checkedRows(storyboard), [false, true]);
    assert.deepEqual(storyboard.problems, []);
  });

  test('a ragged grid keeps only its own problem, even where the sides check different steps', () => {
    const storyboard = board({
      before: passing('before', [marked('before', 1)]),
      after: passing('after', [step('after', 1), step('after', 2)]),
    });
    assert.deepEqual(storyboard.problems, [
      'Before took 1 step(s) and After took 2; steps are matched by index, so no Storyboard was made',
    ]);
  });

  test('an empty side keeps only its own problem, even where the other side checks a step', () => {
    const storyboard = board({
      before: { outcome: 'fail', message: 'm', steps: [] },
      after: passing('after', [step('after', 1), marked('after', 2)]),
    });
    assert.deepEqual(storyboard.problems, [
      'before: no step() was called, so no Storyboard was made',
    ]);
  });
});

describe('buildStoryboard: After is always judged against its declared expected result', () => {
  test('After on a merge-base re-run is judged whatever its outcome, never not-judged', () => {
    const cases: [
      StoryboardSideInput['outcome'],
      Partial<Record<Side, StoryboardSideInput>>,
      string,
    ][] = [
      [
        'pass',
        {
          after: { outcome: 'pass', observed: 'o', steps: [step('after', 1)] },
        },
        'as-expected',
      ],
      [
        'fail',
        { after: { outcome: 'fail', message: 'm', steps: [step('after', 1)] } },
        'not-as-expected',
      ],
      [
        'cannot-run',
        {
          after: {
            outcome: 'cannot-run',
            message: 'm',
            steps: [step('after', 1)],
          },
        },
        'not-as-expected',
      ],
    ];
    for (const [outcome, sides, mark] of cases) {
      const storyboard = board(sides, { expected: { after: 'the fix shows' } });
      assert.equal(markOf(storyboard, 'after'), mark, outcome);
      assert.notEqual(markOf(storyboard, 'after'), 'not-judged', outcome);
    }
  });
});

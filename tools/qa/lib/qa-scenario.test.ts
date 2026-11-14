// Contracts for the scenario contract (ADR 0147 decision 1; PRD #1544's
// Storyboards), exercised through qa-scenario.ts's public exports. A screen
// scenario (video or screenshot) must declare its title and the result each
// side was expected to show; a transcript or none scenario needs neither.
// Nothing here touches disk, a process or a browser.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type ParseOptions,
  RunInputError,
  SCREEN_CAPTURE,
  type Scenario,
  checkScenarioIds,
  isScreenScenario,
  isVideoScenario,
  parseScenario,
  stepNumber,
} from './qa-scenario.ts';

/** A fix plays Before up front, so expected.before is required. */
const FIX: ParseOptions = { runsBefore: true };
/** A feature served After alone, so expected.before is optional. */
const FEATURE: ParseOptions = { runsBefore: false };

/** A refusal is a RunInputError whose message matches `message`. */
function refusal(fn: () => unknown, message: RegExp): void {
  assert.throws(
    fn,
    (error: unknown) =>
      error instanceof RunInputError && message.test(error.message),
  );
}

const noop = async (): Promise<void> => undefined;

/** A copy of `fixture` without `key`, so the key is absent rather than undefined. */
function omit(
  fixture: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fixture).filter(([name]) => name !== key),
  );
}

/** A complete screen scenario: a title, both expected results and a run; a video also names its tab. */
function screenScenario(
  capture: 'video' | 'screenshot',
): Record<string, unknown> {
  return {
    id: 'S1',
    capture,
    title: 'Save an item',
    expected: { before: 'The old label shows', after: 'The new label shows' },
    run: noop,
    ...(capture === 'video' ? { tab: 'A' } : {}),
  };
}

describe('parseScenario', () => {
  test('accepts a valid scenario object and returns it unchanged', () => {
    const scenario = screenScenario('video');
    assert.equal(parseScenario(scenario, 'a.ts', FIX), scenario);
  });

  test('refuses a non-object export, naming the file', () => {
    for (const exported of [null, 'S1', 3]) {
      refusal(
        () => parseScenario(exported, 'scenarios/a.ts', FIX),
        /scenarios\/a\.ts/,
      );
    }
  });

  test('refuses an id that is empty or contains a separator or a dot, naming the file', () => {
    for (const id of ['', 'a/b', 'a.b']) {
      refusal(
        () =>
          parseScenario(
            { id, capture: 'none', run: noop },
            'scenarios/a.ts',
            FIX,
          ),
        /scenarios\/a\.ts: id must be/,
      );
    }
  });

  test('refuses an unknown or missing capture, naming the file', () => {
    refusal(
      () =>
        parseScenario(
          { id: 'S1', capture: 'film', run: noop },
          'scenarios/a.ts',
          FIX,
        ),
      /scenarios\/a\.ts: capture must be one of/,
    );
    refusal(
      () => parseScenario({ id: 'S1', run: noop }, 'scenarios/a.ts', FIX),
      /scenarios\/a\.ts: capture must be one of/,
    );
  });

  test('refuses a run that is not a function, naming the file', () => {
    refusal(
      () =>
        parseScenario(
          { id: 'S1', capture: 'none', run: 'nope' },
          'scenarios/a.ts',
          FIX,
        ),
      /scenarios\/a\.ts: run must be a function/,
    );
  });
});

describe('parseScenario: the screen-scenario contract', () => {
  test('refuses a video or screenshot scenario whose title is absent or blank, naming the file', () => {
    for (const capture of ['video', 'screenshot'] as const) {
      for (const fixture of [
        omit(screenScenario(capture), 'title'),
        { ...screenScenario(capture), title: '   ' },
      ]) {
        refusal(
          () => parseScenario(fixture, 'scenarios/a.ts', FIX),
          /scenarios\/a\.ts: a \w+ scenario must declare title/,
        );
      }
    }
  });

  test('refuses a screen scenario whose expected is absent, null or not an object, naming the file', () => {
    for (const fixture of [
      omit(screenScenario('video'), 'expected'),
      { ...screenScenario('screenshot'), expected: null },
      { ...screenScenario('screenshot'), expected: 'The label shows' },
    ]) {
      refusal(
        () => parseScenario(fixture, 'scenarios/a.ts', FIX),
        /scenarios\/a\.ts: a \w+ scenario must declare expected/,
      );
    }
  });

  test('refuses a screen scenario whose expected.after is absent or blank, naming the file', () => {
    const before = { before: 'The old label shows' };
    for (const expected of [
      before,
      { ...before, after: '' },
      { ...before, after: '   ' },
    ]) {
      refusal(
        () =>
          parseScenario(
            { ...screenScenario('video'), expected },
            'scenarios/a.ts',
            FIX,
          ),
        /scenarios\/a\.ts: a video scenario must declare expected\.after/,
      );
    }
  });

  test('refuses a screen scenario run on Before that lacks expected.before, naming the file', () => {
    const after = { after: 'The new label shows' };
    for (const expected of [after, { ...after, before: '' }]) {
      refusal(
        () =>
          parseScenario(
            { ...screenScenario('screenshot'), expected },
            'scenarios/a.ts',
            FIX,
          ),
        /scenarios\/a\.ts: a screenshot scenario run on Before must declare expected\.before/,
      );
    }
  });

  test('accepts a screen scenario served After alone without expected.before', () => {
    const scenario = {
      ...screenScenario('video'),
      expected: { after: 'The new label shows' },
    };
    assert.equal(parseScenario(scenario, 'a.ts', FEATURE), scenario);
  });

  test('refuses an expected.before that is given but not text, even on a feature run', () => {
    for (const before of [3, '', null]) {
      refusal(
        () =>
          parseScenario(
            {
              ...screenScenario('video'),
              expected: { before, after: 'The new label shows' },
            },
            'scenarios/a.ts',
            FEATURE,
          ),
        /scenarios\/a\.ts: expected\.before must be text when it is given/,
      );
    }
  });

  test('a transcript or none scenario needs no title or expected, under either run order', () => {
    for (const capture of ['transcript', 'none'] as const) {
      for (const options of [FIX, FEATURE]) {
        const scenario = { id: 'S1', capture, run: noop };
        assert.equal(parseScenario(scenario, 'a.ts', options), scenario);
      }
    }
  });

  test('a complete screen scenario is returned unchanged under either run order', () => {
    for (const capture of ['video', 'screenshot'] as const) {
      for (const options of [FIX, FEATURE]) {
        const scenario = screenScenario(capture);
        assert.equal(parseScenario(scenario, 'a.ts', options), scenario);
      }
    }
  });
});

describe('parseScenario: the video tab', () => {
  test('refuses a video scenario whose tab is absent, blank or not text, naming the file', () => {
    for (const fixture of [
      omit(screenScenario('video'), 'tab'),
      { ...screenScenario('video'), tab: '' },
      { ...screenScenario('video'), tab: '   ' },
      { ...screenScenario('video'), tab: 3 },
    ]) {
      refusal(
        () => parseScenario(fixture, 'scenarios/a.ts', FIX),
        /scenarios\/a\.ts: a video scenario must declare tab/,
      );
    }
  });

  test('a screenshot, transcript or none scenario needs no tab', () => {
    const scenarios: Record<string, unknown>[] = [
      screenScenario('screenshot'),
      { id: 'S1', capture: 'transcript', run: noop },
      { id: 'S1', capture: 'none', run: noop },
    ];
    for (const scenario of scenarios) {
      assert.equal(parseScenario(scenario, 'a.ts', FIX), scenario);
    }
  });
});

describe('isVideoScenario', () => {
  test('is true only for a video capture', () => {
    const video: Scenario = { id: 'S1', capture: 'video', tab: 'A', run: noop };
    const screenshot: Scenario = { id: 'S1', capture: 'screenshot', run: noop };
    assert.equal(isVideoScenario(video), true);
    assert.equal(isVideoScenario(screenshot), false);
  });
});

describe('isScreenScenario and SCREEN_CAPTURE', () => {
  test('isScreenScenario is true for video and screenshot, false for transcript and none', () => {
    for (const capture of ['video', 'screenshot'] as const) {
      const scenario: Scenario = { id: 'S1', capture, run: noop };
      assert.equal(isScreenScenario(scenario), true, capture);
    }
    for (const capture of ['transcript', 'none'] as const) {
      const scenario: Scenario = { id: 'S1', capture, run: noop };
      assert.equal(isScreenScenario(scenario), false, capture);
    }
  });

  test('SCREEN_CAPTURE says which captures have a screen', () => {
    assert.deepEqual(SCREEN_CAPTURE, {
      video: true,
      screenshot: true,
      transcript: false,
      none: false,
    });
  });
});

describe('stepNumber', () => {
  test('pads a step number to two digits, and leaves three or more digits as they are', () => {
    assert.equal(stepNumber(3), '03');
    assert.equal(stepNumber(12), '12');
    assert.equal(stepNumber(120), '120');
  });
});

describe('checkScenarioIds', () => {
  test('refuses an empty list of scenarios', () => {
    refusal(() => checkScenarioIds([]), /no scenario scripts/);
  });

  test('refuses two scripts with the same id', () => {
    const twice: Scenario[] = [
      { id: 'S1', capture: 'none', run: noop },
      { id: 'S1', capture: 'video', run: noop },
    ];
    refusal(() => checkScenarioIds(twice), /scenario id "S1" is used twice/);
  });
});

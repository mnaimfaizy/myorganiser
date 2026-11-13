// Contracts for the scenario runner's pure rules (ADR 0147 decisions 1-4 and 7),
// exercised through the public exports of qa-run.ts. Nothing here touches disk,
// a process or a browser. The scenario contract itself (parseScenario and
// checkScenarioIds) is qa-scenario.test.ts. The steps that do are tested in
// qa-run-executor.test.ts, through runQaRun with a stubbed RunDeps.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type GradingReport, SCENARIO_RESULTS } from './grade-scenarios.ts';
import {
  FFMPEG_CAPTURE,
  type FilePlace,
  type KeptPlace,
  type RecordedCall,
  type Recording,
  type RunArgs,
  type RunOutcome,
  type ScenarioRecord,
  STACK_LEFT_UP,
  buildManifest,
  combineArgs,
  combinedFiles,
  gradingInput,
  keptPath,
  keptRecordings,
  manifestFile,
  needsFfmpeg,
  parseOptions,
  parseRunArgs,
  rerunOnMergeBase,
  stackStartArgs,
  stepRecordsPath,
  stepStillDir,
  stepStillPath,
  storyboardPath,
  transcriptInput,
} from './qa-run.ts';
import { type Capture, RunInputError } from './qa-scenario.ts';

const REPO = '/repo';
const WT = '/wt';
const OUT = '/repo/tmp/qa/pr-1/out';
const SCENARIOS = '/repo/tmp/qa/pr-1/scenarios';
const MERGE_BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

/** A refusal is a RunInputError whose message matches `message`. */
function refusal(fn: () => unknown, message: RegExp): void {
  assert.throws(
    fn,
    (error: unknown) =>
      error instanceof RunInputError && message.test(error.message),
  );
}

function argvWith(
  changeKind: string,
  scenarios: string,
  out: string,
  ...extra: string[]
): string[] {
  return [
    '--worktree',
    WT,
    '--change-kind',
    changeKind,
    '--merge-base',
    MERGE_BASE,
    '--head',
    HEAD,
    '--scenarios',
    scenarios,
    '--out',
    out,
    ...extra,
  ];
}

function argvFor(changeKind: string, ...extra: string[]): string[] {
  return argvWith(changeKind, SCENARIOS, OUT, ...extra);
}

const RUN_ARGS: RunArgs = {
  worktree: WT,
  changeKind: 'fix',
  mergeBase: MERGE_BASE,
  head: HEAD,
  withBefore: false,
  scenarios: SCENARIOS,
  out: OUT,
};

describe('keptRecordings: the capture-keeping policy', () => {
  // Every capture x outcome cell, as ADR 0147 decision 4 and KEEP state it.
  const KEPT_CELLS: readonly [
    Capture,
    RunOutcome,
    Partial<Record<Recording, KeptPlace>>,
  ][] = [
    ['video', 'pass', { video: 'side' }],
    ['video', 'fail', { video: 'side' }],
    ['video', 'cannot-run', { video: 'side' }],
    ['screenshot', 'pass', { screenshot: 'side' }],
    ['screenshot', 'fail', { screenshot: 'side', video: 'local' }],
    ['screenshot', 'cannot-run', { screenshot: 'side' }],
    ['transcript', 'pass', { calls: 'side' }],
    ['transcript', 'fail', { calls: 'side', video: 'local' }],
    ['transcript', 'cannot-run', { calls: 'side' }],
    ['none', 'pass', {}],
    ['none', 'fail', { video: 'local' }],
    ['none', 'cannot-run', {}],
  ];

  for (const [capture, outcome, kept] of KEPT_CELLS) {
    test(`${capture} on ${outcome} keeps ${JSON.stringify(kept)}`, () => {
      assert.deepEqual(keptRecordings(capture, outcome), kept);
    });
  }

  test('a failed run always keeps its video: side for a video capture, local otherwise', () => {
    for (const capture of [
      'video',
      'screenshot',
      'transcript',
      'none',
    ] as const) {
      assert.equal(
        keptRecordings(capture, 'fail').video,
        capture === 'video' ? 'side' : 'local',
      );
    }
  });
});

describe('keptPath', () => {
  test('a side file sits under <out>/<side>/<id>.<ext>', () => {
    assert.equal(
      keptPath(OUT, 'S1', 'before', 'video', 'side'),
      `${OUT}/before/S1.webm`,
    );
    assert.equal(
      keptPath(OUT, 'S1', 'after', 'screenshot', 'side'),
      `${OUT}/after/S1.png`,
    );
  });

  test('a local file sits under <out>/local/<id>-<side>.webm', () => {
    assert.equal(
      keptPath(OUT, 'S1', 'before', 'video', 'local'),
      `${OUT}/local/S1-before.webm`,
    );
  });
});

describe('needsFfmpeg', () => {
  test('is true when some scenario keeps a video, even mixed with none', () => {
    assert.equal(needsFfmpeg([{ capture: 'video' }]), true);
    assert.equal(
      needsFfmpeg([{ capture: 'none' }, { capture: 'video' }]),
      true,
    );
  });

  test('is false for a screenshot, since its Storyboard is rendered in Chromium', () => {
    assert.equal(needsFfmpeg([{ capture: 'screenshot' }]), false);
    assert.equal(
      needsFfmpeg([{ capture: 'none' }, { capture: 'screenshot' }]),
      false,
    );
  });

  test('is false for transcript and none only, and for no scenario', () => {
    assert.equal(
      needsFfmpeg([{ capture: 'transcript' }, { capture: 'none' }]),
      false,
    );
    assert.equal(needsFfmpeg([]), false);
  });
});

describe('parseRunArgs', () => {
  test('accepts a fix and a feature under tmp/qa/', () => {
    assert.deepEqual(parseRunArgs(argvFor('fix'), REPO), {
      worktree: WT,
      changeKind: 'fix',
      mergeBase: MERGE_BASE,
      head: HEAD,
      withBefore: false,
      scenarios: SCENARIOS,
      out: OUT,
    });
    const feature = parseRunArgs(argvFor('feature', '--with-before'), REPO);
    assert.equal(feature.changeKind, 'feature');
    assert.equal(feature.withBefore, true);
  });

  test('refuses a missing required flag', () => {
    const withoutHead = [
      '--worktree',
      WT,
      '--change-kind',
      'fix',
      '--merge-base',
      MERGE_BASE,
      '--scenarios',
      SCENARIOS,
      '--out',
      OUT,
    ];
    refusal(() => parseRunArgs(withoutHead, REPO), /--head is required/);
  });

  test('refuses an unknown flag', () => {
    refusal(
      () => parseRunArgs(argvFor('fix', '--bogus'), REPO),
      /unknown argument "--bogus"/,
    );
  });

  test('refuses a change kind that is neither fix nor feature', () => {
    refusal(
      () => parseRunArgs(argvFor('hotfix'), REPO),
      /--change-kind must be fix or feature/,
    );
  });

  test('refuses --with-before on a fix, which always runs Before', () => {
    refusal(
      () => parseRunArgs(argvFor('fix', '--with-before'), REPO),
      /--with-before is for a feature/,
    );
  });

  test('refuses --scenarios or --out outside tmp/qa/, including tmp/qa itself and a traversal out of it', () => {
    for (const path of ['tmp/qa', 'tmp/qa/../x', 'tmp/qa-other', 'src/x']) {
      refusal(
        () => parseRunArgs(argvWith('fix', path, OUT), REPO),
        /--scenarios must be a directory under tmp\/qa\//,
      );
      refusal(
        () => parseRunArgs(argvWith('fix', SCENARIOS, path), REPO),
        /--out must be a directory under tmp\/qa\//,
      );
    }
  });
});

describe('stackStartArgs', () => {
  const START = [
    'start',
    '--worktree',
    WT,
    '--change-kind',
    'fix',
    '--merge-base',
    MERGE_BASE,
    '--head',
    HEAD,
  ];

  test('a plain start carries neither --before-only nor --with-before', () => {
    assert.deepEqual(stackStartArgs(RUN_ARGS, false), START);
  });

  test('--before-only is added only for the merge-base re-run', () => {
    assert.deepEqual(stackStartArgs(RUN_ARGS, true), [
      ...START,
      '--before-only',
    ]);
  });

  test('--with-before is added only when the feature claims Before still works', () => {
    const feature = { ...RUN_ARGS, changeKind: 'feature' as const };
    const featureStart = START.map((arg) => (arg === 'fix' ? 'feature' : arg));
    assert.deepEqual(stackStartArgs({ ...feature, withBefore: true }, false), [
      ...featureStart,
      '--with-before',
    ]);
    assert.deepEqual(stackStartArgs(feature, false), featureStart);
  });
});

describe('rerunOnMergeBase', () => {
  const AFTER = new Map<string, RunOutcome>([
    ['A', 'pass'],
    ['B', 'fail'],
    ['C', 'cannot-run'],
    ['D', 'fail'],
  ]);

  test('a feature that served After alone re-runs only the scenarios that failed After', () => {
    assert.deepEqual(rerunOnMergeBase(['after'], AFTER), ['B', 'D']);
  });

  test('a run that already served Before re-runs nothing, even with failures', () => {
    assert.deepEqual(rerunOnMergeBase(['before', 'after'], AFTER), []);
  });
});

describe('gradingInput', () => {
  test('a scenario that never ran on Before grades its Before as not-run', () => {
    assert.deepEqual(
      gradingInput('feature', ['A'], {
        before: new Map<string, RunOutcome>(),
        after: new Map<string, RunOutcome>([['A', 'pass']]),
      }),
      {
        changeKind: 'feature',
        scenarios: [{ id: 'A', before: 'not-run', after: 'pass' }],
      },
    );
  });

  test('a scenario with no After outcome is refused', () => {
    refusal(
      () =>
        gradingInput('feature', ['A'], {
          before: new Map<string, RunOutcome>(),
          after: new Map<string, RunOutcome>(),
        }),
      /scenario "A" has no After outcome/,
    );
  });
});

describe('combineArgs', () => {
  test('combines the kept Before and After files into <out>/combined/<id>', () => {
    assert.deepEqual(
      combineArgs(OUT, 'S1', `${OUT}/before/S1.png`, `${OUT}/after/S1.png`),
      [
        '--before',
        `${OUT}/before/S1.png`,
        '--after',
        `${OUT}/after/S1.png`,
        '--out',
        `${OUT}/combined/S1`,
      ],
    );
  });
});

describe('transcriptInput', () => {
  test('lists the Before calls before the After calls, each tagged with its side', () => {
    const before: RecordedCall = {
      request: { method: 'GET', path: '/api/v1/items' },
      response: { status: 200 },
    };
    const after: RecordedCall = {
      request: { method: 'POST', path: '/api/v1/items' },
      response: { status: 201 },
    };
    const input = transcriptInput('S1', { after: [after], before: [before] });
    assert.deepEqual(input, {
      scenarios: [
        {
          id: 'S1',
          calls: [
            { side: 'before', ...before },
            { side: 'after', ...after },
          ],
        },
      ],
    });
  });
});

describe('manifestFile: upload eligibility', () => {
  test('only a combined file may be offered, and a FAIL: regression never is', () => {
    for (const result of SCENARIO_RESULTS) {
      assert.equal(
        manifestFile('/p', 'combined', result).uploadEligible,
        result !== 'FAIL: regression',
        `combined file for ${result}`,
      );
    }
  });

  test('a before, after, local or transcript file is never eligible, for any result', () => {
    const places: FilePlace[] = ['before', 'after', 'local', 'transcript'];
    for (const result of SCENARIO_RESULTS) {
      for (const place of places) {
        assert.equal(
          manifestFile('/p', place, result).uploadEligible,
          false,
          `${place} file for ${result}`,
        );
      }
    }
  });

  test('a manifest file records its path and place, with the eligibility decided', () => {
    assert.deepEqual(manifestFile('/o/combined/S1.png', 'combined', 'PASS'), {
      path: '/o/combined/S1.png',
      place: 'combined',
      uploadEligible: true,
    });
  });
});

describe('buildManifest', () => {
  const RECORD = (files: ScenarioRecord['files']): ScenarioRecord => ({
    id: 'S1',
    capture: 'screenshot',
    runs: {
      before: { outcome: 'pass' },
      after: { outcome: 'fail', message: 'the button is missing' },
    },
    files,
    problems: [],
  });

  test('a regression keeps its combined file and its local video out of upload', () => {
    const report: GradingReport = {
      headline: 'QA failed',
      scenarios: [
        { id: 'S1', result: 'FAIL: regression', maintainerDecision: false },
      ],
    };
    const manifest = buildManifest(
      { changeKind: 'fix', mergeBase: MERGE_BASE, head: HEAD },
      report,
      [
        RECORD([
          { path: `${OUT}/combined/S1.png`, place: 'combined' },
          { path: `${OUT}/local/S1-after.webm`, place: 'local' },
        ]),
      ],
    );
    assert.deepEqual(manifest.scenarios[0].files, [
      {
        path: `${OUT}/combined/S1.png`,
        place: 'combined',
        uploadEligible: false,
      },
      {
        path: `${OUT}/local/S1-after.webm`,
        place: 'local',
        uploadEligible: false,
      },
    ]);
  });

  test('a PASS offers its combined file and withholds its before file', () => {
    const report: GradingReport = {
      headline: 'QA passed',
      scenarios: [{ id: 'S1', result: 'PASS', maintainerDecision: false }],
    };
    const manifest = buildManifest(
      { changeKind: 'fix', mergeBase: MERGE_BASE, head: HEAD },
      report,
      [
        RECORD([
          { path: `${OUT}/combined/S1.png`, place: 'combined' },
          { path: `${OUT}/before/S1.png`, place: 'before' },
        ]),
      ],
    );
    assert.deepEqual(
      manifest.scenarios[0].files.map(({ place, uploadEligible }) => [
        place,
        uploadEligible,
      ]),
      [
        ['combined', true],
        ['before', false],
      ],
    );
  });

  test('a scenario the report grades but no record covers is refused', () => {
    refusal(
      () =>
        buildManifest(
          { changeKind: 'fix', mergeBase: MERGE_BASE, head: HEAD },
          {
            headline: 'QA passed',
            scenarios: [
              { id: 'S1', result: 'PASS', maintainerDecision: false },
            ],
          },
          [],
        ),
      /scenario "S1" has no record/,
    );
  });

  test('the manifest names the stack command that leaves the QA stack up for judgement', () => {
    const manifest = buildManifest(
      { changeKind: 'fix', mergeBase: MERGE_BASE, head: HEAD },
      { headline: 'QA passed', scenarios: [] },
      [],
    );
    assert.equal(manifest.stack, STACK_LEFT_UP);
    assert.match(manifest.stack, /yarn qa:stack:stop/);
  });
});

describe('combinedFiles: the files qa:combine reports making', () => {
  test('an image combine reports only the combined image', () => {
    assert.deepEqual(
      combinedFiles(
        '{"kind":"image","combined":"/o/c/S.png","gif":null,"gifBytes":null}',
      ),
      ['/o/c/S.png'],
    );
  });

  test('a video combine reports the MP4 then the GIF preview, in that order', () => {
    assert.deepEqual(
      combinedFiles(
        '{"kind":"video","combined":"/o/c/V.mp4","gif":"/o/c/V.gif","gifBytes":1024}',
      ),
      ['/o/c/V.mp4', '/o/c/V.gif'],
    );
  });

  test('JSON with no string combined field is refused', () => {
    assert.throws(
      () => combinedFiles('{"kind":"image","gif":null}'),
      /printed no combined file/,
    );
    assert.throws(
      () => combinedFiles('{"kind":"image","combined":42,"gif":null}'),
      /printed no combined file/,
    );
  });

  test('output that is not JSON is refused', () => {
    assert.throws(() => combinedFiles('ffmpeg: not found'), SyntaxError);
  });
});

describe('FFMPEG_CAPTURE: which captures need ffmpeg', () => {
  test('only a video capture is combined with ffmpeg', () => {
    assert.deepEqual(FFMPEG_CAPTURE, {
      video: true,
      screenshot: false,
      transcript: false,
      none: false,
    });
  });
});

describe('parseOptions: the scenario check follows the run order', () => {
  test('a fix always plays Before, so its scenarios must declare expected.before', () => {
    assert.deepEqual(parseOptions({ changeKind: 'fix', withBefore: false }), {
      runsBefore: true,
    });
  });

  test('a feature runs Before only with --with-before', () => {
    assert.deepEqual(
      parseOptions({ changeKind: 'feature', withBefore: true }),
      { runsBefore: true },
    );
    assert.deepEqual(
      parseOptions({ changeKind: 'feature', withBefore: false }),
      { runsBefore: false },
    );
  });
});

describe('step and Storyboard paths', () => {
  test('a side keeps its step stills in steps/<id>/<side>, relative to --out', () => {
    assert.equal(stepStillDir('S1', 'before'), 'steps/S1/before');
  });

  test('a step still is kept relative to --out, under steps/<id>/<side>/, zero-padded to two digits', () => {
    assert.equal(stepStillPath('S1', 'before', 3), 'steps/S1/before/03.png');
    assert.equal(stepStillPath('S1', 'after', 12), 'steps/S1/after/12.png');
  });

  test('the step records of a scenario are saved to <out>/steps/<id>.json', () => {
    assert.equal(stepRecordsPath(OUT, 'S1'), `${OUT}/steps/S1.json`);
  });

  test('the Storyboard of a scenario is made at <out>/combined/<id>.png', () => {
    assert.equal(storyboardPath(OUT, 'S1'), `${OUT}/combined/S1.png`);
  });
});

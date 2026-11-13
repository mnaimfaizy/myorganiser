// Contracts for the pure combine rules (ADR 0147 decision 5; PRD #1544's
// annotated MP4; PRD #1550's re-render): reading a scenario's saved step
// records and graded result, the caption windows of a `Capture: video` side,
// and the ffmpeg arguments of its annotated MP4. Everything here is a pure
// function, so no process and no file is touched; the executor is in
// qa-combine-executor.test.ts, the overlay pages the MP4 reads are in
// video-overlay-html.test.ts, and the real renders are in their own suites.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  type AnnotatedVideoPlan,
  type CaptionWindow,
  type VideoOverlayFiles,
  type VideoSide,
  type VideoStep,
  buildAnnotatedVideoArgs,
  captionWindows,
  enableExpression,
  parseStepRecords,
  resultOf,
} from './qa-combine.ts';
import type { Band } from './storyboard.ts';

/** The value following each `-i`, in argument order. */
function inputsOf(args: readonly string[]): string[] {
  return args.flatMap((arg, i) => (arg === '-i' ? [args[i + 1]] : []));
}

function valueAfter(args: readonly string[], flag: string): string {
  const at = args.indexOf(flag);
  assert.notEqual(at, -1, `missing ${flag}`);
  return args[at + 1];
}

/** A step taken on `device`'s `tab`, `atMs` from the run's start. */
function stepAt(
  index: number,
  atMs: number,
  device = 'A',
  tab = 'A',
): VideoStep {
  return {
    index,
    caption: `step ${index}`,
    atMs,
    device,
    tab,
    label: `Device ${device} · tab ${tab}`,
  };
}

/** A side that records the default tab from `openedAtMs`, with `steps`. */
function sideOf(
  name: 'before' | 'after',
  openedAtMs: number,
  steps: VideoStep[],
): VideoSide {
  return {
    side: name,
    video: `/work/${name}.webm`,
    device: 'A',
    tab: 'A',
    label: 'Device A',
    openedAtMs,
    steps,
  };
}

/** A window as its step's index (null for the opening strip), for comparison. */
function windowOf(window: CaptionWindow) {
  return {
    step: window.step?.index ?? null,
    start: window.start,
    end: window.end,
  };
}

const BAND: Band = {
  id: 'S1',
  title: 'Save an item',
  result: 'PASS',
  commits: { before: 'abc1234', after: 'def5678' },
};

/** Before has three windows (opening, two steps); After has two (opening, one step). */
const PLAN: AnnotatedVideoPlan = {
  band: BAND,
  sides: [
    sideOf('before', 0, [stepAt(1, 1500), stepAt(2, 4000)]),
    sideOf('after', 2000, [stepAt(1, 2500)]),
  ],
  output: '/out/combined/S1.mp4',
};

const OVERLAYS: VideoOverlayFiles = {
  band: '/o/band.png',
  sides: [
    {
      label: '/o/before-label.png',
      strips: ['/o/before-0.png', '/o/before-1.png', '/o/before-2.png'],
    },
    {
      label: '/o/after-label.png',
      strips: ['/o/after-0.png', '/o/after-1.png'],
    },
  ],
};

const RECORDS_FILE = '/run/steps/S.json';

/** One step as `qa:run` saves it, still relative to the run folder. */
function savedStep(side: 'before' | 'after') {
  return {
    side,
    index: 1,
    device: 'A',
    tab: 'A',
    label: 'Device A',
    caption: 'open the form',
    still: `steps/S/${side}/01.png`,
    subject: null,
    atMs: 0,
  };
}

/** A screen scenario's step-records file, as `qa:run` writes it. */
function recordsJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'S',
    capture: 'screenshot',
    title: 'Save an item',
    expected: { before: 'the defect shows', after: 'the fix shows' },
    commits: { before: 'abc1234', after: 'def5678' },
    sides: {
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [savedStep('before')],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [savedStep('after')],
      },
    },
    ...overrides,
  });
}

/** Parses `text` as the records of scenario S, from `RECORDS_FILE`. */
const parse = (text: string) => parseStepRecords(text, 'S', RECORDS_FILE);

describe('parseStepRecords: a clean file is read', () => {
  test('a screen scenario file is returned with its title, commits, expected results and steps', () => {
    const records = parse(recordsJson());
    assert.equal(records.id, 'S');
    assert.equal(records.capture, 'screenshot');
    assert.equal(records.title, 'Save an item');
    assert.deepEqual(records.expected, {
      before: 'the defect shows',
      after: 'the fix shows',
    });
    assert.deepEqual(records.commits, { before: 'abc1234', after: 'def5678' });
    assert.equal(records.sides.before?.steps[0].still, 'steps/S/before/01.png');
    assert.equal(records.refused, undefined);
    assert.equal(records.video, undefined);
  });

  test('a video file keeps its video block, which holds no recording path', () => {
    const records = parse(
      recordsJson({
        capture: 'video',
        video: {
          tab: 'B1',
          sides: {
            before: {
              device: 'B',
              tab: 'B1',
              label: 'Device B · tab B1',
              openedAtMs: 1200,
            },
          },
        },
      }),
    );
    assert.deepEqual(records.video, {
      tab: 'B1',
      sides: {
        before: {
          device: 'B',
          tab: 'B1',
          label: 'Device B · tab B1',
          openedAtMs: 1200,
        },
      },
    });
  });

  test('a side that did not run is absent and is not a problem', () => {
    const records = parse(
      recordsJson({
        sides: { after: { outcome: 'pass', steps: [savedStep('after')] } },
      }),
    );
    assert.equal(records.sides.before, undefined);
    assert.equal(records.sides.after?.outcome, 'pass');
  });

  test('a refused list of field names is kept, so the caller can refuse the file', () => {
    const records = parse(recordsJson({ refused: ['S after step 1 caption'] }));
    assert.deepEqual(records.refused, ['S after step 1 caption']);
  });
});

describe('parseStepRecords: a file that is not a step-records file is refused', () => {
  const refuses = (text: string, reason: string) =>
    assert.throws(() => parse(text), {
      name: 'CombineInputError',
      message: `${RECORDS_FILE} is not a step-records file: ${reason}`,
    });

  test('text that is not JSON', () => {
    refuses('{"id": ', 'it is not JSON');
  });

  test('JSON that is not an object (an array, null)', () => {
    refuses('[]', 'it is not an object');
    refuses('null', 'it is not an object');
  });

  test("another scenario's file", () => {
    refuses(recordsJson({ id: 'T' }), 'it is not scenario "S"');
  });

  test('a capture that is neither screenshot nor video', () => {
    refuses(
      recordsJson({ capture: 'transcript' }),
      'its capture is not screenshot or video',
    );
  });

  test('no title', () => {
    refuses(recordsJson({ title: 3 }), 'no title');
  });

  test('no expected.after, or an expected.before that is not text', () => {
    refuses(recordsJson({ expected: { before: 'x' } }), 'no expected.after');
    refuses(
      recordsJson({ expected: { after: 'x', before: 3 } }),
      'expected.before is not text',
    );
  });

  test('commits that do not name both sides', () => {
    refuses(recordsJson({ commits: { before: 'abc1234' } }), 'no commits');
  });

  test('refused that is not a list of names', () => {
    refuses(
      recordsJson({ refused: 'S after step 1 caption' }),
      'refused is not a list',
    );
  });

  test('no sides object', () => {
    refuses(recordsJson({ sides: undefined }), 'no sides');
  });

  test('a side with no outcome or no steps list', () => {
    refuses(
      recordsJson({ sides: { before: { steps: [] } } }),
      'before has no outcome and steps',
    );
  });

  test('a step missing a field it is drawn with', () => {
    refuses(
      recordsJson({
        sides: {
          before: {
            outcome: 'fail',
            steps: [{ ...savedStep('before'), caption: undefined }],
          },
        },
      }),
      'before has a malformed step',
    );
  });

  test('a still that leaves the run folder, by a leading absolute path or by a parent segment', () => {
    for (const still of [
      '/etc/01.png',
      '../01.png',
      'steps/S/../../../01.png',
    ]) {
      refuses(
        recordsJson({
          sides: {
            before: {
              outcome: 'fail',
              steps: [{ ...savedStep('before'), still }],
            },
          },
        }),
        'before step 1 names a still outside the run',
      );
    }
  });

  test('a video block whose tab is missing', () => {
    refuses(
      recordsJson({
        capture: 'video',
        video: { sides: {} },
      }),
      'its video block is malformed',
    );
  });

  test('a video block that is not an object', () => {
    refuses(
      recordsJson({ capture: 'video', video: 'B1' }),
      'its video block is malformed',
    );
  });

  test('a video side whose device, tab or openedAtMs is the wrong type', () => {
    const side = { device: 'A', tab: 'A', label: 'Device A', openedAtMs: 0 };
    for (const wrong of [{ device: 3 }, { tab: null }, { openedAtMs: '0' }]) {
      refuses(
        recordsJson({
          capture: 'video',
          video: { tab: 'A', sides: { before: { ...side, ...wrong } } },
        }),
        'its video block is malformed',
      );
    }
  });

  test('a video side that lacks its label', () => {
    refuses(
      recordsJson({
        capture: 'video',
        video: {
          tab: 'A',
          sides: {
            before: { device: 'A', tab: 'A', openedAtMs: 0 },
          },
        },
      }),
      'its video block is malformed',
    );
  });
});

describe('resultOf: the graded result of one scenario in the run manifest', () => {
  const manifest = (scenarios: unknown) =>
    JSON.stringify({ scenarios, headline: 'QA passed' });

  test('the result of the scenario named, of each scenario in turn', () => {
    const text = manifest([
      { id: 'S', result: 'PASS' },
      { id: 'T', result: 'FAIL: regression' },
    ]);
    assert.equal(resultOf(text, 'S'), 'PASS');
    assert.equal(resultOf(text, 'T'), 'FAIL: regression');
  });

  test('null for a scenario the manifest does not name', () => {
    assert.equal(resultOf(manifest([{ id: 'T', result: 'PASS' }]), 'S'), null);
  });

  test('null for a result that is text but not a known scenario result', () => {
    assert.equal(
      resultOf(manifest([{ id: 'S', result: 'pass' }]), 'S'),
      null,
      'the result is matched exactly',
    );
    assert.equal(
      resultOf(manifest([{ id: 'S', result: 'PASS; drop table' }]), 'S'),
      null,
    );
  });

  test('null for an entry whose result is not text', () => {
    assert.equal(resultOf(manifest([{ id: 'S' }]), 'S'), null);
    assert.equal(resultOf(manifest([{ id: 'S', result: 1 }]), 'S'), null);
  });

  test('null for a manifest that is not JSON, or has no scenarios list', () => {
    assert.equal(resultOf('{"scenarios": [', 'S'), null);
    assert.equal(
      resultOf(JSON.stringify({ headline: 'QA passed' }), 'S'),
      null,
    );
  });
});

describe('captionWindows', () => {
  test('the opening strip runs to the first step, each step runs to the next, and the last stays to the end', () => {
    const windows = captionWindows(
      sideOf('before', 0, [stepAt(1, 1500), stepAt(2, 4000)]),
    );
    assert.deepEqual(windows.map(windowOf), [
      { step: null, start: 0, end: 1.5 },
      { step: 1, start: 1.5, end: 4 },
      { step: 2, start: 4, end: null },
    ]);
  });

  test('a step taken before the tab opened clamps to 0, and the opening strip that would end at 0 is dropped', () => {
    const windows = captionWindows(
      sideOf('after', 1000, [stepAt(1, 400), stepAt(2, 2000)]),
    );
    assert.deepEqual(windows.map(windowOf), [
      { step: 1, start: 0, end: 1 },
      { step: 2, start: 1, end: null },
    ]);
  });

  test('a first step at the moment the recording starts drops the opening strip', () => {
    const windows = captionWindows(
      sideOf('before', 0, [stepAt(1, 0), stepAt(2, 3000)]),
    );
    assert.deepEqual(windows.map(windowOf), [
      { step: 1, start: 0, end: 3 },
      { step: 2, start: 3, end: null },
    ]);
  });

  test('of two steps at the same moment, the earlier one is dropped', () => {
    const windows = captionWindows(
      sideOf('before', 0, [stepAt(1, 2000), stepAt(2, 2000)]),
    );
    assert.deepEqual(windows.map(windowOf), [
      { step: null, start: 0, end: 2 },
      { step: 2, start: 2, end: null },
    ]);
  });

  test('a side with no steps shows the opening strip to the end', () => {
    assert.deepEqual(captionWindows(sideOf('before', 0, [])).map(windowOf), [
      { step: null, start: 0, end: null },
    ]);
  });
});

describe('enableExpression', () => {
  test('a bounded window is gte(t,S)*lt(t,E) and the open window is gte(t,S), in seconds to three decimals', () => {
    assert.equal(
      enableExpression({ step: null, start: 0, end: 1.5 }),
      'gte(t,0.000)*lt(t,1.500)',
    );
    assert.equal(
      enableExpression({ step: null, start: 4, end: null }),
      'gte(t,4.000)',
    );
  });
});

describe('buildAnnotatedVideoArgs', () => {
  test('the inputs are the recording of each side, then the band, then per side its label and its strips in window order', () => {
    const args = buildAnnotatedVideoArgs(PLAN, OVERLAYS);
    assert.deepEqual(inputsOf(args), [
      '/work/before.webm',
      '/work/after.webm',
      '/o/band.png',
      '/o/before-label.png',
      '/o/before-0.png',
      '/o/before-1.png',
      '/o/before-2.png',
      '/o/after-label.png',
      '/o/after-0.png',
      '/o/after-1.png',
    ]);
  });

  test('the graph fits, labels, times and stacks each side, then frames the stack under the band', () => {
    const filter = valueAfter(
      buildAnnotatedVideoArgs(PLAN, OVERLAYS),
      '-filter_complex',
    );
    assert.equal(
      filter,
      [
        '[0:v]fps=25,scale=1280:720,setsar=1[p0]',
        '[p0][3:v]overlay=0:0[l0]',
        '[l0]pad=1280:776:0:0[c0_0]',
        "[c0_0][4:v]overlay=0:720:enable='gte(t,0.000)*lt(t,1.500)'[c0_1]",
        "[c0_1][5:v]overlay=0:720:enable='gte(t,1.500)*lt(t,4.000)'[c0_2]",
        "[c0_2][6:v]overlay=0:720:enable='gte(t,4.000)'[c0_3]",
        '[1:v]fps=25,scale=1280:720,setsar=1[p1]',
        '[p1][7:v]overlay=0:0[l1]',
        '[l1]pad=1280:776:0:0[c1_0]',
        "[c1_0][8:v]overlay=0:720:enable='gte(t,0.000)*lt(t,0.500)'[c1_1]",
        "[c1_1][9:v]overlay=0:720:enable='gte(t,0.500)'[c1_2]",
        '[c0_3][c1_2]hstack=inputs=2[stack]',
        '[stack]pad=iw:ih+96:0:96[framed]',
        '[framed][2:v]overlay=0:0[v]',
      ].join(';'),
    );
  });

  test('the band is overlaid last with no enable, so it shows for the whole video', () => {
    const graph = valueAfter(
      buildAnnotatedVideoArgs(PLAN, OVERLAYS),
      '-filter_complex',
    ).split(';');
    const band = graph.at(-1) ?? '';
    assert.equal(band, '[framed][2:v]overlay=0:0[v]');
    assert.equal(band.includes('enable'), false);
  });

  test('a single side is not stacked: its panel goes straight to the band, which is then input 1', () => {
    const plan = { ...PLAN, sides: [PLAN.sides[0]] };
    const args = buildAnnotatedVideoArgs(plan, {
      band: OVERLAYS.band,
      sides: [OVERLAYS.sides[0]],
    });
    const graph = valueAfter(args, '-filter_complex').split(';');
    assert.ok(graph.includes('[c0_3]null[stack]'), graph.join('\n'));
    assert.equal(
      graph.some((chunk) => chunk.includes('hstack')),
      false,
    );
    assert.equal(graph.at(-1), '[framed][1:v]overlay=0:0[v]');
    assert.deepEqual(inputsOf(args), [
      '/work/before.webm',
      '/o/band.png',
      '/o/before-label.png',
      '/o/before-0.png',
      '/o/before-1.png',
      '/o/before-2.png',
    ]);
  });

  test('the output is H.264 in yuv420p with no audio, written to the plan output, and the graph never draws text', () => {
    for (const plan of [PLAN, { ...PLAN, sides: [PLAN.sides[0]] }]) {
      const args = buildAnnotatedVideoArgs(plan, {
        band: OVERLAYS.band,
        sides: plan.sides.map((_, s) => OVERLAYS.sides[s]),
      });
      assert.equal(valueAfter(args, '-map'), '[v]');
      assert.equal(valueAfter(args, '-c:v'), 'libx264');
      assert.equal(valueAfter(args, '-pix_fmt'), 'yuv420p');
      assert.equal(valueAfter(args, '-movflags'), '+faststart');
      assert.ok(args.includes('-an'));
      assert.equal(args.includes('-frames:v'), false);
      assert.equal(args.at(-1), PLAN.output);
      assert.equal(args.join(' ').includes('drawtext'), false);
    }
  });

  test('a plan with no side or with three sides is refused', () => {
    assert.throws(
      () =>
        buildAnnotatedVideoArgs(
          { ...PLAN, sides: [] },
          { band: OVERLAYS.band, sides: [] },
        ),
      /one or two sides/,
    );
    const threeSides = [PLAN.sides[0], PLAN.sides[1], PLAN.sides[0]];
    const threeOverlays = [
      OVERLAYS.sides[0],
      OVERLAYS.sides[1],
      OVERLAYS.sides[0],
    ];
    assert.throws(
      () =>
        buildAnnotatedVideoArgs(
          { ...PLAN, sides: threeSides },
          { band: OVERLAYS.band, sides: threeOverlays },
        ),
      /one or two sides/,
    );
  });

  test('overlays that do not match the sides, or the windows of a side, are refused', () => {
    assert.throws(
      () =>
        buildAnnotatedVideoArgs(PLAN, {
          band: OVERLAYS.band,
          sides: [OVERLAYS.sides[0]],
        }),
      /one set of overlays is needed per side/,
    );
    assert.throws(
      () =>
        buildAnnotatedVideoArgs(PLAN, {
          band: OVERLAYS.band,
          sides: [
            OVERLAYS.sides[0],
            { label: '/o/after-label.png', strips: ['/o/after-0.png'] },
          ],
        }),
      /after: one strip is needed per caption window/,
    );
  });
});

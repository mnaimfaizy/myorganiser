// Contracts for the pure combine rules (ADR 0147 decision 5; PRD #1544's
// annotated MP4; PRD #1550's re-render): reading a scenario's saved step
// records and graded result, the paced timeline of a `Capture: video` MP4 and
// the ffprobe reading that feeds it, and the ffmpeg arguments of that MP4.
// Everything here is a pure function, so no process and no file is touched;
// the executor is in qa-combine-executor.test.ts, the overlay pages the MP4
// reads are in video-overlay-html.test.ts, and the real renders are in their
// own suites.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  type AnnotatedVideoPlan,
  type CaptionWindow,
  type PacedPiece,
  type PacedSide,
  type VideoOverlayFiles,
  type VideoSide,
  type VideoStep,
  VIDEO_BAND_HEIGHT,
  VIDEO_FPS,
  VIDEO_PANEL,
  VIDEO_PLAYBACK_SPEED,
  VIDEO_STEP_HOLD_SECONDS,
  VIDEO_STRIP_HEIGHT,
  buildAnnotatedVideoArgs,
  durationFromPackets,
  enableExpression,
  pacedTimeline,
  parseStepRecords,
  probeDurationArgs,
  resultOf,
} from './qa-combine.ts';
import type { Band } from './storyboard.ts';

const EPS = 1e-6;
/** One frame of the paced MP4, in seconds. */
const FRAME = 1 / VIDEO_FPS;

/** The value following each `-i`, in argument order. */
function inputsOf(args: readonly string[]): string[] {
  return args.flatMap((arg, i) => (arg === '-i' ? [args[i + 1]] : []));
}

function valueAfter(args: readonly string[], flag: string): string {
  const at = args.indexOf(flag);
  assert.notEqual(at, -1, `missing ${flag}`);
  return args[at + 1];
}

/** Seconds to three decimals, as the ffmpeg arguments write them. */
const s3 = (seconds: number): string => seconds.toFixed(3);

/** A number to micro-seconds, so float sums compare as the plan means them. */
const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

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

/** A caption window with its times rounded, its step as its index (null for the opening strip). */
function roundWindow(window: CaptionWindow) {
  return {
    step: window.step?.index ?? null,
    start: round6(window.start),
    end: window.end === null ? null : round6(window.end),
  };
}

/** Pieces with their times rounded, for comparison. */
function roundPieces(pieces: readonly PacedPiece[]) {
  return pieces.map(({ kind, srcStart, srcEnd, outStart, outEnd }) => ({
    kind,
    srcStart: round6(srcStart),
    srcEnd: round6(srcEnd),
    outStart: round6(outStart),
    outEnd: round6(outEnd),
  }));
}

/** The hold that starts at `at` on one side; the test fails when there is none. */
function holdAt(side: PacedSide, at: number): PacedPiece {
  const hold = side.pieces.find(
    (piece) => piece.kind === 'hold' && Math.abs(piece.outStart - at) < EPS,
  );
  assert.ok(hold, `${side.side} holds from ${at}`);
  return hold;
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

/** Each side's recording length in seconds, in PLAN's order: Before is longer, so After holds its last frame. */
const PLAN_LENGTHS = [6, 3];

/** The paced timeline of each plan, with each side's recording length taken in plan order. */
function timelineOf(plan: AnnotatedVideoPlan) {
  return pacedTimeline(
    plan.sides,
    plan.sides.map((_, i) => PLAN_LENGTHS[i]),
  );
}

const PLAN_TIMELINE = timelineOf(PLAN);

/** PLAN's first hold: Before's 1.5 s lead, played at the playback speed. */
const FIRST_HOLD = 1.5 / VIDEO_PLAYBACK_SPEED;
/** PLAN's second hold: the first hold, its length, then the 2.5 s stretch between the steps (the same on both sides). */
const SECOND_HOLD =
  FIRST_HOLD + VIDEO_STEP_HOLD_SECONDS + 2.5 / VIDEO_PLAYBACK_SPEED;

/**
 * Both sides take two steps, Before's later. Between the steps Before has 2 s
 * and After 1 s, so After's middle stretch is held; in the tail Before has 1 s
 * and After 2 s, so Before's tail is held. Both recordings are 4 s.
 */
const UNEVEN: VideoSide[] = [
  sideOf('before', 0, [stepAt(1, 1000), stepAt(2, 3000)]),
  sideOf('after', 0, [stepAt(1, 1000), stepAt(2, 2000)]),
];
const UNEVEN_LENGTHS = [4, 4];

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

describe('parseStepRecords: a step marked checked', () => {
  const withChecked = (checked: unknown) =>
    recordsJson({
      sides: {
        before: {
          outcome: 'fail',
          message: 'the defect shows here',
          steps: [{ ...savedStep('before'), checked }],
        },
      },
    });

  test('a step marked checked: true is kept, and a step with no mark parses as before', () => {
    const records = parse(withChecked(true));
    assert.equal(records.sides.before?.steps[0].checked, true);
    assert.equal(
      parse(recordsJson()).sides.before?.steps[0].checked,
      undefined,
    );
  });

  test('a checked that is not exactly true is a malformed step', () => {
    for (const bad of [false, 'yes', 1]) {
      assert.throws(() => parse(withChecked(bad)), {
        name: 'CombineInputError',
        message: `${RECORDS_FILE} is not a step-records file: before has a malformed step`,
      });
    }
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

describe('pacedTimeline: each step holds on every side, from the same output time', () => {
  test('each step holds on its frame for the hold length on every side, and the holds start together', () => {
    const [before, after] = PLAN_TIMELINE.sides;
    const [firstHold, secondHold] = PLAN_TIMELINE.holdStarts;
    assert.equal(round6(firstHold), round6(FIRST_HOLD));
    assert.equal(round6(secondHold), round6(SECOND_HOLD));
    for (const side of PLAN_TIMELINE.sides) {
      for (const at of PLAN_TIMELINE.holdStarts) {
        const hold = holdAt(side, at);
        assert.equal(
          round6(hold.outEnd - hold.outStart),
          round6(VIDEO_STEP_HOLD_SECONDS),
          `${side.side} holds for the hold length`,
        );
      }
    }
    // Before's steps are at 1.5 s and 4 s; After's first at 0.5 s. After has no
    // second step, so it holds its last frame (3 s less a frame) for the second hold.
    assert.equal(round6(holdAt(before, firstHold).srcStart), 1.5);
    assert.equal(round6(holdAt(before, secondHold).srcStart), 4);
    assert.equal(round6(holdAt(after, firstHold).srcStart), 0.5);
    assert.equal(
      round6(holdAt(after, secondHold).srcStart),
      round6(PLAN_LENGTHS[1] - FRAME),
    );
  });

  test('steps are matched by position, and each stretch between them plays at the playback speed', () => {
    const [before] = PLAN_TIMELINE.sides;
    assert.deepEqual(
      before.pieces.map((piece) => piece.kind),
      ['play', 'hold', 'play', 'hold', 'play'],
    );
    const plays = before.pieces.filter((piece) => piece.kind === 'play');
    assert.deepEqual(
      plays.map((piece) => [round6(piece.srcStart), round6(piece.srcEnd)]),
      [
        [0, 1.5],
        [1.5, 4],
        [4, 6],
      ],
    );
    for (const play of plays) {
      assert.equal(
        round6(play.outEnd - play.outStart),
        round6((play.srcEnd - play.srcStart) / VIDEO_PLAYBACK_SPEED),
        'a play takes its recording time divided by the speed',
      );
    }
  });

  test('equal timestamps on both sides give identical pieces and windows, and every step keeps its hold', () => {
    const steps = [stepAt(1, 1000), stepAt(2, 2000)];
    const timeline = pacedTimeline(
      [sideOf('before', 0, steps), sideOf('after', 0, steps)],
      [4, 4],
    );
    const [before, after] = timeline.sides;
    assert.deepEqual(roundPieces(after.pieces), roundPieces(before.pieces));
    assert.deepEqual(
      after.windows.map(roundWindow),
      before.windows.map(roundWindow),
    );
    assert.equal(timeline.holdStarts.length, 2, 'both steps hold');
    assert.ok(
      timeline.holdStarts[1] - timeline.holdStarts[0] > VIDEO_STEP_HOLD_SECONDS,
      'the second hold is after the first',
    );
  });

  test('differing timestamps start each step at the same output time on both sides, and the shorter stretch holds its last frame', () => {
    const timeline = pacedTimeline(UNEVEN, UNEVEN_LENGTHS);
    const [before, after] = timeline.sides;
    const starts = (side: PacedSide) =>
      side.windows.map((window) => round6(window.start));
    assert.deepEqual(starts(after), starts(before));
    assert.deepEqual(starts(before), [
      0,
      round6(timeline.holdStarts[0]),
      round6(timeline.holdStarts[1]),
    ]);
    // After's middle stretch is 1 s of recording, but the longer side's 2 s stretch
    // sets its length, so After plays the 1 s slower and holds the last frame.
    const middle = after.pieces.find(
      (piece) => piece.kind === 'play' && piece.srcStart === 1,
    );
    assert.ok(middle, 'After plays its middle stretch');
    assert.equal(round6(middle.srcEnd), 2);
    assert.equal(
      round6(middle.outEnd - middle.outStart),
      round6(2 / VIDEO_PLAYBACK_SPEED),
      "the stretch is as long as the longer side's",
    );
  });

  test("the tail is as long as the longest side's, and the shorter side holds its last frame to the end", () => {
    const timeline = pacedTimeline(UNEVEN, UNEVEN_LENGTHS);
    const [before, after] = timeline.sides;
    const tail = 2 / VIDEO_PLAYBACK_SPEED;
    assert.equal(
      round6(timeline.total),
      round6(timeline.holdStarts[1] + VIDEO_STEP_HOLD_SECONDS + tail),
    );
    // Before's tail is 1 s of recording, so it is held for the 2 s stretch.
    const beforeTail = before.pieces[before.pieces.length - 1];
    assert.deepEqual(
      [
        beforeTail.kind,
        round6(beforeTail.srcStart),
        round6(beforeTail.srcEnd),
        round6(beforeTail.outEnd - beforeTail.outStart),
      ],
      ['play', 3, 4, round6(tail)],
    );
    // After's tail is the full 2 s, so it is not held.
    const afterTail = after.pieces[after.pieces.length - 1];
    assert.deepEqual(
      [
        afterTail.kind,
        round6(afterTail.srcStart),
        round6(afterTail.srcEnd),
        round6(afterTail.outEnd - afterTail.outStart),
      ],
      ['play', 2, 4, round6(tail)],
    );
  });

  test("a side with fewer steps holds its last frame through the other side's holds and stretches", () => {
    const [, after] = PLAN_TIMELINE.sides;
    const last = after.pieces[after.pieces.length - 1];
    assert.equal(last.kind, 'hold');
    assert.equal(round6(last.srcStart), round6(PLAN_LENGTHS[1] - FRAME));
    assert.equal(round6(last.outEnd), round6(PLAN_TIMELINE.total));
    assert.deepEqual(after.windows.map(roundWindow), [
      { step: null, start: 0, end: round6(FIRST_HOLD) },
      { step: 1, start: round6(FIRST_HOLD), end: null },
    ]);
  });

  test('a side with no steps plays its whole recording as its lead, and its one strip runs to the end', () => {
    const timeline = pacedTimeline(
      [sideOf('before', 0, [stepAt(1, 1000)]), sideOf('after', 0, [])],
      [3, 5],
    );
    const [, after] = timeline.sides;
    assert.deepEqual(roundPieces(after.pieces)[0], {
      kind: 'play',
      srcStart: 0,
      srcEnd: 5,
      outStart: 0,
      outEnd: round6(5 / VIDEO_PLAYBACK_SPEED),
    });
    assert.deepEqual(after.windows.map(roundWindow), [
      { step: null, start: 0, end: null },
    ]);
  });

  test('with no steps on either side, the longer recording sets the length and the shorter one holds its last frame', () => {
    const timeline = pacedTimeline(
      [sideOf('before', 0, []), sideOf('after', 0, [])],
      [3, 5],
    );
    assert.deepEqual(timeline.holdStarts, []);
    assert.equal(round6(timeline.total), round6(5 / VIDEO_PLAYBACK_SPEED));
    assert.deepEqual(roundPieces(timeline.sides[0].pieces), [
      {
        kind: 'play',
        srcStart: 0,
        srcEnd: 3,
        outStart: 0,
        outEnd: round6(5 / VIDEO_PLAYBACK_SPEED),
      },
    ]);
  });

  /** A timeline's output as its numbers, with each side's pieces and windows rounded. */
  const shapeOf = (timeline: ReturnType<typeof pacedTimeline>) => ({
    holdStarts: timeline.holdStarts.map(round6),
    total: round6(timeline.total),
    sides: timeline.sides.map((side) => ({
      side: side.side,
      pieces: roundPieces(side.pieces),
      windows: side.windows.map(roundWindow),
    })),
  });

  test('a step taken before the recording opened is taken at its start', () => {
    const early = pacedTimeline([sideOf('after', 2000, [stepAt(1, 400)])], [3]);
    const atStart = pacedTimeline(
      [sideOf('after', 2000, [stepAt(1, 2000)])],
      [3],
    );
    assert.deepEqual(shapeOf(early), shapeOf(atStart));
  });

  test('a step past the end of the recording is held at its last frame, as a step at the end is', () => {
    const past = pacedTimeline([sideOf('after', 0, [stepAt(1, 9000)])], [3]);
    const atEnd = pacedTimeline([sideOf('after', 0, [stepAt(1, 3000)])], [3]);
    assert.deepEqual(shapeOf(past), shapeOf(atEnd));
    for (const piece of past.sides[0].pieces) {
      assert.ok(piece.srcEnd <= 3 + EPS, 'no piece reads past the recording');
    }
  });

  test('a step at 0 gives its side no play before its first hold, and its opening strip runs to that hold', () => {
    const timeline = pacedTimeline(
      [
        sideOf('before', 0, [stepAt(1, 0), stepAt(2, 2000)]),
        sideOf('after', 0, [stepAt(1, 1000)]),
      ],
      [5, 4],
    );
    const [before] = timeline.sides;
    const [firstHold] = timeline.holdStarts;
    assert.ok(firstHold > 0);
    assert.equal(
      before.pieces.some(
        (piece) => piece.kind === 'play' && piece.outStart < firstHold - EPS,
      ),
      false,
      'Before does not play before its first hold',
    );
    assert.deepEqual(roundWindow(before.windows[0]), {
      step: null,
      start: 0,
      end: round6(firstHold),
    });
  });

  test('a first step at 0 on both sides drops the opening strip, so the first hold starts the MP4', () => {
    const timeline = pacedTimeline(
      [
        sideOf('before', 0, [stepAt(1, 0), stepAt(2, 2000)]),
        sideOf('after', 0, [stepAt(1, 0)]),
      ],
      [5, 4],
    );
    assert.equal(timeline.holdStarts[0], 0);
    for (const side of timeline.sides) {
      assert.equal(
        side.windows.some((window) => window.step === null),
        false,
        `${side.side} has no opening strip`,
      );
      assert.equal(side.windows[0].step?.index, 1);
      assert.equal(side.windows[0].start, 0);
    }
  });
});

describe('pacedTimeline: caption windows, pieces and the shape of the MP4', () => {
  test("each caption runs from its step's hold to the next step's hold, the last stays to the end, and the opening strip covers the lead", () => {
    const [before, after] = PLAN_TIMELINE.sides;
    assert.deepEqual(before.windows.map(roundWindow), [
      { step: null, start: 0, end: round6(FIRST_HOLD) },
      { step: 1, start: round6(FIRST_HOLD), end: round6(SECOND_HOLD) },
      { step: 2, start: round6(SECOND_HOLD), end: null },
    ]);
    assert.deepEqual(after.windows.map(roundWindow), [
      { step: null, start: 0, end: round6(FIRST_HOLD) },
      { step: 1, start: round6(FIRST_HOLD), end: null },
    ]);
  });

  test("each side's pieces tile the MP4 from 0 to its total, with no gap or overlap, and stay inside its recording", () => {
    const shapes: [string, readonly VideoSide[], number[]][] = [
      ['PLAN', PLAN.sides, PLAN_LENGTHS],
      ['UNEVEN', UNEVEN, UNEVEN_LENGTHS],
      [
        'a step at 0',
        [
          sideOf('before', 0, [stepAt(1, 0), stepAt(2, 2000)]),
          sideOf('after', 0, [stepAt(1, 0)]),
        ],
        [5, 4],
      ],
      ['no steps', [sideOf('before', 0, []), sideOf('after', 0, [])], [3, 5]],
      ['one side, one step', [sideOf('after', 2000, [stepAt(1, 2500)])], [3]],
    ];
    for (const [name, sides, lengths] of shapes) {
      const timeline = pacedTimeline(sides, lengths);
      timeline.sides.forEach((side, i) => {
        let at = 0;
        for (const piece of side.pieces) {
          assert.ok(
            Math.abs(piece.outStart - at) < EPS,
            `${name}, ${side.side}: a gap or overlap at ${at}`,
          );
          assert.ok(
            piece.srcStart >= -EPS && piece.srcEnd <= lengths[i] + EPS,
            `${name}, ${side.side}: a piece reads outside its recording`,
          );
          at = piece.outEnd;
        }
        assert.ok(
          Math.abs(at - timeline.total) < EPS,
          `${name}, ${side.side}: ends at ${at}, not ${timeline.total}`,
        );
      });
    }
  });

  test("an After-only MP4 is timed from After's own recording alone", () => {
    const timeline = pacedTimeline(
      [sideOf('after', 2000, [stepAt(1, 2500)])],
      [3],
    );
    assert.equal(timeline.sides.length, 1);
    assert.equal(timeline.sides[0].side, 'after');
    // Step 1 is 0.5 s into After's recording: the lead is slowed, then the hold,
    // then the 2.5 s to the end, slowed.
    const lead = 0.5 / VIDEO_PLAYBACK_SPEED;
    const tail = 2.5 / VIDEO_PLAYBACK_SPEED;
    assert.deepEqual(timeline.holdStarts.map(round6), [round6(lead)]);
    assert.equal(
      round6(timeline.total),
      round6(lead + VIDEO_STEP_HOLD_SECONDS + tail),
    );
    assert.deepEqual(timeline.sides[0].windows.map(roundWindow), [
      { step: null, start: 0, end: round6(lead) },
      { step: 1, start: round6(lead), end: null },
    ]);
  });

  test('the pacing constants are the values #1555 fixes: a 2.5 s hold and playback at 0.75', () => {
    // #1555 fixes these values; a change to either is a change to the PRD's pacing.
    assert.equal(VIDEO_STEP_HOLD_SECONDS, 2.5);
    assert.equal(VIDEO_PLAYBACK_SPEED, 0.75);
  });

  test('a timeline needs one recording length per side, and every length must be more than 0', () => {
    assert.throws(
      () => pacedTimeline(PLAN.sides, [6]),
      /one recording length is needed per side/,
    );
    assert.throws(
      () => pacedTimeline([sideOf('after', 0, [])], [0]),
      /after: the recording has no length/,
    );
    assert.throws(
      () => pacedTimeline([sideOf('after', 0, [])], [Number.NaN]),
      /after: the recording has no length/,
    );
  });
});

describe("durationFromPackets: a recording's length from its packet times", () => {
  const assertSeconds = (actual: number | null, expected: number) => {
    assert.notEqual(actual, null);
    assert.ok(
      Math.abs((actual ?? Number.NaN) - expected) < EPS,
      `${actual} is not ${expected}`,
    );
  };

  test('no packet time gives null: empty output, or only lines that are not a time', () => {
    assert.equal(durationFromPackets(''), null);
    assert.equal(durationFromPackets('N/A\nN/A\n'), null);
  });

  test('a single packet is one frame long', () => {
    assertSeconds(durationFromPackets('0.000000'), FRAME);
  });

  test('a recording with about 200k packet lines (over two hours at 25 fps) reads last less first plus one frame, without throwing', () => {
    const packets = 200_000;
    const output = Array.from({ length: packets }, (_, n) =>
      (n / VIDEO_FPS).toFixed(6),
    ).join('\n');
    assertSeconds(
      durationFromPackets(output),
      (packets - 1) / VIDEO_FPS + FRAME,
    );
  });

  test('last less first, plus one frame, is the length, whatever order the lines come in', () => {
    assertSeconds(
      durationFromPackets('0.000000\n0.080000\n0.040000'),
      0.08 + FRAME,
    );
  });

  test('a trailing blank line adds nothing', () => {
    assert.equal(
      durationFromPackets('0.000000\n0.040000\n'),
      durationFromPackets('0.000000\n0.040000'),
    );
    assertSeconds(durationFromPackets('0.000000\n0.040000\n'), 0.04 + FRAME);
  });

  test('a line that is not a time is skipped, and the times around it still count', () => {
    // The first time is 0.04, so the length is last less first (0.04) plus a frame.
    assertSeconds(durationFromPackets('N/A\n0.040000\n0.080000'), 0.04 + FRAME);
  });

  test('the length is last less first, plus a frame, so a recording that starts late is measured from its first packet', () => {
    // 0.500000 and 0.540000 are one frame apart: last less first is one frame, plus one more.
    assertSeconds(durationFromPackets('0.500000\n0.540000'), FRAME + FRAME);
    assertSeconds(durationFromPackets('0.500000\n0.540000'), 0.08);
  });
});

describe('probeDurationArgs: the ffprobe arguments that read the packet times', () => {
  test("the first video stream's packet times, one per line, of the given file", () => {
    assert.deepEqual(probeDurationArgs('/work/before.webm'), [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'packet=pts_time',
      '-of',
      'csv=p=0',
      '/work/before.webm',
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

/** The filter chunks that cut one side's pieces, in the order the graph joins them. */
function pieceChunks(args: readonly string[], sideIndex: number): string[] {
  return valueAfter(args, '-filter_complex')
    .split(';')
    .filter((chunk) => chunk.startsWith(`[s${sideIndex}_`));
}

/** The `enable` expression of each caption strip overlay on one side, in order. */
function enablesOf(args: readonly string[], sideIndex: number): string[] {
  return valueAfter(args, '-filter_complex')
    .split(';')
    .filter(
      (chunk) =>
        chunk.startsWith(`[c${sideIndex}_`) && chunk.includes('enable='),
    )
    .map((chunk) => /enable='([^']*)'/.exec(chunk)?.[1] ?? '');
}

/** A single side with one step at 1 s and a 3 s recording: the smallest MP4 with a step. */
const ONE_PLAN: AnnotatedVideoPlan = {
  ...PLAN,
  sides: [sideOf('before', 0, [stepAt(1, 1000)])],
};
const ONE_LENGTHS = [3];
const ONE_OVERLAYS: VideoOverlayFiles = {
  band: OVERLAYS.band,
  sides: [
    {
      label: '/o/one-label.png',
      strips: ['/o/one-0.png', '/o/one-1.png'],
    },
  ],
};

describe('buildAnnotatedVideoArgs', () => {
  test('the inputs are the recording of each side, then the band, then per side its label and its strips in window order', () => {
    const args = buildAnnotatedVideoArgs(PLAN, OVERLAYS, PLAN_TIMELINE);
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

  test('a single side with one step is exactly the graph its paced timeline calls for: cut, slowed, held, labelled, captioned, framed', () => {
    const args = buildAnnotatedVideoArgs(
      ONE_PLAN,
      ONE_OVERLAYS,
      pacedTimeline(ONE_PLAN.sides, ONE_LENGTHS),
    );
    assert.deepEqual(inputsOf(args), [
      '/work/before.webm',
      '/o/band.png',
      '/o/one-label.png',
      '/o/one-0.png',
      '/o/one-1.png',
    ]);
    // Lead 1 s, slowed; the step's hold; then the 2 s tail, slowed. The opening
    // strip runs to the first hold, the step's strip to the end.
    const lead = 1 / VIDEO_PLAYBACK_SPEED;
    const tail = 2 / VIDEO_PLAYBACK_SPEED;
    const hold = VIDEO_STEP_HOLD_SECONDS;
    const slowed = `setpts=(PTS-STARTPTS)/${VIDEO_PLAYBACK_SPEED}`;
    const { width, height } = VIDEO_PANEL;
    assert.equal(
      valueAfter(args, '-filter_complex'),
      [
        `[0:v]fps=${VIDEO_FPS},scale=${width}:${height},setsar=1,split=3[s0_0][s0_1][s0_2]`,
        `[s0_0]trim=start=0.000:end=1.000,${slowed},fps=${VIDEO_FPS},tpad=stop_mode=clone:stop_duration=${s3(lead)},trim=duration=${s3(lead)},setpts=PTS-STARTPTS[q0_0]`,
        `[s0_1]trim=start=1.000:end=${s3(1 + FRAME)},setpts=PTS-STARTPTS,fps=${VIDEO_FPS},tpad=stop_mode=clone:stop_duration=${s3(hold)},trim=duration=${s3(hold)},setpts=PTS-STARTPTS[q0_1]`,
        `[s0_2]trim=start=1.000:end=3.000,${slowed},fps=${VIDEO_FPS},tpad=stop_mode=clone:stop_duration=${s3(tail)},trim=duration=${s3(tail)},setpts=PTS-STARTPTS[q0_2]`,
        '[q0_0][q0_1][q0_2]concat=n=3:v=1:a=0[p0]',
        '[p0][2:v]overlay=0:0[l0]',
        `[l0]pad=${width}:${height + VIDEO_STRIP_HEIGHT}:0:0[c0_0]`,
        `[c0_0][3:v]overlay=0:${height}:enable='gte(t,0.000)*lt(t,${s3(lead)})'[c0_1]`,
        `[c0_1][4:v]overlay=0:${height}:enable='gte(t,${s3(lead)})'[c0_2]`,
        '[c0_2]null[stack]',
        `[stack]pad=iw:ih+${VIDEO_BAND_HEIGHT}:0:${VIDEO_BAND_HEIGHT}[framed]`,
        '[framed][1:v]overlay=0:0[v]',
      ].join(';'),
    );
  });

  test('each side is cut into its paced pieces, in order: a play is slowed, a hold is one frame held for its length, and the pieces are joined', () => {
    const args = buildAnnotatedVideoArgs(PLAN, OVERLAYS, PLAN_TIMELINE);
    const graph = valueAfter(args, '-filter_complex');
    PLAN_TIMELINE.sides.forEach(({ pieces }, sideIndex) => {
      const chunks = pieceChunks(args, sideIndex);
      assert.equal(chunks.length, pieces.length);
      pieces.forEach((piece, n) => {
        const length = s3(piece.outEnd - piece.outStart);
        const retime =
          piece.kind === 'play'
            ? `setpts=(PTS-STARTPTS)/${VIDEO_PLAYBACK_SPEED}`
            : 'setpts=PTS-STARTPTS';
        assert.equal(
          chunks[n],
          `[s${sideIndex}_${n}]trim=start=${s3(piece.srcStart)}:end=${s3(piece.srcEnd)},${retime},fps=${VIDEO_FPS},tpad=stop_mode=clone:stop_duration=${length},trim=duration=${length},setpts=PTS-STARTPTS[q${sideIndex}_${n}]`,
        );
      });
      const labels = pieces.map((_, n) => `[s${sideIndex}_${n}]`).join('');
      const joins = pieces.map((_, n) => `[q${sideIndex}_${n}]`).join('');
      assert.ok(
        graph.includes(`split=${pieces.length}${labels}`),
        `${sideIndex} is split into its pieces`,
      );
      assert.ok(
        graph.includes(
          `${joins}concat=n=${pieces.length}:v=1:a=0[p${sideIndex}]`,
        ),
        `${sideIndex}'s pieces are joined in order`,
      );
    });
  });

  test('the sides are stacked, then the stack is framed under the band', () => {
    const graph = valueAfter(
      buildAnnotatedVideoArgs(PLAN, OVERLAYS, PLAN_TIMELINE),
      '-filter_complex',
    ).split(';');
    assert.ok(graph.includes('[c0_3][c1_2]hstack=inputs=2[stack]'));
    assert.ok(
      graph.includes(
        `[stack]pad=iw:ih+${VIDEO_BAND_HEIGHT}:0:${VIDEO_BAND_HEIGHT}[framed]`,
      ),
    );
  });

  test("each caption strip is enabled on the paced timeline, from its step's hold to the next step's hold", () => {
    const args = buildAnnotatedVideoArgs(PLAN, OVERLAYS, PLAN_TIMELINE);
    assert.deepEqual(enablesOf(args, 0), [
      `gte(t,0.000)*lt(t,${s3(FIRST_HOLD)})`,
      `gte(t,${s3(FIRST_HOLD)})*lt(t,${s3(SECOND_HOLD)})`,
      `gte(t,${s3(SECOND_HOLD)})`,
    ]);
    assert.deepEqual(enablesOf(args, 1), [
      `gte(t,0.000)*lt(t,${s3(FIRST_HOLD)})`,
      `gte(t,${s3(FIRST_HOLD)})`,
    ]);
  });

  test('the band is overlaid last with no enable, so it shows for the whole video', () => {
    const graph = valueAfter(
      buildAnnotatedVideoArgs(PLAN, OVERLAYS, PLAN_TIMELINE),
      '-filter_complex',
    ).split(';');
    const band = graph.at(-1) ?? '';
    assert.equal(band, '[framed][2:v]overlay=0:0[v]');
    assert.equal(band.includes('enable'), false);
  });

  test('the output is H.264 in yuv420p with no audio, written to the plan output, and the graph never draws text', () => {
    for (const plan of [PLAN, ONE_PLAN]) {
      const overlays = plan === PLAN ? OVERLAYS : ONE_OVERLAYS;
      const args = buildAnnotatedVideoArgs(plan, overlays, timelineOf(plan));
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
          pacedTimeline([], []),
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
          pacedTimeline(threeSides, [6, 3, 6]),
        ),
      /one or two sides/,
    );
  });

  test('overlays that do not match the sides, or the windows of a side, are refused', () => {
    assert.throws(
      () =>
        buildAnnotatedVideoArgs(
          PLAN,
          { band: OVERLAYS.band, sides: [OVERLAYS.sides[0]] },
          PLAN_TIMELINE,
        ),
      /one set of overlays is needed per side/,
    );
    assert.throws(
      () =>
        buildAnnotatedVideoArgs(
          PLAN,
          {
            band: OVERLAYS.band,
            sides: [
              OVERLAYS.sides[0],
              { label: '/o/after-label.png', strips: ['/o/after-0.png'] },
            ],
          },
          PLAN_TIMELINE,
        ),
      /after: one strip is needed per caption window/,
    );
  });

  test('a timeline that does not give one paced side per plan side is refused', () => {
    assert.throws(
      () =>
        buildAnnotatedVideoArgs(
          PLAN,
          OVERLAYS,
          pacedTimeline([PLAN.sides[0]], [6]),
        ),
      /one paced timeline is needed per side/,
    );
  });
});

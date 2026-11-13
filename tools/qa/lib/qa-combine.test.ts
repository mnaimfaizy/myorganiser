// Contracts for the pure combine rules (ADR 0147 decision 5; PRD #1544's
// annotated MP4): kind detection, height and output validation, the output
// path, the side-by-side ffmpeg argument lists of a screenshot or video pair,
// the caption windows of a `Capture: video` side, and the ffmpeg arguments of
// its annotated MP4. Everything here is a pure function, so no process and no
// file is touched; the executor is in qa-combine-executor.test.ts, the overlay
// pages the MP4 reads are in video-overlay-html.test.ts, and the real ffmpeg
// run is in its own suite.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  type AnnotatedVideoPlan,
  type CaptionWindow,
  type CombineFiles,
  CombineInputError,
  type VideoOverlayFiles,
  type VideoSide,
  type VideoStep,
  buildAnnotatedVideoArgs,
  buildImageArgs,
  buildVideoArgs,
  captionWindows,
  combineKind,
  enableExpression,
  kindOf,
  outputFor,
  validateHeight,
} from './qa-combine.ts';
import type { Band } from './storyboard.ts';

const FILES: CombineFiles = {
  before: '/in/before.png',
  after: '/in/after.png',
};

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

describe('kindOf and combineKind', () => {
  test('image extensions are an image; video extensions are a video', () => {
    for (const path of ['a.png', 'a.jpg', 'a.jpeg']) {
      assert.equal(kindOf(path), 'image', path);
    }
    for (const path of ['a.webm', 'a.mp4', 'a.mov']) {
      assert.equal(kindOf(path), 'video', path);
    }
  });

  test('the extension match is case-insensitive', () => {
    assert.equal(kindOf('SHOT.PNG'), 'image');
    assert.equal(kindOf('clip.MP4'), 'video');
    assert.equal(combineKind('A.PNG', 'b.Jpeg'), 'image');
    assert.equal(combineKind('A.MOV', 'b.WebM'), 'video');
  });

  test('an unknown or missing extension is not a kind', () => {
    assert.equal(kindOf('notes.bmp'), null);
    assert.equal(kindOf('notes.txt'), null);
    assert.equal(kindOf('no-extension'), null);
  });

  test('a matching image pair and a matching video pair combine', () => {
    assert.equal(combineKind('before.png', 'after.jpg'), 'image');
    assert.equal(combineKind('before.webm', 'after.mp4'), 'video');
  });

  test('a mixed image and video pair is a CombineInputError', () => {
    assert.throws(
      () => combineKind('before.png', 'after.mp4'),
      (error: unknown) =>
        error instanceof CombineInputError &&
        /before is an image but after is a video/.test(error.message),
    );
    assert.throws(
      () => combineKind('before.mov', 'after.jpg'),
      CombineInputError,
    );
  });

  test('an unknown extension on either side names that side', () => {
    assert.throws(
      () => combineKind('before.bmp', 'after.png'),
      (error: unknown) =>
        error instanceof CombineInputError &&
        error.message.includes('before.bmp'),
    );
    assert.throws(
      () => combineKind('before.png', 'after.txt'),
      (error: unknown) =>
        error instanceof CombineInputError &&
        error.message.includes('after.txt'),
    );
  });
});

describe('validateHeight', () => {
  test('an even integer of 2 or more is returned unchanged', () => {
    assert.equal(validateHeight(2), 2);
    assert.equal(validateHeight(48), 48);
    assert.equal(validateHeight(720), 720);
  });

  for (const height of [
    0,
    -2,
    1,
    721,
    48.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    test(`${height} is rejected`, () => {
      assert.throws(() => validateHeight(height), CombineInputError);
    });
  }
});

describe('outputFor', () => {
  test('an image is written to one PNG, and a video to one MP4', () => {
    assert.equal(outputFor('image', 'out/shot'), 'out/shot.png');
    assert.equal(outputFor('video', 'out/clip'), 'out/clip.mp4');
  });

  test('an --out that already carries an extension is rejected for both kinds', () => {
    assert.throws(() => outputFor('image', 'out/shot.png'), CombineInputError);
    assert.throws(() => outputFor('video', 'out/clip.mp4'), CombineInputError);
  });
});

describe('buildImageArgs', () => {
  test('starts with the quiet, overwrite flags', () => {
    const args = buildImageArgs(FILES, '/out/shot.png', 48);
    assert.deepEqual(args.slice(0, 4), [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
    ]);
  });

  test('the two inputs are the before side then the after side', () => {
    const args = buildImageArgs(FILES, '/out/shot.png', 48);
    assert.deepEqual(inputsOf(args), [FILES.before, FILES.after]);
  });

  test('both sides are scaled to the requested height and stacked before-left, with no label overlay', () => {
    const filter = valueAfter(
      buildImageArgs(FILES, '/out/shot.png', 48),
      '-filter_complex',
    );
    assert.equal(
      filter,
      '[0:v]scale=-2:48[b];[1:v]scale=-2:48[a];[b][a]hstack=inputs=2[v]',
    );
  });

  test('the height argument flows into the scale filter', () => {
    const filter = valueAfter(
      buildImageArgs(FILES, '/out/shot.png', 720),
      '-filter_complex',
    );
    assert.equal(
      filter,
      '[0:v]scale=-2:720[b];[1:v]scale=-2:720[a];[b][a]hstack=inputs=2[v]',
    );
  });

  test('a single frame is written, with no fps change and no video encoder', () => {
    const args = buildImageArgs(FILES, '/out/shot.png', 48);
    assert.equal(valueAfter(args, '-frames:v'), '1');
    assert.equal(valueAfter(args, '-map'), '[v]');
    assert.equal(args.includes('libx264'), false);
    assert.equal(valueAfter(args, '-filter_complex').includes('fps='), false);
    assert.equal(args.at(-1), '/out/shot.png');
  });
});

describe('buildVideoArgs', () => {
  test('starts with the quiet, overwrite flags', () => {
    const args = buildVideoArgs(FILES, '/out/clip.mp4', 48);
    assert.deepEqual(args.slice(0, 4), [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
    ]);
  });

  test('the two inputs are the before side then the after side', () => {
    const args = buildVideoArgs(FILES, '/out/clip.mp4', 48);
    assert.deepEqual(inputsOf(args), [FILES.before, FILES.after]);
  });

  test('both sides are brought to VIDEO_FPS, scaled to the height and stacked before-left, with no label overlay', () => {
    const filter = valueAfter(
      buildVideoArgs(FILES, '/out/clip.mp4', 48),
      '-filter_complex',
    );
    assert.equal(
      filter,
      '[0:v]fps=25,scale=-2:48[b];[1:v]fps=25,scale=-2:48[a];[b][a]hstack=inputs=2[v]',
    );
  });

  test('the output is H.264 in yuv420p with no audio and a fast-start container', () => {
    const args = buildVideoArgs(FILES, '/out/clip.mp4', 48);
    assert.equal(valueAfter(args, '-c:v'), 'libx264');
    assert.equal(valueAfter(args, '-pix_fmt'), 'yuv420p');
    assert.ok(args.includes('-an'));
    assert.equal(valueAfter(args, '-movflags'), '+faststart');
    assert.equal(args.includes('-frames:v'), false);
    assert.equal(args.at(-1), '/out/clip.mp4');
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

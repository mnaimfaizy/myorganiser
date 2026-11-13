// Contracts for the combine executor (ADR 0147 decision 5; PRD #1544's
// annotated MP4; PRD #1550's re-render), run with stubbed deps: an in-memory
// run folder, and every Chromium render and ffmpeg run a fake, so no process
// starts and no file is written. The pure rules are in qa-combine.test.ts, the
// overlay pages in video-overlay-html.test.ts, and the real renders in
// ../qa-combine.real-ffmpeg.test.ts. A re-render checked against what `qa:run`
// made is in qa-run-executor.test.ts.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import {
  type AnnotateDeps,
  COMBINE_USAGE,
  FFMPEG_MISSING_MESSAGE,
  type RecombineDeps,
  makeAnnotatedVideo,
  runCombine,
} from './qa-combine-executor.ts';
import {
  type AnnotatedVideoPlan,
  type VideoStep,
  VIDEO_BAND_HEIGHT,
  VIDEO_LABEL_HEIGHT,
  VIDEO_PANEL,
  VIDEO_STRIP_HEIGHT,
} from './qa-combine.ts';
import { type Band, type Storyboard, buildStoryboard } from './storyboard.ts';

const TEMP = '/tmp/qa-combine-fake';
const TOKENS = ':root{--qa-test-token:1}';

const RUN = '/run';
const RECORDS = `${RUN}/steps/S.json`;
const MANIFEST = `${RUN}/run.json`;
const BEFORE_STILL = `${RUN}/steps/S/before/01.png`;
const AFTER_STILL = `${RUN}/steps/S/after/01.png`;
const BEFORE_VIDEO = `${RUN}/before/S.webm`;
const AFTER_VIDEO = `${RUN}/after/S.webm`;
const SCREEN_PNG = `${RUN}/combined/S.png`;
const SCREEN_TEMP = `${RUN}/combined/.recombine-S.png`;
const VIDEO_MP4 = `${RUN}/combined/S.mp4`;
const VIDEO_TEMP = `${RUN}/combined/.recombine-S.mp4`;
const RE_RENDER = ['--run', RUN, '--scenario', 'S'];

const NO_CHROMIUM = "Playwright's Chromium is not installed";
// Secrets built at runtime, so no literal credential sits in the source.
const BEARER = 'Bearer qa-tok';
const JWT = ['eyJ'.concat('a'.repeat(8)), 'b'.repeat(8), 'c2ln'].join('.');

/** The text of each `-i` input, in argument order. */
function inputsOf(argv: readonly string[]): string[] {
  return argv.flatMap((arg, i) => (arg === '-i' ? [argv[i + 1]] : []));
}

/** One step as `qa:run` saves it: its still is relative to the run folder. */
function savedStep(side: 'before' | 'after', caption: string) {
  return {
    side,
    index: 1,
    device: 'A',
    tab: 'A',
    label: 'Device A',
    caption,
    still: `steps/S/${side}/01.png`,
    subject: null,
    atMs: 0,
  };
}

/** The tab a video side follows, as the `video` block saves it: no path. */
const VIDEO_SIDE = { device: 'A', tab: 'A', label: 'Device A', openedAtMs: 0 };

/** Scenario S's two sides, with After's one caption given. */
function sidesWithAfterCaption(caption: string) {
  return {
    before: {
      outcome: 'fail' as const,
      message: 'the defect shows here',
      steps: [savedStep('before', 'open the form')],
    },
    after: {
      outcome: 'pass' as const,
      observed: 'the fix shows here',
      steps: [savedStep('after', caption)],
    },
  };
}

/** Scenario S's step records as `qa:run` saves them; a video also keeps its `video` block. */
function recordsOf(
  capture: 'screenshot' | 'video',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'S',
    capture,
    title: 'Save an item',
    expected: { before: 'the defect shows', after: 'the fix shows' },
    commits: { before: 'abc1234', after: 'def5678' },
    sides: sidesWithAfterCaption('save the item'),
    ...(capture === 'video'
      ? {
          video: { tab: 'A', sides: { before: VIDEO_SIDE, after: VIDEO_SIDE } },
        }
      : {}),
    ...overrides,
  };
}

/** The files of one run folder: text files by path, and kept files by path. */
interface RunFolder {
  texts: Map<string, string>;
  disk: Set<string>;
}

/**
 * A run folder as `qa:run` leaves it for scenario S: its step records, its
 * manifest, the stills and, for a video, the recordings. `records` may be
 * text, to make a step-records file that is not what it should be.
 */
function runFolder(
  capture: 'screenshot' | 'video',
  records: Record<string, unknown> | string = recordsOf(capture),
): RunFolder {
  const texts = new Map<string, string>([
    [RECORDS, typeof records === 'string' ? records : JSON.stringify(records)],
    [
      MANIFEST,
      JSON.stringify({
        headline: 'QA passed',
        scenarios: [{ id: 'S', result: 'PASS' }],
      }),
    ],
  ]);
  const disk = new Set([BEFORE_STILL, AFTER_STILL]);
  if (capture === 'video') {
    disk.add(BEFORE_VIDEO);
    disk.add(AFTER_VIDEO);
  }
  return { texts, disk };
}

interface RecombineOptions {
  /** Why Chromium cannot be launched; absent when it can. */
  chromium?: string;
  /** The `ffmpeg -version` status; `null` when not installed. Default 0. */
  ffmpegStatus?: number | null;
  /** When set, the Storyboard render rejects with this. */
  renderError?: Error;
  /** When set, the MP4 render rejects with this. */
  annotateError?: Error;
  /** When set, every file read rejects with this (an unexpected I/O failure). */
  readError?: Error;
  /** When set, a move whose destination is this path rejects with the error. */
  moveFailure?: { to: string; error: Error };
}

/** The machine behind a re-render, over one run folder, with every effect logged. */
function fakeRecombine(folder: RunFolder, options: RecombineOptions = {}) {
  const { texts, disk } = folder;
  const calls: string[][] = [];
  const renders: {
    storyboard: Storyboard;
    stillRoot: string;
    pngPath: string;
  }[] = [];
  const annotations: AnnotatedVideoPlan[] = [];
  /** Every move and removal, in call order. */
  const ops: string[] = [];
  const out: string[] = [];
  const err: string[] = [];

  const deps: RecombineDeps = {
    run(argv) {
      calls.push([...argv]);
      const status =
        options.ffmpegStatus === undefined ? 0 : options.ffmpegStatus;
      return { status, stderr: status === 0 ? '' : 'spawn ffmpeg ENOENT' };
    },
    exists: (path) => disk.has(path) || texts.has(path),
    makeDir: () => undefined,
    removePath(path) {
      ops.push(`remove ${path}`);
      disk.delete(path);
      texts.delete(path);
    },
    readFile(path) {
      if (options.readError !== undefined) throw options.readError;
      const text = texts.get(path);
      if (text === undefined) throw new Error(`no file at ${path}`);
      return text;
    },
    movePath(from, to) {
      ops.push(`move ${from} ${to}`);
      if (options.moveFailure?.to === to) throw options.moveFailure.error;
      if (!disk.has(from)) throw new Error(`no file at ${from}`);
      disk.delete(from);
      disk.add(to);
    },
    async renderStoryboard(storyboard, stillRoot, pngPath) {
      renders.push({ storyboard, stillRoot, pngPath });
      if (options.renderError !== undefined) throw options.renderError;
      disk.add(pngPath);
    },
    async annotateVideo(plan) {
      annotations.push(plan);
      if (options.annotateError !== undefined) throw options.annotateError;
      disk.add(plan.output);
    },
    chromiumMissing: () => options.chromium ?? null,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };

  return { deps, calls, renders, annotations, ops, out, err, disk, texts };
}

/** Runs `qa:combine` over the folder with its fakes, and returns what it did. */
async function reRender(
  args: readonly string[],
  folder: RunFolder,
  options?: RecombineOptions,
) {
  const fake = fakeRecombine(folder, options);
  const code = await runCombine(args, fake.deps);
  return { code, ...fake };
}

/** Every line the run printed, which a secret must not reach. */
function printed(fake: { out: string[]; err: string[] }): string {
  return [...fake.out, ...fake.err].join('\n');
}

describe('runCombine: a screen scenario is re-rendered from its saved step records', () => {
  test('re-renders the Storyboard beside the final PNG, moves it into place, and prints the file as JSON', async () => {
    const fake = await reRender(RE_RENDER, runFolder('screenshot'));
    assert.equal(fake.code, 0);
    assert.deepEqual(fake.err, []);
    assert.deepEqual(JSON.parse(fake.out[0]), {
      scenario: 'S',
      combined: [SCREEN_PNG],
    });
    assert.deepEqual(
      fake.renders.map(({ stillRoot, pngPath }) => [stillRoot, pngPath]),
      [[RUN, SCREEN_TEMP]],
      'the Storyboard is rendered beside its destination, from the run folder',
    );
    assert.ok(fake.ops.includes(`move ${SCREEN_TEMP} ${SCREEN_PNG}`));
    assert.equal(fake.disk.has(SCREEN_PNG), true);
    assert.equal(fake.disk.has(SCREEN_TEMP), false, 'no temp PNG is left');
    assert.equal(fake.disk.has(VIDEO_TEMP), false, 'no temp MP4 is left');
  });

  test('the Storyboard is the one buildStoryboard makes from the saved records and the graded result', async () => {
    const fake = await reRender(RE_RENDER, runFolder('screenshot'));
    assert.deepEqual(
      fake.renders[0].storyboard,
      buildStoryboard({
        id: 'S',
        title: 'Save an item',
        expected: { before: 'the defect shows', after: 'the fix shows' },
        result: 'PASS',
        commits: { before: 'abc1234', after: 'def5678' },
        sides: sidesWithAfterCaption('save the item'),
      }),
    );
  });

  test('a screen scenario needs no ffmpeg: it re-renders with ffmpeg not installed and never probes it', async () => {
    const fake = await reRender(RE_RENDER, runFolder('screenshot'), {
      ffmpegStatus: null,
    });
    assert.equal(fake.code, 0);
    assert.deepEqual(fake.calls, []);
    assert.equal(fake.disk.has(SCREEN_PNG), true);
  });
});

describe('runCombine: a video scenario also re-renders its annotated MP4', () => {
  test('annotates the MP4 with the Storyboard band, each side on the recording it names, and its saved steps, then moves both into place', async () => {
    const fake = await reRender(RE_RENDER, runFolder('video'));
    assert.equal(fake.code, 0);
    assert.deepEqual(fake.err, []);
    assert.deepEqual(JSON.parse(fake.out[0]), {
      scenario: 'S',
      combined: [SCREEN_PNG, VIDEO_MP4],
    });

    assert.equal(fake.annotations.length, 1, 'one MP4 is made');
    const [plan] = fake.annotations;
    assert.deepEqual(plan.band, fake.renders[0].storyboard.band);
    assert.equal(plan.output, VIDEO_TEMP);
    assert.deepEqual(
      plan.sides.map(({ side, video, device, tab, label, openedAtMs }) => [
        side,
        video,
        device,
        tab,
        label,
        openedAtMs,
      ]),
      [
        ['before', BEFORE_VIDEO, 'A', 'A', 'Device A', 0],
        ['after', AFTER_VIDEO, 'A', 'A', 'Device A', 0],
      ],
    );
    assert.deepEqual(
      plan.sides.map(({ steps }) =>
        steps.map(({ index, caption, atMs }) => [index, caption, atMs]),
      ),
      [[[1, 'open the form', 0]], [[1, 'save the item', 0]]],
    );

    assert.ok(fake.ops.includes(`move ${VIDEO_TEMP} ${VIDEO_MP4}`));
    assert.equal(fake.disk.has(VIDEO_MP4), true);
    assert.equal(fake.disk.has(VIDEO_TEMP), false, 'no temp MP4 is left');
    assert.deepEqual(fake.calls, [['ffmpeg', '-version']]);
  });
});

describe('runCombine: a bad invocation exits 2 before anything is read or rendered', () => {
  const cases: [string, string[], RegExp][] = [
    [
      'a bare Before/After file pair',
      ['--before', '/in/before.png', '--after', '/in/after.png'],
      /a bare Before\/After file pair is not combined any more.*Give --run/,
    ],
    [
      'no --run',
      ['--scenario', 'S'],
      /--run <qa:run output folder> is missing/,
    ],
    ['no --scenario', ['--run', RUN], /--scenario <id> is missing/],
    [
      'an unknown flag',
      [...RE_RENDER, '--bogus', 'x'],
      /unknown argument "--bogus"/,
    ],
    ['a flag with no value', ['--run'], /--run needs a value/],
    [
      'a flag given twice',
      [...RE_RENDER, '--run', '/other'],
      /--run given twice/,
    ],
  ];
  for (const [label, args, reason] of cases) {
    test(`${label} exits 2 with its reason and renders nothing`, async () => {
      const fake = await reRender(args, runFolder('screenshot'));
      assert.equal(fake.code, 2);
      assert.equal(fake.err.length, 1);
      assert.match(fake.err[0], /^qa:combine: /);
      assert.match(fake.err[0], reason);
      assert.deepEqual(fake.renders, []);
      assert.deepEqual(fake.calls, []);
      assert.deepEqual(fake.out, []);
    });
  }

  test('a flag error reports the usage line, which says an exact-secret check cannot be redone', async () => {
    const fake = await reRender(['--bogus', 'x'], runFolder('screenshot'));
    assert.deepEqual(fake.err, [
      `qa:combine: unknown argument "--bogus"\n${COMBINE_USAGE}`,
    ]);
    assert.match(COMBINE_USAGE, /an exact-secret check cannot be redone/);
  });
});

describe('runCombine: a scenario id that qa:run could not have made exits 2 before anything is read', () => {
  const badIds: [string, string][] = [
    ['a parent segment', '../x'],
    ['a path separator', 'a/b'],
    ['an empty id', ''],
    ['a leading dash', '-x'],
    ['a space', 'a b'],
    ['a 65-character id, one past the limit', 'a'.repeat(65)],
  ];
  for (const [label, id] of badIds) {
    test(`${label} exits 2, names the id, and reads and renders nothing`, async () => {
      const folder = runFolder('screenshot');
      const before = [...folder.disk].sort();
      const fake = await reRender(['--run', RUN, '--scenario', id], folder);
      assert.equal(fake.code, 2);
      assert.deepEqual(fake.err, [
        `qa:combine: "${id}" is not a scenario id (letters, digits, _ and -, starting with a letter or digit)`,
      ]);
      assert.deepEqual(fake.out, []);
      assert.deepEqual(fake.calls, []);
      assert.deepEqual(fake.renders, []);
      assert.deepEqual([...fake.disk].sort(), before, 'no file is touched');
    });
  }

  test('a valid id of the longest allowed shape is read and re-rendered', async () => {
    const id = `S-1_${'x'.repeat(60)}`;
    assert.equal(id.length, 64);
    const folder = runFolder('screenshot', recordsOf('screenshot', { id }));
    folder.texts.delete(RECORDS);
    folder.texts.set(
      `${RUN}/steps/${id}.json`,
      JSON.stringify(recordsOf('screenshot', { id })),
    );
    folder.texts.set(
      MANIFEST,
      JSON.stringify({ scenarios: [{ id, result: 'PASS' }] }),
    );
    const fake = await reRender(['--run', RUN, '--scenario', id], folder);
    assert.equal(fake.code, 0, fake.err.join('\n'));
    assert.deepEqual(JSON.parse(fake.out[0]), {
      scenario: id,
      combined: [`${RUN}/combined/${id}.png`],
    });
  });
});

describe('runCombine: a missing input exits 2, names it, and renders nothing', () => {
  test('no step records for the scenario names the file', async () => {
    const folder = runFolder('screenshot');
    folder.texts.delete(RECORDS);
    const fake = await reRender(RE_RENDER, folder);
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      `qa:combine: no step records for scenario "S" in ${RUN}: ${RECORDS} does not exist`,
    ]);
    assert.deepEqual(fake.renders, []);
  });

  test('step records that are not JSON are refused, and the file is named', async () => {
    const fake = await reRender(
      RE_RENDER,
      runFolder('screenshot', '{"id": "S"'),
    );
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      `qa:combine: ${RECORDS} is not a step-records file: it is not JSON`,
    ]);
    assert.deepEqual(fake.renders, []);
  });

  test('step records of another scenario are refused', async () => {
    const fake = await reRender(
      RE_RENDER,
      runFolder('screenshot', recordsOf('screenshot', { id: 'T' })),
    );
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      `qa:combine: ${RECORDS} is not a step-records file: it is not scenario "S"`,
    ]);
    assert.deepEqual(fake.renders, []);
  });

  for (const still of ['../outside/01.png', '/etc/01.png']) {
    test(`a step whose still is "${still}", outside the run folder, is refused before anything is rendered`, async () => {
      const records = recordsOf('screenshot', {
        sides: {
          before: {
            outcome: 'fail',
            message: 'the defect shows here',
            steps: [{ ...savedStep('before', 'open the form'), still }],
          },
          after: sidesWithAfterCaption('save the item').after,
        },
      });
      const fake = await reRender(RE_RENDER, runFolder('screenshot', records));
      assert.equal(fake.code, 2);
      assert.deepEqual(fake.err, [
        `qa:combine: ${RECORDS} is not a step-records file: before step 1 names a still outside the run`,
      ]);
      assert.deepEqual(fake.renders, []);
    });
  }

  test('a run manifest that is missing names the file', async () => {
    const folder = runFolder('screenshot');
    folder.texts.delete(MANIFEST);
    const fake = await reRender(RE_RENDER, folder);
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      `qa:combine: the run manifest is needed for the graded result: ${MANIFEST} does not exist`,
    ]);
    assert.deepEqual(fake.renders, []);
  });

  test('a run manifest with no graded result for the scenario names the file and the scenario', async () => {
    const folder = runFolder('screenshot');
    folder.texts.set(
      MANIFEST,
      JSON.stringify({ scenarios: [{ id: 'T', result: 'PASS' }] }),
    );
    const fake = await reRender(RE_RENDER, folder);
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      `qa:combine: ${MANIFEST} has no graded result for scenario "S"`,
    ]);
  });

  test('a missing still names the file', async () => {
    const folder = runFolder('screenshot');
    folder.disk.delete(BEFORE_STILL);
    const fake = await reRender(RE_RENDER, folder);
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      `qa:combine: before step 1's still: ${BEFORE_STILL} does not exist`,
    ]);
    assert.deepEqual(fake.renders, []);
  });

  test('a video scenario whose records have no video block is refused, and the block is named', async () => {
    const fake = await reRender(
      RE_RENDER,
      runFolder('video', recordsOf('video', { video: undefined })),
    );
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      `qa:combine: ${RECORDS} has no video block, so the MP4 cannot be re-rendered (the run predates it)`,
    ]);
    assert.deepEqual(fake.renders, []);
    assert.deepEqual(fake.annotations, []);
  });

  test("a side's missing recording names the file", async () => {
    const folder = runFolder('video');
    folder.disk.delete(AFTER_VIDEO);
    const fake = await reRender(RE_RENDER, folder);
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      `qa:combine: after's recording of tab "A": ${AFTER_VIDEO} does not exist`,
    ]);
    assert.deepEqual(fake.renders, []);
  });

  for (const capture of ['screenshot', 'video'] as const) {
    test(`a ${capture} scenario with no Chromium exits 2 with its reason and renders nothing`, async () => {
      const fake = await reRender(RE_RENDER, runFolder(capture), {
        chromium: NO_CHROMIUM,
      });
      assert.equal(fake.code, 2);
      assert.deepEqual(fake.err, [`qa:combine: ${NO_CHROMIUM}`]);
      assert.deepEqual(fake.renders, []);
      assert.deepEqual(fake.annotations, []);
    });
  }

  test('a video scenario with ffmpeg not installed exits 2 with the install message, and renders nothing', async () => {
    const fake = await reRender(RE_RENDER, runFolder('video'), {
      ffmpegStatus: null,
    });
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [`qa:combine: ${FFMPEG_MISSING_MESSAGE}`]);
    assert.deepEqual(fake.calls, [['ffmpeg', '-version']]);
    assert.deepEqual(fake.renders, []);
    assert.deepEqual(fake.annotations, []);
  });
});

describe('runCombine: a refused scenario is not re-rendered, and no secret is printed', () => {
  test('records that list a refused field exit 2, name the scenario, and render nothing', async () => {
    const fake = await reRender(
      RE_RENDER,
      runFolder(
        'screenshot',
        recordsOf('screenshot', { refused: ['S after step 1 caption'] }),
      ),
    );
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      'qa:combine: scenario "S" was refused for caption privacy when qa:run made it, so it is not re-rendered',
    ]);
    assert.deepEqual(fake.renders, []);
  });

  test('a Bearer token in a caption exits 2, names the field, and prints no value', async () => {
    const fake = await reRender(
      RE_RENDER,
      runFolder(
        'screenshot',
        recordsOf('screenshot', {
          sides: sidesWithAfterCaption(`sent ${BEARER}`),
        }),
      ),
    );
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      'qa:combine: scenario "S" was refused for caption privacy: a secret or credential is in S after step 1 caption',
    ]);
    assert.equal(
      printed(fake).includes('qa-tok'),
      false,
      'the token is not printed',
    );
    assert.equal(
      printed(fake).includes('Bearer'),
      false,
      'the scheme is not printed',
    );
    assert.deepEqual(fake.renders, []);
  });

  test('a JWT in a caption exits 2, names the caption field, and prints no value', async () => {
    const fake = await reRender(
      RE_RENDER,
      runFolder(
        'screenshot',
        recordsOf('screenshot', {
          sides: sidesWithAfterCaption(`sent ${JWT}`),
        }),
      ),
    );
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      'qa:combine: scenario "S" was refused for caption privacy: a secret or credential is in S after step 1 caption',
    ]);
    assert.equal(printed(fake).includes(JWT), false, 'the JWT is not printed');
    assert.equal(
      printed(fake).includes('eyJ'),
      false,
      'no part of it is printed',
    );
    assert.deepEqual(fake.renders, []);
  });

  test('a JWT in a video block label exits 2, names the label field, and prints no value', async () => {
    const fake = await reRender(
      RE_RENDER,
      runFolder(
        'video',
        recordsOf('video', {
          video: {
            tab: 'A',
            sides: {
              before: { ...VIDEO_SIDE, label: `Device A ${JWT}` },
              after: VIDEO_SIDE,
            },
          },
        }),
      ),
    );
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      'qa:combine: scenario "S" was refused for caption privacy: a secret or credential is in S video before label',
    ]);
    assert.equal(printed(fake).includes(JWT), false, 'the JWT is not printed');
    assert.deepEqual(fake.renders, []);
    assert.deepEqual(fake.annotations, []);
  });
});

describe('runCombine: a failure leaves nothing behind and touches no original', () => {
  /** The run's own files, which a re-render never changes. */
  function assertOriginalsKept(fake: {
    disk: Set<string>;
    texts: Map<string, string>;
  }): void {
    assert.equal(fake.texts.get(RECORDS), JSON.stringify(recordsOf('video')));
    for (const path of [
      MANIFEST,
      BEFORE_STILL,
      AFTER_STILL,
      BEFORE_VIDEO,
      AFTER_VIDEO,
    ]) {
      assert.ok(fake.disk.has(path) || fake.texts.has(path), `${path} is kept`);
    }
  }

  test('a Storyboard render that rejects exits 1 with its reason, leaves no temp file, and keeps the earlier files', async () => {
    const folder = runFolder('video');
    folder.disk.add(SCREEN_PNG);
    folder.disk.add(VIDEO_MP4);
    const fake = await reRender(RE_RENDER, folder, {
      renderError: new Error('Chromium crashed\nmore detail'),
    });
    assert.equal(fake.code, 1);
    assert.deepEqual(fake.err, [
      'qa:combine: the Storyboard could not be rendered: Chromium crashed',
    ]);
    assert.deepEqual(fake.out, []);
    assert.deepEqual(fake.annotations, [], 'no MP4 is made');
    assert.equal(fake.disk.has(SCREEN_TEMP), false);
    assert.equal(fake.disk.has(VIDEO_TEMP), false);
    assert.equal(fake.disk.has(SCREEN_PNG), true, 'the earlier PNG stays');
    assert.equal(fake.disk.has(VIDEO_MP4), true, 'the earlier MP4 stays');
    assertOriginalsKept(fake);
  });

  test('an MP4 render that rejects exits 1 with its reason, moves nothing into place, and keeps the earlier files', async () => {
    const folder = runFolder('video');
    folder.disk.add(SCREEN_PNG);
    folder.disk.add(VIDEO_MP4);
    const fake = await reRender(RE_RENDER, folder, {
      annotateError: new Error(
        'ffmpeg failed to make the MP4: Invalid data found',
      ),
    });
    assert.equal(fake.code, 1);
    assert.deepEqual(fake.err, [
      'qa:combine: the MP4 could not be made: ffmpeg failed to make the MP4: Invalid data found',
    ]);
    assert.deepEqual(
      fake.ops.filter((op) => op.startsWith('move ')),
      [],
      'nothing is moved into place',
    );
    assert.equal(fake.disk.has(SCREEN_TEMP), false, 'the temp PNG is removed');
    assert.equal(fake.disk.has(VIDEO_TEMP), false, 'the temp MP4 is removed');
    assert.equal(fake.disk.has(SCREEN_PNG), true, 'the earlier PNG stays');
    assert.equal(fake.disk.has(VIDEO_MP4), true, 'the earlier MP4 stays');
    assertOriginalsKept(fake);
  });

  test('a side with no step makes the model refuse the Storyboard: exit 1 with its problem, and nothing rendered', async () => {
    const fake = await reRender(
      RE_RENDER,
      runFolder(
        'screenshot',
        recordsOf('screenshot', {
          sides: {
            ...sidesWithAfterCaption('save the item'),
            before: {
              outcome: 'fail',
              message: 'the defect shows here',
              steps: [],
            },
          },
        }),
      ),
    );
    assert.equal(fake.code, 1);
    assert.deepEqual(fake.err, [
      'qa:combine: before: no step() was called, so no Storyboard was made',
    ]);
    assert.deepEqual(fake.renders, []);
    assert.equal(fake.disk.has(SCREEN_PNG), false);
  });

  test('sides that took different numbers of steps exit 1 with the counts, and nothing is rendered', async () => {
    const folder = runFolder(
      'screenshot',
      recordsOf('screenshot', {
        sides: {
          before: {
            outcome: 'fail',
            message: 'the defect shows here',
            steps: [
              savedStep('before', 'open the form'),
              {
                ...savedStep('before', 'open the menu'),
                index: 2,
                still: 'steps/S/before/02.png',
              },
            ],
          },
          after: sidesWithAfterCaption('save the item').after,
        },
      }),
    );
    folder.disk.add(`${RUN}/steps/S/before/02.png`);
    const fake = await reRender(RE_RENDER, folder);
    assert.equal(fake.code, 1);
    assert.deepEqual(fake.err, [
      'qa:combine: Before took 2 step(s) and After took 1; steps are matched by index, so no Storyboard was made',
    ]);
    assert.deepEqual(fake.renders, []);
  });

  test("a side that ran with no saved MP4 recording is refused before anything is rendered: exit 2, names the recording's path, and moves and writes nothing", async () => {
    const folder = runFolder(
      'video',
      recordsOf('video', {
        video: { tab: 'A', sides: { before: VIDEO_SIDE } },
      }),
    );
    const before = [...folder.disk].sort();
    const fake = await reRender(RE_RENDER, folder);
    assert.equal(fake.code, 2);
    assert.deepEqual(fake.err, [
      `qa:combine: after ran but no recording of the MP4's tab was saved for it; the recording would be ${AFTER_VIDEO}`,
    ]);
    assert.deepEqual(fake.out, []);
    assert.deepEqual(fake.renders, [], 'no Storyboard is drawn');
    assert.deepEqual(fake.annotations, [], 'no MP4 is made');
    assert.deepEqual(fake.ops, [], 'nothing is moved or removed');
    assert.deepEqual([...fake.disk].sort(), before, 'nothing is written');
  });

  // Known limitation, accepted: the PNG is moved before the MP4, so a failed
  // MP4 move after it leaves the new PNG beside the old (or no) MP4. The run
  // still exits 1 and removes its temp files.
  test('an MP4 move that fails after the PNG moved exits 1 with the reason, leaves the new PNG beside the earlier MP4, and removes both temp files', async () => {
    const folder = runFolder('video');
    folder.disk.add(VIDEO_MP4);
    const fake = await reRender(RE_RENDER, folder, {
      moveFailure: {
        to: VIDEO_MP4,
        error: new Error('EXDEV: cross-device link not permitted'),
      },
    });
    assert.equal(fake.code, 1);
    assert.deepEqual(fake.err, [
      'qa:combine: EXDEV: cross-device link not permitted',
    ]);
    assert.deepEqual(fake.out, []);
    assert.equal(fake.disk.has(SCREEN_PNG), true, 'the new PNG was moved');
    assert.equal(
      fake.disk.has(VIDEO_MP4),
      true,
      'the earlier MP4 is untouched',
    );
    assert.equal(fake.disk.has(SCREEN_TEMP), false, 'the temp PNG is gone');
    assert.equal(fake.disk.has(VIDEO_TEMP), false, 'the temp MP4 is removed');
  });

  test('an unexpected read failure exits 1 through the catch-all, names the first line of the error, and renders nothing', async () => {
    const fake = await reRender(RE_RENDER, runFolder('video'), {
      readError: new Error('EIO: i/o error\nmore detail'),
    });
    assert.equal(fake.code, 1);
    assert.deepEqual(fake.err, ['qa:combine: EIO: i/o error']);
    assert.deepEqual(fake.out, []);
    assert.deepEqual(fake.renders, []);
    assert.deepEqual(fake.annotations, []);
  });
});

// The overlay PNGs' paths and sizes come from the plan: a band across both
// panels, then each side's label and one strip per caption window.
const BAND_PNG = join(TEMP, 'band.png');
const BEFORE_LABEL = join(TEMP, 'before-label.png');
const AFTER_LABEL = join(TEMP, 'after-label.png');
const BEFORE_STRIPS = [0, 1, 2].map((n) =>
  join(TEMP, `before-strip-0${n}.png`),
);
const AFTER_STRIPS = [0, 1].map((n) => join(TEMP, `after-strip-0${n}.png`));
const ANNOTATE_OUT = '/out/combined/S1.mp4';

const BAND: Band = {
  id: 'S1',
  title: 'Save an item',
  result: 'PASS',
  commits: { before: 'abc1234', after: 'def5678' },
};

const step = (index: number, caption: string, atMs: number): VideoStep => ({
  index,
  caption,
  atMs,
  device: 'A',
  tab: 'A',
  label: 'Device A',
});

/** Before has three caption windows (opening, two steps); After has two. */
const PLAN: AnnotatedVideoPlan = {
  band: BAND,
  sides: [
    {
      side: 'before',
      video: '/work/before.webm',
      device: 'A',
      tab: 'A',
      label: 'Device A',
      openedAtMs: 0,
      steps: [step(1, 'open the form', 1500), step(2, 'save the item', 4000)],
    },
    {
      side: 'after',
      video: '/work/after.webm',
      device: 'A',
      tab: 'A',
      label: 'Device A',
      openedAtMs: 2000,
      steps: [step(1, 'open the form', 2500)],
    },
  ],
  output: ANNOTATE_OUT,
};

interface AnnotateFakeOptions {
  /** The ffmpeg run's status; default 0. */
  status?: number;
  stderr?: string;
  /** Whether a successful ffmpeg run leaves the MP4 on disk; default true. */
  writesOutput?: boolean;
  /** When set, the Chromium render rejects with this error. */
  renderError?: Error;
}

function fakeAnnotate(options: AnnotateFakeOptions = {}) {
  const calls: string[][] = [];
  const files = new Set<string>();
  const removed: string[] = [];
  const dirs: string[] = [];
  const renders: {
    path: string;
    width: number;
    height: number;
    html: string;
  }[][] = [];
  /** Every effect in call order, so ordering can be asserted. */
  const log: string[] = [];

  const deps: AnnotateDeps = {
    run(argv) {
      log.push('run');
      calls.push([...argv]);
      const status = options.status ?? 0;
      if (status === 0 && (options.writesOutput ?? true)) {
        files.add(argv[argv.length - 1]);
      }
      return { status, stderr: options.stderr ?? '' };
    },
    exists: (path) => files.has(path),
    makeTempDir() {
      log.push('makeTempDir');
      return TEMP;
    },
    makeDir(path) {
      log.push(`makeDir ${path}`);
      dirs.push(path);
    },
    removePath(path) {
      log.push(`remove ${path}`);
      removed.push(path);
      files.delete(path);
    },
    tokenCss: () => TOKENS,
    async renderPngs(pages) {
      log.push('render');
      renders.push(
        pages.map(({ path, width, height, html }) => ({
          path,
          width,
          height,
          html,
        })),
      );
      if (options.renderError !== undefined) throw options.renderError;
    },
  };

  return { deps, calls, dirs, files, removed, renders, log };
}

describe('makeAnnotatedVideo: the overlay PNGs', () => {
  test('renders the band, then each side label and its strips, in one call, at the page sizes the plan implies', async () => {
    const fake = fakeAnnotate();
    await makeAnnotatedVideo(PLAN, fake.deps);

    assert.equal(fake.renders.length, 1, 'one render call');
    const [pages] = fake.renders;
    assert.deepEqual(
      pages.map(({ path }) => path),
      [BAND_PNG, BEFORE_LABEL, ...BEFORE_STRIPS, AFTER_LABEL, ...AFTER_STRIPS],
    );
    assert.deepEqual(
      pages.map(({ width, height }) => [width, height]),
      [
        [VIDEO_PANEL.width * 2, VIDEO_BAND_HEIGHT],
        [VIDEO_PANEL.width, VIDEO_LABEL_HEIGHT],
        ...BEFORE_STRIPS.map(() => [VIDEO_PANEL.width, VIDEO_STRIP_HEIGHT]),
        [VIDEO_PANEL.width, VIDEO_LABEL_HEIGHT],
        ...AFTER_STRIPS.map(() => [VIDEO_PANEL.width, VIDEO_STRIP_HEIGHT]),
      ],
    );
    assert.ok(
      pages.every(({ html }) => html.includes(TOKENS)),
      'each page carries the design tokens',
    );
  });

  test('the overlay PNGs are rendered before ffmpeg runs, and the ffmpeg argv reads exactly those paths', async () => {
    const fake = fakeAnnotate();
    await makeAnnotatedVideo(PLAN, fake.deps);

    assert.equal(fake.calls.length, 1, 'one ffmpeg run');
    const [argv] = fake.calls;
    assert.equal(argv[0], 'ffmpeg');
    assert.deepEqual(inputsOf(argv), [
      '/work/before.webm',
      '/work/after.webm',
      BAND_PNG,
      BEFORE_LABEL,
      ...BEFORE_STRIPS,
      AFTER_LABEL,
      ...AFTER_STRIPS,
    ]);
    assert.equal(argv.at(-1), ANNOTATE_OUT);
    assert.deepEqual(fake.dirs, ['/out/combined']);
    assert.ok(
      fake.log.indexOf('render') < fake.log.indexOf('run'),
      'the PNGs exist before ffmpeg reads them',
    );
  });
});

describe('makeAnnotatedVideo: outcomes', () => {
  test('a successful make leaves the MP4 and removes only the temp dir', async () => {
    const fake = fakeAnnotate();
    await makeAnnotatedVideo(PLAN, fake.deps);
    assert.equal(fake.files.has(ANNOTATE_OUT), true);
    assert.deepEqual(fake.removed, [TEMP]);
  });

  test('a render that rejects makes no ffmpeg call, rejects with that error, and removes the MP4 and the temp dir', async () => {
    const fake = fakeAnnotate({
      renderError: new Error('Chromium crashed'),
    });
    await assert.rejects(makeAnnotatedVideo(PLAN, fake.deps), {
      message: 'Chromium crashed',
    });
    assert.equal(fake.calls.length, 0, 'ffmpeg never runs');
    assert.deepEqual(fake.removed, [ANNOTATE_OUT, TEMP]);
    assert.equal(fake.files.has(ANNOTATE_OUT), false);
  });

  test('a non-zero ffmpeg rejects with its first stderr line, and removes the MP4 and the temp dir', async () => {
    const fake = fakeAnnotate({
      status: 1,
      stderr: 'Invalid data found\nmore detail',
    });
    await assert.rejects(makeAnnotatedVideo(PLAN, fake.deps), {
      message: 'ffmpeg failed to make the MP4: Invalid data found',
    });
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(fake.removed, [ANNOTATE_OUT, TEMP]);
    assert.equal(fake.files.has(ANNOTATE_OUT), false);
  });

  test('an ffmpeg that exits 0 without writing the MP4 rejects, and removes the MP4 and the temp dir', async () => {
    const fake = fakeAnnotate({ writesOutput: false });
    await assert.rejects(makeAnnotatedVideo(PLAN, fake.deps), {
      message: 'ffmpeg failed to make the MP4: it wrote no file',
    });
    assert.deepEqual(fake.removed, [ANNOTATE_OUT, TEMP]);
    assert.equal(fake.files.has(ANNOTATE_OUT), false);
  });
});

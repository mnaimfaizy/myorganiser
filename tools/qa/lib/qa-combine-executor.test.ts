// Contracts for the combine executor (ADR 0147 decision 5; PRD #1544's
// annotated MP4), run with stubbed deps: an in-memory disk, and every ffmpeg
// run and Chromium render a fake, so no process starts and no file is written.
// The pure argument lists are in qa-combine.test.ts, the overlay pages in
// video-overlay-html.test.ts, and the real ffmpeg and Chromium runs in
// ../qa-combine.real-ffmpeg.test.ts.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import {
  type AnnotateDeps,
  type CombineDeps,
  COMBINE_USAGE,
  FFMPEG_MISSING_MESSAGE,
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
import type { Band } from './storyboard.ts';

const TEMP = '/tmp/qa-combine-fake';
const TOKENS = ':root{--qa-test-token:1}';
const IMAGE_ARGS = [
  '--before',
  '/in/before.png',
  '--after',
  '/in/after.png',
  '--out',
  '/out/shot',
];
const VIDEO_ARGS = [
  '--before',
  '/in/before.mp4',
  '--after',
  '/in/after.mp4',
  '--out',
  '/out/clip',
];
const MP4_OUT = '/out/clip.mp4';
const PNG_OUT = '/out/shot.png';

interface FakeOptions {
  /** `null` = not installed; default 0. */
  ffmpegStatus?: number | null;
  /** The combine run; default 0. */
  combineStatus?: number | null;
  combineStderr?: string;
  /** Whether a successful combine run leaves its output on disk; default true. */
  combineWritesOutput?: boolean;
  /** Inputs that do not exist on disk. */
  absent?: readonly string[];
}

function fakeCombine(options: FakeOptions = {}) {
  const calls: string[][] = [];
  const files = new Set<string>();
  const removed: string[] = [];
  const dirs: string[] = [];
  const out: string[] = [];
  const err: string[] = [];

  for (const input of [
    '/in/before.png',
    '/in/after.png',
    '/in/before.mp4',
    '/in/after.mp4',
  ]) {
    if (!(options.absent ?? []).includes(input)) files.add(input);
  }

  const deps: CombineDeps = {
    run(argv) {
      calls.push([...argv]);
      if (argv.length === 2 && argv[1] === '-version') {
        const status =
          options.ffmpegStatus === undefined ? 0 : options.ffmpegStatus;
        return { status, stderr: status === 0 ? '' : 'spawn ffmpeg ENOENT' };
      }
      const status =
        options.combineStatus === undefined ? 0 : options.combineStatus;
      if (status === 0 && (options.combineWritesOutput ?? true)) {
        files.add(argv[argv.length - 1]);
      }
      return { status, stderr: options.combineStderr ?? '' };
    },
    exists: (path) => files.has(path),
    makeDir(path) {
      dirs.push(path);
    },
    removePath(path) {
      removed.push(path);
      files.delete(path);
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };

  return { deps, calls, dirs, files, removed, out, err };
}

/** The ffmpeg runs that combine a pair, not the `-version` probe. */
function combineRuns(calls: readonly string[][]): string[][] {
  return calls.filter((c) => c[1] !== '-version');
}

function inputsOf(argv: readonly string[]): string[] {
  return argv.flatMap((arg, i) => (arg === '-i' ? [argv[i + 1]] : []));
}

function valueAfter(argv: readonly string[], flag: string): string {
  return argv[argv.indexOf(flag) + 1];
}

function run(args: readonly string[], options: FakeOptions = {}) {
  const fake = fakeCombine(options);
  const code = runCombine(args, fake.deps);
  return { code, ...fake };
}

describe('runCombine: ffmpeg not installed', () => {
  for (const status of [null, 1]) {
    test(`a -version status of ${status} exits 2 with the install message and combines nothing`, () => {
      const result = run([...VIDEO_ARGS], { ffmpegStatus: status });
      assert.equal(result.code, 2);
      assert.deepEqual(result.err, [`qa:combine: ${FFMPEG_MISSING_MESSAGE}`]);
      assert.deepEqual(result.out, []);
      assert.deepEqual(result.calls, [['ffmpeg', '-version']]);
      assert.equal(result.files.has(MP4_OUT), false);
    });
  }
});

describe('runCombine: a bad invocation exits 2 before any ffmpeg call', () => {
  const cases: Array<[string, string[]]> = [
    ['a missing --after', ['--before', '/in/before.png', '--out', '/out/shot']],
    ['an unknown flag', [...IMAGE_ARGS, '--bogus', 'x']],
    ['a flag with no value', [...IMAGE_ARGS, '--height']],
    [
      'a value that looks like a flag',
      ['--before', '--after', '--out', '/out/shot'],
    ],
    ['a repeated flag', [...IMAGE_ARGS, '--before', '/in/other.png']],
    ['an odd height', [...IMAGE_ARGS, '--height', '47']],
    ['a non-numeric height', [...IMAGE_ARGS, '--height', 'tall']],
    [
      '--out with an extension',
      [
        '--before',
        '/in/before.png',
        '--after',
        '/in/after.png',
        '--out',
        '/out/shot.png',
      ],
    ],
    [
      'a mixed image and video pair',
      [
        '--before',
        '/in/before.png',
        '--after',
        '/in/after.mp4',
        '--out',
        '/out/x',
      ],
    ],
    [
      'an unknown extension',
      [
        '--before',
        '/in/before.bmp',
        '--after',
        '/in/after.png',
        '--out',
        '/out/x',
      ],
    ],
  ];
  for (const [label, args] of cases) {
    test(`${label} exits 2`, () => {
      const result = run(args);
      assert.equal(result.code, 2);
      assert.equal(result.err.length, 1);
      assert.ok(result.err[0].startsWith('qa:combine: '), result.err[0]);
      assert.deepEqual(result.calls, []);
      assert.deepEqual(result.out, []);
    });
  }

  test('a flag error reports the usage line', () => {
    const result = run(['--bogus', 'x']);
    assert.deepEqual(result.err, [`qa:combine: ${COMBINE_USAGE}`]);
  });
});

describe('runCombine: a missing input exits 2', () => {
  test('an absent after file is named and nothing runs', () => {
    const result = run([...IMAGE_ARGS], { absent: ['/in/after.png'] });
    assert.equal(result.code, 2);
    assert.deepEqual(result.err, [
      'qa:combine: input "/in/after.png" does not exist',
    ]);
    assert.deepEqual(result.calls, []);
  });
});

describe('runCombine: an image pair', () => {
  test('combines to one PNG, exits 0, and prints only the kind and the file as JSON', () => {
    const result = run([...IMAGE_ARGS, '--height', '48']);
    assert.equal(result.code, 0);
    assert.deepEqual(result.err, []);
    assert.deepEqual(result.dirs, ['/out']);
    assert.deepEqual(JSON.parse(result.out[0]), {
      kind: 'image',
      combined: PNG_OUT,
    });
    assert.equal(result.files.has(PNG_OUT), true);
  });

  test('runs one ffmpeg combine with the two inputs and no overlay or label input', () => {
    const result = run([...IMAGE_ARGS, '--height', '48']);
    const combines = combineRuns(result.calls);
    assert.equal(combines.length, 1);
    assert.deepEqual(inputsOf(combines[0]), [
      '/in/before.png',
      '/in/after.png',
    ]);
    assert.ok(combines[0].includes('-frames:v'), 'a single frame');
    assert.equal(combines[0].at(-1), PNG_OUT);
  });
});

describe('runCombine: a video pair', () => {
  test('combines to one MP4, exits 0, and prints only the kind and the file as JSON', () => {
    const result = run([...VIDEO_ARGS, '--height', '48']);
    assert.equal(result.code, 0);
    assert.deepEqual(result.dirs, ['/out']);
    assert.deepEqual(JSON.parse(result.out[0]), {
      kind: 'video',
      combined: MP4_OUT,
    });
    const combines = combineRuns(result.calls);
    assert.equal(combines.length, 1, 'one ffmpeg call');
    assert.equal(valueAfter(combines[0], '-c:v'), 'libx264');
    assert.equal(combines[0].at(-1), MP4_OUT);
  });
});

describe('runCombine: ffmpeg failures exit 1 and remove the output', () => {
  test('a non-zero combine exits 1, names the first line of stderr, and removes the output', () => {
    const result = run([...VIDEO_ARGS, '--height', '48'], {
      combineStatus: 1,
      combineStderr: 'Invalid data found\nmore detail',
    });
    assert.equal(result.code, 1);
    assert.deepEqual(result.err, [
      'qa:combine: ffmpeg failed to combine: Invalid data found',
    ]);
    assert.deepEqual(result.out, []);
    assert.equal(result.files.has(MP4_OUT), false);
    assert.ok(result.removed.includes(MP4_OUT));
  });

  test('a combine that exits 0 without writing its output is still a failure', () => {
    const result = run([...IMAGE_ARGS, '--height', '48'], {
      combineWritesOutput: false,
    });
    assert.equal(result.code, 1);
    assert.deepEqual(result.err, ['qa:combine: ffmpeg failed to combine: ']);
    assert.equal(result.files.has(PNG_OUT), false);
    assert.ok(result.removed.includes(PNG_OUT));
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
      message: 'ffmpeg failed to make the MP4: ',
    });
    assert.deepEqual(fake.removed, [ANNOTATE_OUT, TEMP]);
    assert.equal(fake.files.has(ANNOTATE_OUT), false);
  });
});

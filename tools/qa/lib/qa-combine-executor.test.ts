// Contracts for the combine executor (ADR 0147 decision 5), run through
// `runCombine` with a stubbed CombineDeps. The file system, the temp dir and
// every ffmpeg run are in-memory fakes here, so no process starts and no file
// is written. The pure argument lists are tested in qa-combine.test.ts, and
// the real ffmpeg run is in ../qa-combine.real-ffmpeg.test.ts.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import {
  type CombineDeps,
  COMBINE_USAGE,
  FFMPEG_MISSING_MESSAGE,
  runCombine,
} from './qa-combine-executor.ts';
import { GIF_LADDER, GIF_SIZE_CAP_BYTES } from './qa-combine.ts';
import { renderLabel } from './qa-label.ts';

const TEMP = '/tmp/qa-combine-fake';
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
const GIF_OUT = '/out/clip.gif';
const PNG_OUT = '/out/shot.png';
const BEFORE_LABEL = join(TEMP, 'before-label.png');
const AFTER_LABEL = join(TEMP, 'after-label.png');

interface FakeOptions {
  /** `null` = not installed; default 0. */
  ffmpegStatus?: number | null;
  /** The primary (PNG or MP4) combine run; default 0. */
  combineStatus?: number | null;
  combineStderr?: string;
  /** Whether a successful combine run leaves its output on disk; default true. */
  combineWritesOutput?: boolean;
  /** Every GIF run; default 0. */
  gifStatus?: number | null;
  gifStderr?: string;
  /** Size of the GIF each GIF run leaves, one per run; the last repeats. */
  gifSizes?: readonly number[];
  /** Inputs that do not exist on disk. */
  absent?: readonly string[];
  /** Indexes (0-based, per GIF run) whose GIF size cannot be read: fileSize is null. */
  unsizedGifRuns?: readonly number[];
}

function fakeCombine(options: FakeOptions = {}) {
  const calls: string[][] = [];
  const files = new Map<string, number>();
  const labels = new Map<string, Buffer>();
  const removed: string[] = [];
  const dirs: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let gifRuns = 0;
  let lastGifUnsized = false;

  for (const input of [
    '/in/before.png',
    '/in/after.png',
    '/in/before.mp4',
    '/in/after.mp4',
  ]) {
    if (!(options.absent ?? []).includes(input)) files.set(input, 1);
  }

  const deps: CombineDeps = {
    run(argv) {
      calls.push([...argv]);
      const output = argv[argv.length - 1];
      if (argv.length === 2 && argv[1] === '-version') {
        const status =
          options.ffmpegStatus === undefined ? 0 : options.ffmpegStatus;
        return { status, stderr: status === 0 ? '' : 'spawn ffmpeg ENOENT' };
      }
      if (argv.includes('-loop')) {
        const status = options.gifStatus === undefined ? 0 : options.gifStatus;
        if (status !== 0) {
          return { status, stderr: options.gifStderr ?? '' };
        }
        const sizes = options.gifSizes ?? [1000];
        files.set(output, sizes[Math.min(gifRuns, sizes.length - 1)]);
        lastGifUnsized = (options.unsizedGifRuns ?? []).includes(gifRuns);
        gifRuns++;
        return { status: 0, stderr: '' };
      }
      const status =
        options.combineStatus === undefined ? 0 : options.combineStatus;
      if (status === 0 && (options.combineWritesOutput ?? true)) {
        files.set(output, output.endsWith('.png') ? 2000 : 5000);
      }
      return { status, stderr: options.combineStderr ?? '' };
    },
    exists: (path) => files.has(path),
    fileSize: (path) =>
      path.endsWith('.gif') && lastGifUnsized
        ? null
        : (files.get(path) ?? null),
    makeTempDir: () => TEMP,
    makeDir(path) {
      dirs.push(path);
    },
    writeFile(path, bytes) {
      files.set(path, bytes.length);
      labels.set(path, bytes);
    },
    removePath(path) {
      removed.push(path);
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };

  return { deps, calls, dirs, files, labels, removed, out, err };
}

function combineRuns(calls: readonly string[][]): string[][] {
  return calls.filter((c) => c[1] !== '-version' && !c.includes('-loop'));
}

function gifRuns(calls: readonly string[][]): string[][] {
  return calls.filter((c) => c.includes('-loop'));
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
      assert.equal(result.files.has(GIF_OUT), false);
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
        '/in/before.gif',
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
  test('combines to one PNG, exits 0 and prints the files as JSON', () => {
    const result = run([...IMAGE_ARGS, '--height', '48']);
    assert.equal(result.code, 0);
    assert.deepEqual(result.err, []);
    assert.deepEqual(result.dirs, ['/out']);
    assert.deepEqual(JSON.parse(result.out[0]), {
      kind: 'image',
      combined: PNG_OUT,
      gif: null,
      gifBytes: null,
    });
    assert.equal(result.files.has(PNG_OUT), true);
  });

  test('runs one image combine and no GIF', () => {
    const result = run([...IMAGE_ARGS, '--height', '48']);
    const combines = combineRuns(result.calls);
    assert.equal(combines.length, 1);
    assert.ok(combines[0].includes('-frames:v'), 'single frame');
    assert.equal(combines[0].at(-1), PNG_OUT);
    assert.deepEqual(gifRuns(result.calls), []);
  });

  test('the label PNGs are written to the temp dir, match the height, and feed the combine', () => {
    const result = run([...IMAGE_ARGS, '--height', '720']);
    assert.deepEqual(
      result.labels.get(BEFORE_LABEL),
      renderLabel('BEFORE', 3).png,
    );
    assert.deepEqual(
      result.labels.get(AFTER_LABEL),
      renderLabel('AFTER', 3).png,
    );
    const [combine] = combineRuns(result.calls);
    assert.deepEqual(inputsOf(combine), [
      '/in/before.png',
      '/in/after.png',
      BEFORE_LABEL,
      AFTER_LABEL,
    ]);
    assert.ok(valueAfter(combine, '-filter_complex').includes('scale=-2:720'));
  });
});

describe('runCombine: a video pair', () => {
  test('combines to an MP4 and then makes the GIF from it on the first rung', () => {
    const result = run([...VIDEO_ARGS, '--height', '48']);
    assert.equal(result.code, 0);
    assert.deepEqual(result.dirs, ['/out']);
    assert.deepEqual(JSON.parse(result.out[0]), {
      kind: 'video',
      combined: MP4_OUT,
      gif: GIF_OUT,
      gifBytes: 1000,
    });
    const [combine] = combineRuns(result.calls);
    assert.equal(valueAfter(combine, '-c:v'), 'libx264');
    assert.equal(combine.at(-1), MP4_OUT);

    const [gif] = gifRuns(result.calls);
    assert.deepEqual(inputsOf(gif), [MP4_OUT]);
    assert.equal(gif.at(-1), GIF_OUT);
    const filter = valueAfter(gif, '-filter_complex');
    assert.ok(filter.includes(`fps=${GIF_LADDER[0].fps},`), filter);
    assert.ok(filter.includes(`min(${GIF_LADDER[0].width},iw)`), filter);
    assert.equal(gifRuns(result.calls).length, 1);
  });

  test('the MP4 combine runs before the GIF is made', () => {
    const result = run([...VIDEO_ARGS, '--height', '48']);
    const order = result.calls.map((c) =>
      c[1] === '-version' ? 'version' : c.includes('-loop') ? 'gif' : 'combine',
    );
    assert.deepEqual(order, ['version', 'combine', 'gif']);
  });
});

describe('runCombine: the GIF size cap', () => {
  test('a GIF over the cap on the first rung falls to the next rung', () => {
    const result = run([...VIDEO_ARGS, '--height', '48'], {
      gifSizes: [GIF_SIZE_CAP_BYTES + 1, GIF_SIZE_CAP_BYTES - 1],
    });
    assert.equal(result.code, 0);
    const gifs = gifRuns(result.calls);
    assert.equal(gifs.length, 2);
    const second = gifs[1].join(' ');
    assert.ok(second.includes(`fps=${GIF_LADDER[1].fps},`), second);
    assert.ok(second.includes(`min(${GIF_LADDER[1].width},iw)`), second);
    assert.equal(JSON.parse(result.out[0]).gifBytes, GIF_SIZE_CAP_BYTES - 1);
    assert.equal(result.files.get(GIF_OUT), GIF_SIZE_CAP_BYTES - 1);
  });

  test('a GIF exactly at the cap is accepted on the first rung', () => {
    const result = run([...VIDEO_ARGS, '--height', '48'], {
      gifSizes: [GIF_SIZE_CAP_BYTES],
    });
    assert.equal(result.code, 0);
    assert.equal(gifRuns(result.calls).length, 1);
    assert.equal(JSON.parse(result.out[0]).gifBytes, GIF_SIZE_CAP_BYTES);
  });

  test('a GIF over the cap on every rung exits 1 and removes both outputs', () => {
    const result = run([...VIDEO_ARGS, '--height', '48'], {
      gifSizes: [GIF_SIZE_CAP_BYTES + 1],
    });
    assert.equal(result.code, 1);
    assert.equal(gifRuns(result.calls).length, GIF_LADDER.length);
    assert.equal(result.err.length, 1);
    assert.ok(result.err[0].includes('no GIF under'), result.err[0]);
    assert.deepEqual(result.out, []);
    assert.equal(result.files.has(MP4_OUT), false);
    assert.equal(result.files.has(GIF_OUT), false);
  });

  test('a GIF size that cannot be read on every rung exits 1 and removes both outputs', () => {
    const result = run([...VIDEO_ARGS, '--height', '48'], {
      unsizedGifRuns: GIF_LADDER.map((_, i) => i),
    });
    assert.equal(result.code, 1);
    assert.equal(gifRuns(result.calls).length, GIF_LADDER.length);
    assert.equal(result.err.length, 1);
    assert.ok(result.err[0].includes('no GIF under'), result.err[0]);
    assert.deepEqual(result.out, []);
    assert.equal(result.files.has(MP4_OUT), false);
    assert.equal(result.files.has(GIF_OUT), false);
  });

  test('an unreadable GIF size on rung 1 moves on, and rung 2 that fits is kept', () => {
    const result = run([...VIDEO_ARGS, '--height', '48'], {
      gifSizes: [1000, 2222],
      unsizedGifRuns: [0],
    });
    assert.equal(result.code, 0);
    assert.equal(gifRuns(result.calls).length, 2);
    assert.ok(
      gifRuns(result.calls)[1].join(' ').includes(`fps=${GIF_LADDER[1].fps},`),
    );
    assert.equal(JSON.parse(result.out[0]).gifBytes, 2222);
  });
});

describe('runCombine: ffmpeg failures exit 1 and remove outputs', () => {
  test('a non-zero primary combine exits 1, names the first line of stderr, and removes the output', () => {
    const result = run([...VIDEO_ARGS, '--height', '48'], {
      combineStatus: 1,
      combineStderr: 'Invalid data found\nmore detail',
    });
    assert.equal(result.code, 1);
    assert.deepEqual(result.err, [
      'qa:combine: ffmpeg failed to combine: Invalid data found',
    ]);
    assert.deepEqual(gifRuns(result.calls), []);
    assert.equal(result.files.has(MP4_OUT), false);
    assert.ok(result.removed.includes(MP4_OUT));
  });

  test('a combine that exits 0 without writing its output is still a failure', () => {
    const result = run([...IMAGE_ARGS, '--height', '48'], {
      combineWritesOutput: false,
    });
    assert.equal(result.code, 1);
    assert.ok(result.err[0].startsWith('qa:combine: ffmpeg failed to combine'));
    assert.equal(result.files.has(PNG_OUT), false);
  });

  test('a non-zero GIF run exits 1 and removes the MP4 and the GIF', () => {
    const result = run([...VIDEO_ARGS, '--height', '48'], {
      gifStatus: 1,
      gifStderr: 'palette failed',
    });
    assert.equal(result.code, 1);
    assert.deepEqual(result.err, [
      'qa:combine: ffmpeg failed to make the GIF: palette failed',
    ]);
    assert.deepEqual(result.out, []);
    assert.equal(result.files.has(MP4_OUT), false);
    assert.equal(result.files.has(GIF_OUT), false);
    assert.ok(result.removed.includes(MP4_OUT));
    assert.ok(result.removed.includes(GIF_OUT));
  });
});

describe('runCombine: the temp dir is removed on every outcome', () => {
  const outcomes: Array<[string, string[], FakeOptions]> = [
    ['an image success', [...IMAGE_ARGS, '--height', '48'], {}],
    ['a video success', [...VIDEO_ARGS, '--height', '48'], {}],
    [
      'a combine failure',
      [...VIDEO_ARGS, '--height', '48'],
      { combineStatus: 1 },
    ],
    [
      'a GIF over the cap',
      [...VIDEO_ARGS, '--height', '48'],
      { gifSizes: [GIF_SIZE_CAP_BYTES + 1] },
    ],
    ['a GIF run failure', [...VIDEO_ARGS, '--height', '48'], { gifStatus: 1 }],
    [
      'a combine that exits 0 without output',
      [...VIDEO_ARGS, '--height', '48'],
      { combineWritesOutput: false },
    ],
    [
      'a GIF size that cannot be read on every rung',
      [...VIDEO_ARGS, '--height', '48'],
      { unsizedGifRuns: GIF_LADDER.map((_, i) => i) },
    ],
  ];
  for (const [label, args, options] of outcomes) {
    test(`after ${label} the label files are gone and the temp dir is removed`, () => {
      const result = run(args, options);
      assert.ok(result.removed.includes(TEMP), 'temp dir removed');
      assert.equal(result.files.has(BEFORE_LABEL), false);
      assert.equal(result.files.has(AFTER_LABEL), false);
    });
  }
});

// Real renders (PRD #1544). Every other suite stubs the browser and ffmpeg;
// these tests launch them deliberately.
//
// The Storyboard test launches Chromium, to check that the page lays out at
// 1280 px, that the PNG is written, and that the HTML work file is removed
// afterwards. Without Chromium it is skipped with a visible reason. Set
// QA_REQUIRE_REAL_RENDER=1 (CI's QA tooling step does) to make a missing
// Chromium a failure instead.
//
// The annotated MP4 test launches Chromium AND ffmpeg: it renders a
// `Capture: video` scenario's overlay PNGs in Chromium, burns them into a
// short MP4 with real ffmpeg, then probes that MP4 and samples its caption
// strip. It is gated on both dependencies: a missing Chromium or ffmpeg /
// ffprobe skips it visibly unless its QA_REQUIRE_* variable is set, and then
// the missing one fails the test. ffmpeg needs QA_REQUIRE_FFMPEG=1 (CI sets
// it).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import type { AnnotatedVideoPlan } from './lib/qa-combine.ts';
import { makeAnnotatedVideo } from './lib/qa-combine-executor.ts';
import { storyboardRenderer } from './lib/storyboard-render.ts';
import { type Storyboard, buildStoryboard } from './lib/storyboard.ts';
import { nodeAnnotateDeps } from './lib/video-overlay-render.ts';

/** tools/qa/ is two levels below the repository root. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const EXECUTABLE = chromium.executablePath();
const PRESENT = existsSync(EXECUTABLE);
const SKIP =
  PRESENT || process.env.QA_REQUIRE_REAL_RENDER
    ? false
    : "Playwright's Chromium is not installed (set QA_REQUIRE_REAL_RENDER=1 to require it)";

const MISSING_CHROMIUM = `Playwright's Chromium is required (QA_REQUIRE_REAL_RENDER is set) but not found at ${EXECUTABLE}`;

/** Writes one small real PNG per entry, each a full 1280x720 page with its label. */
async function makeStills(
  dir: string,
  stills: readonly [relative: string, label: string][],
): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    for (const [relative, label] of stills) {
      const path = join(dir, relative);
      mkdirSync(dirname(path), { recursive: true });
      await page.setContent(
        `<body style="margin:0"><h1 style="font:40px sans-serif;padding:40px">${label}</h1></body>`,
      );
      await page.screenshot({ path });
    }
  } finally {
    await browser.close();
  }
}

/** A two-column Storyboard: Before has a subject box, After has none. */
function storyboardFixture(): Storyboard {
  return buildStoryboard({
    id: 'S',
    title: 'Real render',
    expected: { before: 'the defect shows', after: 'the fix shows' },
    result: 'PASS',
    commits: { before: 'a'.repeat(40), after: 'b'.repeat(40) },
    sides: {
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [
          {
            side: 'before',
            index: 1,
            device: 'Desktop',
            tab: '',
            label: 'Device Desktop',
            caption: 'the defect',
            still: 'steps/S/before/01.png',
            subject: { x: 600, y: 300, width: 40, height: 20 },
            atMs: 0,
          },
        ],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [
          {
            side: 'after',
            index: 1,
            device: 'Desktop',
            tab: '',
            label: 'Device Desktop',
            caption: 'the fix',
            still: 'steps/S/after/01.png',
            subject: null,
            atMs: 0,
          },
        ],
      },
    },
  });
}

test(
  'renders a two-column Storyboard to a 1280 px wide PNG and removes its HTML work file',
  { skip: SKIP },
  async () => {
    assert.ok(PRESENT, MISSING_CHROMIUM);
    const dir = mkdtempSync(join(tmpdir(), 'storyboard-real-'));
    try {
      await makeStills(dir, [
        ['steps/S/before/01.png', 'Before'],
        ['steps/S/after/01.png', 'After'],
      ]);
      const png = join(dir, 'out.png');
      await storyboardRenderer(REPO_ROOT)(storyboardFixture(), dir, png);

      assert.ok(existsSync(png), 'the PNG exists');
      // A PNG's IHDR chunk holds the width at bytes 16-19 and the height at 20-23.
      const bytes = readFileSync(png);
      assert.equal(bytes.readUInt32BE(16), 1280, 'the PNG is 1280 px wide');
      assert.ok(
        bytes.readUInt32BE(20) > 300,
        `the PNG is ${bytes.readUInt32BE(20)} px high, expected more than 300`,
      );
      assert.equal(
        existsSync(`${png}.html`),
        false,
        'the HTML work file is removed',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'a render into a missing directory rejects and leaves no PNG behind',
  { skip: SKIP },
  async () => {
    assert.ok(PRESENT, MISSING_CHROMIUM);
    const dir = mkdtempSync(join(tmpdir(), 'storyboard-real-'));
    try {
      const png = join(dir, 'missing', 'out.png');
      await assert.rejects(
        storyboardRenderer(REPO_ROOT)(storyboardFixture(), dir, png),
      );
      assert.equal(existsSync(png), false, 'no PNG is left behind');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 872;
/** The caption strip is the bottom 56 px of the 1280 px wide side panel. */
const STRIP_TOP = 816;
const STRIP_HEIGHT = 56;
const STRIP_BYTES = FRAME_WIDTH * STRIP_HEIGHT * 3;
// H.264 is lossy, so a static strip is not bit-identical from frame to frame:
// on this fixture the largest one-channel change inside a window measured 4 of
// 255, and the change from the opening strip to the caption measured 252. The
// two bounds sit between those.
const ENCODER_NOISE_MAX = 16;
const CAPTION_CHANGE_MIN = 64;

interface Gap {
  /** What is missing, for the reason. */
  what: string;
  /** The variable that turns its absence into a failure. */
  variable: string;
  required: boolean;
}

const FFMPEG_MISSING = ['ffmpeg', 'ffprobe'].filter(
  (binary) =>
    spawnSync(binary, ['-version'], { encoding: 'utf8' }).status !== 0,
);

/** What the annotated MP4 test lacks. Empty when both dependencies are present. */
const ANNOTATE_GAPS: Gap[] = [
  ...(PRESENT
    ? []
    : [
        {
          what: "Playwright's Chromium",
          variable: 'QA_REQUIRE_REAL_RENDER',
          required: Boolean(process.env.QA_REQUIRE_REAL_RENDER),
        },
      ]),
  ...(FFMPEG_MISSING.length === 0
    ? []
    : [
        {
          what: FFMPEG_MISSING.join(' and '),
          variable: 'QA_REQUIRE_FFMPEG',
          required: Boolean(process.env.QA_REQUIRE_FFMPEG),
        },
      ]),
];
const REQUIRED_GAPS = ANNOTATE_GAPS.filter((gap) => gap.required);
// A required gap runs the test so that it fails with the reason. Otherwise any
// gap skips it visibly.
const ANNOTATE_SKIP: string | false =
  REQUIRED_GAPS.length > 0 || ANNOTATE_GAPS.length === 0
    ? false
    : ANNOTATE_GAPS.map(
        (gap) =>
          `${gap.what} not installed (set ${gap.variable}=1 to require it)`,
      ).join('; ');

function ffmpeg(args: string[]): void {
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', ...args],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `fixture ffmpeg failed: ${result.stderr}`);
}

/** A 2 s, 1280x720 test pattern at 25 fps, as the Before recording. */
function makeRecording(file: string): void {
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=1280x720:rate=25:duration=2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    file,
  ]);
}

/**
 * One side, one step at 1 s: the opening strip shows from 0 to 1 s, then the
 * step's caption from 1 s to the end.
 */
function annotatedPlan(recording: string, output: string): AnnotatedVideoPlan {
  const step = {
    index: 1,
    caption: 'the defect shows',
    atMs: 1000,
    device: 'Desktop',
    tab: '',
    label: 'Device Desktop',
  };
  return {
    band: {
      id: 'S',
      title: 'Annotated MP4',
      result: 'PASS',
      commits: { before: 'a'.repeat(40), after: 'b'.repeat(40) },
    },
    sides: [
      {
        side: 'before',
        video: recording,
        device: 'Desktop',
        tab: '',
        label: 'Device Desktop',
        openedAtMs: 0,
        steps: [step],
      },
    ],
    output,
  };
}

/** The codec and size of the first video stream. */
function probeVideo(file: string): string[] {
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,width,height',
      '-of',
      'csv=p=0',
      file,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `ffprobe failed: ${result.stderr}`);
  return result.stdout.trim().split(',');
}

/** The largest difference in any one byte of two equal-length RGB24 strips. */
function largestDelta(a: Buffer, b: Buffer): number {
  let largest = 0;
  for (let i = 0; i < a.length; i += 1) {
    largest = Math.max(largest, Math.abs(a[i] - b[i]));
  }
  return largest;
}

/** The caption strip of the frame at `seconds`, as raw RGB24 bytes. */
function stripAt(file: string, seconds: number): Buffer {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-ss',
      seconds.toFixed(3),
      '-frames:v',
      '1',
      '-vf',
      `crop=${FRAME_WIDTH}:${STRIP_HEIGHT}:0:${STRIP_TOP}`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, `frame extraction failed: ${result.stderr}`);
  assert.equal(result.stdout.length, STRIP_BYTES, `a strip at ${seconds} s`);
  return result.stdout;
}

test(
  "burns a step's caption into a short annotated MP4 at its timestamp with real ffmpeg",
  { skip: ANNOTATE_SKIP },
  async () => {
    assert.equal(
      REQUIRED_GAPS.length,
      0,
      REQUIRED_GAPS.map(
        (gap) => `${gap.what} required (${gap.variable} is set) but not found`,
      ).join('; '),
    );
    const dir = mkdtempSync(join(tmpdir(), 'annotated-real-'));
    // The overlay root is isolated to this test, so concurrent runs in the same
    // TMPDIR cannot interfere with what it finds in it.
    const overlays = mkdtempSync(join(tmpdir(), 'annotated-overlays-'));
    try {
      const recording = join(dir, 'before.mp4');
      const output = join(dir, 'annotated.mp4');
      makeRecording(recording);
      // Wraps the real temp-dir maker to prove the overlay dir is made under
      // `overlays`: an implementation that ignored tempRoot would fail here.
      const real = nodeAnnotateDeps(REPO_ROOT, overlays);
      const made: string[] = [];
      await makeAnnotatedVideo(annotatedPlan(recording, output), {
        ...real,
        makeTempDir: () => {
          const created = real.makeTempDir();
          made.push(created);
          return created;
        },
      });

      assert.equal(made.length, 1, 'one overlay directory is made');
      assert.equal(
        dirname(made[0]),
        overlays,
        'the overlay directory is made under the overlay root',
      );
      assert.deepEqual(
        readdirSync(overlays),
        [],
        'no overlay directory is left in the overlay root',
      );
      assert.ok(existsSync(output), 'the annotated MP4 exists');
      assert.deepEqual(
        probeVideo(output),
        ['h264', String(FRAME_WIDTH), String(FRAME_HEIGHT)],
        'an H.264 MP4, 1280 px wide for one side and 872 px high',
      );
      // The opening strip is on screen at 0.5 s; the caption strip at 1.5 s.
      const opening = stripAt(output, 0.5);
      const caption = stripAt(output, 1.5);
      assert.ok(
        largestDelta(opening, caption) >= CAPTION_CHANGE_MIN,
        'the caption strip at 1.5 s differs from the opening strip at 0.5 s',
      );
      // Two frames inside the caption window show the same strip to within
      // encoder noise, so the change above is the caption, not noise.
      assert.ok(
        largestDelta(stripAt(output, 1.2), stripAt(output, 1.8)) <=
          ENCODER_NOISE_MAX,
        'two frames inside the caption window show the same strip',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(overlays, { recursive: true, force: true });
    }
  },
);

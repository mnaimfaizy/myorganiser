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

import {
  type AnnotatedVideoPlan,
  type VideoSide,
  VIDEO_BAND_HEIGHT,
  VIDEO_FPS,
  VIDEO_PANEL,
  VIDEO_PLAYBACK_SPEED,
  VIDEO_STEP_HOLD_SECONDS,
  VIDEO_STRIP_HEIGHT,
  durationFromPackets,
  pacedTimeline,
  probeDurationArgs,
} from './lib/qa-combine.ts';
import { makeAnnotatedVideo } from './lib/qa-combine-executor.ts';
import { readTokenCss } from './lib/storyboard-palette.ts';
import { storyboardRenderer } from './lib/storyboard-render.ts';
import { type Storyboard, buildStoryboard } from './lib/storyboard.ts';
import { nodeAnnotateDeps } from './lib/video-overlay-render.ts';
import { videoOverlayPages } from './lib/video-overlay-html.ts';

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

const FRAME_WIDTH = VIDEO_PANEL.width;
/** One side's frame: the band over the side's panel, with its caption strip under the panel. */
const FRAME_HEIGHT =
  VIDEO_BAND_HEIGHT + VIDEO_PANEL.height + VIDEO_STRIP_HEIGHT;
/** The caption strip is the bottom VIDEO_STRIP_HEIGHT px of the frame, under the band and the panel. */
const STRIP_TOP = VIDEO_BAND_HEIGHT + VIDEO_PANEL.height;
const STRIP_HEIGHT = VIDEO_STRIP_HEIGHT;
const STRIP_BYTES = FRAME_WIDTH * STRIP_HEIGHT * 3;
// H.264 is lossy, so the same strip is not bit-identical across frames or across
// encodes. ENCODER_NOISE_MAX is the per-byte bound that `overNoiseShare` counts
// bytes against. Measured on this fixture: two frames of one MP4 differ by at
// most 2 of 255, two separate encodes of the opening strip by at most 5, and two
// separate encodes of the caption by up to 28 at a few glyph edges. The change
// from the opening strip to the caption measured 252; CAPTION_CHANGE_MIN sits
// between that and the noise.
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

/** The Before recording's length in seconds, as `makeRecording` writes it. */
const RECORDING_SECONDS = 2;

/** A 2 s, 1280x720 test pattern at 25 fps, as the Before recording. */
function makeRecording(file: string): void {
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=1280x720:rate=25:duration=${RECORDING_SECONDS}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    file,
  ]);
}

/**
 * One side, one step at 1 s of its recording. On the paced timeline the opening
 * strip shows until the step's hold, and the step's caption holds for
 * VIDEO_STEP_HOLD_SECONDS from there; the sample times are worked out from it.
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

/** One frame, in seconds. */
const FRAME = 1 / VIDEO_FPS;

/**
 * A file's length in seconds, read from its packet times the way the executor
 * reads a recording (`durationFromPackets`), so the paced timeline is built from
 * the same measure the MP4 is.
 */
function probeSeconds(file: string): number {
  const result = spawnSync('ffprobe', probeDurationArgs(file), {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `ffprobe failed: ${result.stderr}`);
  const seconds = durationFromPackets(result.stdout);
  assert.ok(seconds !== null, 'ffprobe printed packet times');
  return seconds;
}

/** The largest difference in any one byte of two equal-length RGB24 strips. */
function largestDelta(a: Buffer, b: Buffer): number {
  let largest = 0;
  for (let i = 0; i < a.length; i += 1) {
    largest = Math.max(largest, Math.abs(a[i] - b[i]));
  }
  return largest;
}

/**
 * Reference matches (a strip against a reference MP4's strip) use these instead
 * of the largest difference. The two MP4s are encoded separately, so a few
 * bytes at glyph edges differ by up to 28 (measured) with the same caption on
 * screen, and that is quantisation, not a different strip. On the measured
 * strips the mean difference is 0.37 and the bytes over ENCODER_NOISE_MAX are
 * about 0.01 to 0.02% of the strip.
 */
const REFERENCE_MEAN_DELTA_MAX = 1;
const REFERENCE_OVER_SHARE_MAX = 0.005;

/** The mean difference per byte of two equal-length RGB24 strips. */
function meanDelta(a: Buffer, b: Buffer): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length;
}

/** The share of bytes in two equal-length RGB24 strips that differ by more than ENCODER_NOISE_MAX. */
function overNoiseShare(a: Buffer, b: Buffer): number {
  let over = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > ENCODER_NOISE_MAX) over += 1;
  }
  return over / a.length;
}

/**
 * Whether a strip is the reference strip, to within encoder quantisation: a
 * small mean difference and a tiny share of bytes past ENCODER_NOISE_MAX. A
 * different strip fails it: the test's self-checks assert that an opening strip
 * and an all-black strip each fail it against the caption reference.
 */
function matchesReference(a: Buffer, b: Buffer): boolean {
  return (
    meanDelta(a, b) <= REFERENCE_MEAN_DELTA_MAX &&
    overNoiseShare(a, b) <= REFERENCE_OVER_SHARE_MAX
  );
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
  "a real annotated MP4 shows the opening strip until a step's paced hold, then that step's caption strip",
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
      const reference = join(dir, 'reference.mp4');
      makeRecording(recording);
      const real = nodeAnnotateDeps(REPO_ROOT, overlays);
      const plan = annotatedPlan(recording, output);
      // The recording's length as ffprobe reads it, which the executor paces the MP4 from.
      const probed = probeSeconds(recording);
      assert.ok(
        Math.abs(probed - RECORDING_SECONDS) <= FRAME,
        `the recording is ${probed} s; makeRecording wrote ${RECORDING_SECONDS} s`,
      );
      const timeline = pacedTimeline(plan.sides, [probed]);
      const [opening, caption] = timeline.sides[0].windows;
      const holdStart = timeline.holdStarts[0];
      // 1 s of recording at the playback speed: the lead before the step is
      // 1 / VIDEO_PLAYBACK_SPEED seconds, and the step's hold starts after it.
      assert.ok(
        Math.abs(holdStart - 1 / VIDEO_PLAYBACK_SPEED) < 0.01,
        `the hold starts at ${holdStart} s`,
      );
      assert.equal(
        opening.end,
        holdStart,
        'the opening strip runs to the hold',
      );
      assert.equal(caption.start, holdStart, 'the caption starts at the hold');
      // Samples: the opening strip mid-way to its end, just before the hold, and
      // two points inside the caption's hold.
      const openingAt = holdStart / 2;
      const beforeHold = holdStart - 0.15;
      const captionFirst = holdStart + VIDEO_STEP_HOLD_SECONDS / 3;
      const captionSecond = holdStart + (2 * VIDEO_STEP_HOLD_SECONDS) / 3;
      // A reference MP4 of the same side with no steps: its one strip is the
      // opening strip, shown to the end, so it is the caption-free strip.
      await makeAnnotatedVideo(
        {
          ...plan,
          sides: [{ ...plan.sides[0], steps: [] }],
          output: reference,
        },
        real,
      );
      const captionFree = stripAt(reference, openingAt);
      // A reference MP4 of the same step taken at 0: the timeline drops the
      // opening strip, so the step's caption strip shows throughout, and its
      // strip at the caption sample is the caption strip.
      const captionReference = join(dir, 'caption-reference.mp4');
      await makeAnnotatedVideo(
        {
          ...plan,
          sides: [
            {
              ...plan.sides[0],
              steps: plan.sides[0].steps.map((step) => ({ ...step, atMs: 0 })),
            },
          ],
          output: captionReference,
        },
        real,
      );
      const captionRef = stripAt(captionReference, captionFirst);
      // Wraps the real temp-dir maker to prove the overlay dir is made under
      // `overlays`: an implementation that ignored tempRoot would fail here.
      const made: string[] = [];
      await makeAnnotatedVideo(plan, {
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
        `an H.264 MP4, ${FRAME_WIDTH} px wide for one side and ${FRAME_HEIGHT} px high`,
      );
      // The opening strip is on screen before the hold: the frame matches the
      // caption-free reference, both just before the hold and mid-way to it.
      assert.ok(
        matchesReference(stripAt(output, openingAt), captionFree),
        `the strip at ${openingAt.toFixed(2)} s is the opening strip`,
      );
      assert.ok(
        matchesReference(stripAt(output, beforeHold), captionFree),
        `the strip at ${beforeHold.toFixed(2)} s, before the hold, is still the opening strip`,
      );
      // The strip after the hold is the step's caption strip, matched against
      // the caption reference; the caption differs from the opening strip too.
      // The self-check: the opening strip fails the same reference match, so the
      // thresholds above separate the caption from the opening strip.
      assert.equal(
        matchesReference(stripAt(output, openingAt), captionRef),
        false,
        'the opening strip does not match the caption reference',
      );
      // A black strip is nothing like the caption either: an all-zero strip of the
      // same size fails the same reference match, with no render needed.
      assert.equal(
        matchesReference(Buffer.alloc(STRIP_BYTES), captionRef),
        false,
        'an all-black strip does not match the caption reference',
      );
      const afterHold = stripAt(output, captionFirst);
      assert.ok(
        matchesReference(afterHold, captionRef),
        `the strip after the hold is the step's caption strip (mean delta ${meanDelta(afterHold, captionRef).toFixed(2)}, bytes over ${ENCODER_NOISE_MAX} ${(overNoiseShare(afterHold, captionRef) * 100).toFixed(3)}%)`,
      );
      assert.ok(
        largestDelta(stripAt(output, captionFirst), captionFree) >=
          CAPTION_CHANGE_MIN,
        `the strip at ${captionFirst.toFixed(2)} s is the caption, not the opening strip`,
      );
      // One frame after the hold is already the caption, so the onset is bounded
      // to (holdStart - 0.15 s, holdStart + one frame].
      const oneFrameAfter = stripAt(output, holdStart + FRAME);
      assert.ok(
        matchesReference(oneFrameAfter, captionRef),
        `the strip at ${(holdStart + FRAME).toFixed(3)} s, one frame after the hold, is the caption (mean delta ${meanDelta(oneFrameAfter, captionRef).toFixed(2)}, bytes over ${ENCODER_NOISE_MAX} ${(overNoiseShare(oneFrameAfter, captionRef) * 100).toFixed(3)}%)`,
      );
      // A second frame inside the caption window is the caption too. It is matched
      // against the caption reference, not against the first frame by max-delta:
      // a frame-to-frame max is encoder-sensitive, and the reference match is not.
      const captionSecondStrip = stripAt(output, captionSecond);
      assert.ok(
        matchesReference(captionSecondStrip, captionRef),
        `the strip at ${captionSecond.toFixed(2)} s, inside the caption window, is the caption (mean delta ${meanDelta(captionSecondStrip, captionRef).toFixed(2)}, bytes over ${ENCODER_NOISE_MAX} ${(overNoiseShare(captionSecondStrip, captionRef) * 100).toFixed(3)}%)`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(overlays, { recursive: true, force: true });
    }
  },
);

/** A caption long enough to need most of a strip's width, with no markup in it. */
const LONG_CAPTION =
  'open the saved item, check every field against the form, then wait for the confirmation to appear before leaving the page';

/** The run's wall clock start: 2 January 2026, 03:04:05 UTC. */
const CLOCK_START = Date.UTC(2026, 0, 2, 3, 4, 5);

/** What the caption strip's layout reads back in Chromium. */
interface StripLayout {
  caption: string | null;
  captionTruncated: boolean;
  timing: string | null;
  lines: number;
}

test(
  'a real annotated MP4 writes a step clock and elapsed time on its caption strip, and keeps a long caption whole on its own line',
  { skip: ANNOTATE_SKIP },
  async () => {
    assert.equal(
      REQUIRED_GAPS.length,
      0,
      REQUIRED_GAPS.map(
        (gap) => `${gap.what} required (${gap.variable} is set) but not found`,
      ).join('; '),
    );
    const dir = mkdtempSync(join(tmpdir(), 'annotated-timing-real-'));
    const overlays = mkdtempSync(join(tmpdir(), 'annotated-timing-overlays-'));
    try {
      const recording = join(dir, 'before.mp4');
      const output = join(dir, 'annotated.mp4');
      const noClock = join(dir, 'no-clock.mp4');
      makeRecording(recording);
      const real = nodeAnnotateDeps(REPO_ROOT, overlays);
      const base = annotatedPlan(recording, output);
      const [side] = base.sides;
      // The plan pins its zone, so the clock reads the same on every machine,
      // and the step's caption is the long one.
      const plan: AnnotatedVideoPlan = {
        ...base,
        timeZone: 'UTC',
        sides: [
          {
            ...side,
            startedAtMs: CLOCK_START,
            steps: side.steps.map((step) => ({
              ...step,
              caption: LONG_CAPTION,
            })),
          },
        ],
      };
      const probed = probeSeconds(recording);
      const timeline = pacedTimeline(plan.sides, [probed]);
      const holdStart = timeline.holdStarts[0];
      const captionFirst = holdStart + VIDEO_STEP_HOLD_SECONDS / 3;

      // The strip's layout, in Chromium: the caption is the whole text on a line
      // of its own (no ellipsis), and the timing is a second line. The step is
      // at 1 s, so its clock is 03:04:06 UTC, 1.0 s on.
      const strip = videoOverlayPages(plan, readTokenCss(REPO_ROOT), timeline)
        .sides[0]?.strips[1];
      assert.ok(strip, 'the step has a caption strip');
      const browser = await chromium.launch();
      let layout: StripLayout;
      try {
        const page = await browser.newPage({
          viewport: { width: strip.width, height: strip.height },
        });
        await page.setContent(strip.html, { waitUntil: 'load' });
        layout = (await page.evaluate(`(() => {
          const caption = document.querySelector('.strip .caption');
          const timing = document.querySelector('.strip .timing');
          return {
            caption: caption ? caption.textContent : null,
            captionTruncated: caption ? caption.scrollWidth > caption.clientWidth : true,
            timing: timing ? timing.textContent : null,
            lines: document.querySelectorAll('.strip .line').length,
          };
        })()`)) as StripLayout;
        await page.close();
      } finally {
        await browser.close();
      }
      assert.equal(layout.caption, LONG_CAPTION, 'the whole caption is shown');
      assert.equal(
        layout.captionTruncated,
        false,
        'the caption fits its line, with no ellipsis',
      );
      assert.equal(
        layout.timing,
        '03:04:06 UTC · 0:01.0 elapsed',
        'the timing line reads the clock in the plan zone, then the elapsed time',
      );
      assert.equal(layout.lines, 2, 'the caption and the timing are two lines');

      await makeAnnotatedVideo(plan, real);
      assert.ok(existsSync(output), 'the annotated MP4 exists');
      assert.deepEqual(
        probeVideo(output),
        ['h264', String(FRAME_WIDTH), String(FRAME_HEIGHT)],
        `an H.264 MP4, ${FRAME_WIDTH} px wide and ${FRAME_HEIGHT} px high, with the strip two lines deep`,
      );
      // The same plan with no clock start: the note stands where the clock is,
      // and everything else on the strip is the same. During the hold, the
      // strip with the clock differs from it, which shows the clock is drawn.
      const withoutClock: VideoSide = {
        ...plan.sides[0],
        startedAtMs: undefined,
      };
      await makeAnnotatedVideo(
        { ...plan, sides: [withoutClock], output: noClock },
        real,
      );
      assert.ok(
        largestDelta(
          stripAt(output, captionFirst),
          stripAt(noClock, captionFirst),
        ) >= CAPTION_CHANGE_MIN,
        `the strip at ${captionFirst.toFixed(2)} s, during the hold, shows the clock where the no-clock strip shows the note`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(overlays, { recursive: true, force: true });
    }
  },
);

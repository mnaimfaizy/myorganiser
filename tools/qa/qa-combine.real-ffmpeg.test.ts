// One end-to-end check that `qa:combine` re-renders a scenario from a run
// folder with the real Chromium and the real ffmpeg (PRD #1550), and that the
// annotated MP4 is paced to its timeline (PRD #1544, #1555). The run folder
// is written with ffmpeg and the step records by hand, the CLI runs as a
// subprocess so its real wiring is what runs, and the outputs are probed with
// ffprobe and read as a PNG. Every other suite stubs both.
//
// It needs both dependencies, and each is gated the way its suite is: a missing
// Chromium skips visibly unless QA_REQUIRE_REAL_RENDER is set, and a missing
// ffmpeg or ffprobe skips unless QA_REQUIRE_FFMPEG is set (CI sets both). When a
// required one is missing the test fails with the reason.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

import type { RunContext } from './lib/storyboard-context.ts';
import {
  type AnnotatedVideoPlan,
  type VideoSide,
  type VideoStep,
  VIDEO_BAND_HEIGHT,
  VIDEO_PANEL,
  VIDEO_PLAYBACK_SPEED,
  VIDEO_STEP_HOLD_SECONDS,
  VIDEO_STRIP_HEIGHT,
  pacedTimeline,
} from './lib/qa-combine.ts';
import { readTokenCss } from './lib/storyboard-palette.ts';
import { videoOverlayPages } from './lib/video-overlay-html.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'qa-combine.ts');
/** tools/qa/ is two levels below the repository root. */
const REPO_ROOT = join(HERE, '..', '..');

/**
 * A caption long enough to need most of a strip's width, with no markup in it.
 * The MP4 must still show it whole under the clock and elapsed-time line.
 */
const LONG_CAPTION =
  'open the saved item, check every field against the form, then wait for the confirmation to appear before leaving the page';

/**
 * The Before run's wall clock start: 2 January 2026, 03:04:05 UTC (After's is
 * 1 s later). The CLI is run with TZ=UTC, so the clock reads in UTC.
 */
const CLOCK_START = Date.UTC(2026, 0, 2, 3, 4, 5);

function binaryAvailable(binary: string): boolean {
  return spawnSync(binary, ['-version'], { encoding: 'utf8' }).status === 0;
}

interface Gap {
  /** What is missing, for the reason. */
  what: string;
  /** The variable that turns its absence into a failure. */
  variable: string;
}

const GAPS: Gap[] = [
  ...(existsSync(chromium.executablePath())
    ? []
    : [{ what: "Playwright's Chromium", variable: 'QA_REQUIRE_REAL_RENDER' }]),
  ...(['ffmpeg', 'ffprobe'].every(binaryAvailable)
    ? []
    : [{ what: 'ffmpeg and ffprobe', variable: 'QA_REQUIRE_FFMPEG' }]),
];
const REQUIRED = GAPS.filter((gap) => process.env[gap.variable]);
// A required gap runs the test so that it fails with the reason; any other gap
// skips it visibly.
const SKIP: string | false =
  GAPS.length === 0 || REQUIRED.length > 0
    ? false
    : GAPS.map(
        (gap) =>
          `${gap.what} not installed (set ${gap.variable}=1 to require it)`,
      ).join('; ');

/**
 * Each side's recording length in seconds, and the times of its two steps in
 * milliseconds from the recording's start. The sides differ in both, so the
 * pacing has to line the steps up on one output time.
 */
const FIXTURE = {
  before: { seconds: 2, stepsMs: [500, 1500] },
  after: { seconds: 1.5, stepsMs: [250, 1000] },
} as const;

/**
 * How far the MP4's length may be from the paced timeline's, in seconds. A
 * recording is measured by its packets, which end a frame or so short of its
 * length, so the measured lengths sit a little under the fixture's.
 */
const PACED_TOLERANCE_SECONDS = 0.3;

/**
 * The paced MP4's length for the fixture, from the constants and the fixture's
 * lengths and step times: a lead before step 1, a hold for each step, and the
 * stretches between and after the steps. Each stretch is as long as the longer
 * side's segment, and every segment plays slowed by the playback speed.
 */
function expectedPacedSeconds(): number {
  const slow = (seconds: number) => seconds / VIDEO_PLAYBACK_SPEED;
  const [b1, b2] = FIXTURE.before.stepsMs.map((ms) => ms / 1000);
  const [a1, a2] = FIXTURE.after.stepsMs.map((ms) => ms / 1000);
  const lead = slow(Math.max(b1, a1));
  const middle = slow(Math.max(b2 - b1, a2 - a1));
  const tail = slow(
    Math.max(FIXTURE.before.seconds - b2, FIXTURE.after.seconds - a2),
  );
  return (
    lead +
    FIXTURE.before.stepsMs.length * VIDEO_STEP_HOLD_SECONDS +
    middle +
    tail
  );
}

function ffmpeg(args: string[]): void {
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', ...args],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `fixture ffmpeg failed: ${result.stderr}`);
}

/** A test pattern of the given width, 48 px high, `seconds` long, at 10 fps. */
function testPattern(width: number, seconds = 1): string[] {
  return [
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=${width}x48:rate=10:duration=${seconds}`,
  ];
}

function probeSize(file: string): number[] {
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      file,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `ffprobe failed: ${result.stderr}`);
  return result.stdout.trim().split(',').map(Number);
}

/** A file's length in seconds, as its container reports it. */
function probeSeconds(file: string): number {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `ffprobe failed: ${result.stderr}`);
  return Number.parseFloat(result.stdout);
}

/** One step as `qa:run` saves it, its still relative to the run folder; `atMs` from the recording's start. */
function savedStep(
  side: 'before' | 'after',
  index: number,
  caption: string,
  atMs: number,
) {
  return {
    side,
    index,
    device: 'A',
    tab: 'A',
    label: 'Device A',
    caption,
    still: `steps/S/${side}/0${index}.png`,
    subject: null,
    atMs,
  };
}

test(
  'qa:combine re-renders a video scenario from its run folder: the Storyboard PNG and the paced annotated MP4 land in combined/',
  { skip: SKIP },
  () => {
    assert.equal(
      REQUIRED.length,
      0,
      REQUIRED.map(
        (gap) => `${gap.what} required (${gap.variable} is set) but not found`,
      ).join('; '),
    );
    const run = mkdtempSync(join(tmpdir(), 'qa-combine-run-'));
    try {
      for (const side of ['before', 'after'] as const) {
        for (const index of [1, 2]) {
          const still = join(run, 'steps', 'S', side, `0${index}.png`);
          mkdirSync(dirname(still), { recursive: true });
          ffmpeg([...testPattern(320), '-frames:v', '1', still]);
        }
        // The recording is named as `qa:run` names it. ffmpeg picks a WebM muxer
        // by the name, which cannot hold H.264, so the MP4 muxer is forced; the
        // annotated MP4 reads the file by its content, which is all it needs.
        const recording = join(run, side, 'S.webm');
        mkdirSync(dirname(recording), { recursive: true });
        ffmpeg([
          ...testPattern(320, FIXTURE[side].seconds),
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-f',
          'mp4',
          recording,
        ]);
      }
      writeFileSync(
        join(run, 'steps', 'S.json'),
        JSON.stringify({
          id: 'S',
          capture: 'video',
          title: 'Real re-render',
          expected: { before: 'the defect shows', after: 'the fix shows' },
          commits: { before: 'a'.repeat(40), after: 'b'.repeat(40) },
          sides: {
            before: {
              outcome: 'fail',
              message: 'the defect shows here',
              steps: [
                savedStep(
                  'before',
                  1,
                  'open the form',
                  FIXTURE.before.stepsMs[0],
                ),
                savedStep('before', 2, LONG_CAPTION, FIXTURE.before.stepsMs[1]),
              ],
            },
            after: {
              outcome: 'pass',
              observed: 'the fix shows here',
              steps: [
                savedStep(
                  'after',
                  1,
                  'open the form',
                  FIXTURE.after.stepsMs[0],
                ),
                savedStep(
                  'after',
                  2,
                  'the fix shows',
                  FIXTURE.after.stepsMs[1],
                ),
              ],
            },
          },
          video: {
            tab: 'A',
            sides: {
              before: {
                device: 'A',
                tab: 'A',
                label: 'Device A',
                openedAtMs: 0,
                startedAtMs: CLOCK_START,
              },
              after: {
                device: 'A',
                tab: 'A',
                label: 'Device A',
                openedAtMs: 0,
                startedAtMs: CLOCK_START + 1000,
              },
            },
          },
        }),
      );
      writeFileSync(
        join(run, 'run.json'),
        JSON.stringify({
          headline: 'QA passed',
          scenarios: [{ id: 'S', result: 'PASS' }],
        }),
      );

      // qa:combine has no zone flag, so the clock is written in the machine's
      // zone: TZ=UTC pins it here. The text itself is checked on a plan that
      // pins its zone, in storyboard.real-render.test.ts.
      const combine = spawnSync(
        process.execPath,
        [CLI, '--run', run, '--scenario', 'S'],
        { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } },
      );
      assert.equal(combine.status, 0, combine.stderr);
      const png = join(run, 'combined', 'S.png');
      const mp4 = join(run, 'combined', 'S.mp4');
      assert.deepEqual(JSON.parse(combine.stdout), {
        scenario: 'S',
        combined: [png, mp4],
      });
      assert.deepEqual(
        readdirSync(join(run, 'combined')).sort(),
        ['S.mp4', 'S.png'],
        'no temp file is left beside the combined files',
      );
      // A PNG's IHDR chunk holds the width at bytes 16-19.
      assert.equal(
        readFileSync(png).readUInt32BE(16),
        1280,
        'the Storyboard is 1280 px wide',
      );
      // Two panels side by side, under the band, with the caption strip under
      // each panel: the strip is two lines (caption, then timing).
      assert.deepEqual(probeSize(mp4), [
        VIDEO_PANEL.width * 2,
        VIDEO_BAND_HEIGHT + VIDEO_PANEL.height + VIDEO_STRIP_HEIGHT,
      ]);
      // Paced, not the recordings' own lengths: the MP4 is as long as the paced
      // timeline of the fixture, which is longer than either recording.
      const seconds = probeSeconds(mp4);
      const expected = expectedPacedSeconds();
      assert.ok(
        Math.abs(seconds - expected) <= PACED_TOLERANCE_SECONDS,
        `the MP4 is ${seconds.toFixed(2)} s; the paced timeline is ${expected.toFixed(2)} s`,
      );
    } finally {
      rmSync(run, { recursive: true, force: true });
    }
  },
);

/** One step of a side's MP4 band fixture, on `device`'s `tab`, `atMs` from the recording's start. */
function bandStep(
  index: number,
  device: string,
  tab: string,
  atMs: number,
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

/**
 * Renders the band overlay page of a one-side annotated MP4 (the narrowest MP4,
 * one panel wide) in Chromium for `context`, and measures its context line.
 * `steps` are the side's steps; the page is never written anywhere but `dir`.
 */
async function measureMp4Band(
  dir: string,
  context: RunContext,
  steps: VideoStep[],
) {
  const side: VideoSide = {
    side: 'before',
    video: join(dir, 'before.webm'),
    device: 'A',
    tab: 'A1',
    label: 'Device A · tab A1',
    openedAtMs: 0,
    steps,
  };
  const plan: AnnotatedVideoPlan = {
    band: {
      id: 'S',
      title: 'Band context',
      result: 'PASS',
      commits: { before: 'a'.repeat(40), after: 'b'.repeat(40) },
      context,
    },
    sides: [side],
    output: join(dir, 'annotated.mp4'),
  };
  const pages = videoOverlayPages(
    plan,
    readTokenCss(REPO_ROOT),
    pacedTimeline(plan.sides, [3]),
  );
  const bandPath = join(dir, 'band.html');
  writeFileSync(bandPath, pages.band.html);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: pages.band.width, height: pages.band.height },
    });
    await page.goto(pathToFileURL(bandPath).href, { waitUntil: 'load' });
    // A string, not a function: this package's tsconfig has no DOM lib.
    const measured = (await page.evaluate(`(() => {
      const band = document.querySelector('.band');
      const line = document.querySelector('.band .context');
      if (!band || !line) return null;
      const range = document.createRange();
      range.selectNodeContents(line);
      return {
        text: line.textContent,
        lineBoxes: range.getClientRects().length,
        lineScrollWidth: line.scrollWidth,
        lineClientWidth: line.clientWidth,
        lineRight: line.getBoundingClientRect().right,
        viewportWidth: window.innerWidth,
        contentBottom: Math.max(
          ...[...band.children].map((child) => child.getBoundingClientRect().bottom),
        ),
      };
    })()`)) as {
      text: string | null;
      lineBoxes: number;
      lineScrollWidth: number;
      lineClientWidth: number;
      lineRight: number;
      viewportWidth: number;
      contentBottom: number;
    } | null;
    assert.ok(measured, 'the band has a context line');
    return measured;
  } finally {
    await browser.close();
  }
}

test(
  'the MP4 band overlay (measured in Chromium) puts a run of three devices and four tabs on a single line that is not cut off',
  { skip: SKIP },
  async () => {
    assert.equal(
      REQUIRED.length,
      0,
      REQUIRED.map(
        (gap) => `${gap.what} required (${gap.variable} is set) but not found`,
      ).join('; '),
    );
    assert.equal(VIDEO_BAND_HEIGHT, 112);
    const dir = mkdtempSync(join(tmpdir(), 'qa-band-context-'));
    try {
      const measured = await measureMp4Band(
        dir,
        {
          changeKind: 'fix',
          accounts: ['primary', 'secondary'],
          devices: ['A', 'B', 'C'],
          tabs: ['A1', 'B1', 'B2', 'C1'],
        },
        [
          bandStep(1, 'A', 'A1', 500),
          bandStep(2, 'B', 'B1', 1000),
          bandStep(3, 'B', 'B2', 1500),
          bandStep(4, 'C', 'C1', 2000),
        ],
      );
      assert.equal(
        measured.text,
        'Fix · QA Accounts primary, secondary · devices A, B, C (tabs A1, B1, B2, C1)',
      );
      assert.equal(measured.lineBoxes, 1, 'the line is one line box');
      assert.ok(
        measured.lineScrollWidth <= measured.lineClientWidth,
        `the line is not cut off (${measured.lineScrollWidth} px of text in ${measured.lineClientWidth} px)`,
      );
      assert.ok(
        measured.lineRight <= measured.viewportWidth,
        'the line stays within the MP4 width',
      );
      assert.ok(
        measured.contentBottom <= VIDEO_BAND_HEIGHT,
        `the band's content ends at ${measured.contentBottom} px, within ${VIDEO_BAND_HEIGHT} px`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'the MP4 band overlay (measured in Chromium) names a fix on devices A and B with tabs B1 and B2 and one account, exactly, on a single line',
  { skip: SKIP },
  async () => {
    assert.equal(
      REQUIRED.length,
      0,
      REQUIRED.map(
        (gap) => `${gap.what} required (${gap.variable} is set) but not found`,
      ).join('; '),
    );
    assert.equal(VIDEO_BAND_HEIGHT, 112);
    const dir = mkdtempSync(join(tmpdir(), 'qa-band-context-'));
    try {
      const measured = await measureMp4Band(
        dir,
        {
          changeKind: 'fix',
          accounts: ['primary'],
          devices: ['A', 'B'],
          tabs: ['B1', 'B2'],
        },
        [
          bandStep(1, 'A', 'A1', 500),
          bandStep(2, 'B', 'B1', 1000),
          bandStep(3, 'B', 'B2', 1500),
        ],
      );
      assert.equal(
        measured.text,
        'Fix · QA Account primary · devices A, B (tabs B1, B2)',
      );
      assert.equal(measured.lineBoxes, 1, 'the line is one line box');
      assert.ok(
        measured.lineScrollWidth <= measured.lineClientWidth,
        `the line is not cut off (${measured.lineScrollWidth} px of text in ${measured.lineClientWidth} px)`,
      );
      assert.ok(
        measured.contentBottom <= VIDEO_BAND_HEIGHT,
        `the band's content ends at ${measured.contentBottom} px, within ${VIDEO_BAND_HEIGHT} px`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

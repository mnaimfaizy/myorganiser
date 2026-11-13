/**
 * The ffmpeg rules for a QA Artifact (PRD #1544).
 *
 * A `Capture: video` scenario's annotated MP4: that scenario's tab, Before
 * beside After, with the Storyboard's band throughout, each step's caption
 * from the moment its step was taken, and the device and tab label on each
 * side. The overlays are PNGs rendered in Chromium (`video-overlay-html.ts`,
 * `video-overlay-render.ts`); ffmpeg only scales, stacks and overlays them,
 * and never needs `drawtext`.
 *
 * Pure: this module reads and checks a scenario's saved step records (what
 * `qa:combine` re-renders from), and decides the caption timing and every
 * ffmpeg argument list. `qa-combine-executor.ts` runs them. ffmpeg
 * is the system binary, not an npm dependency. A shorter video holds its last
 * frame while the longer one finishes.
 */
import { isAbsolute, normalize } from 'node:path';

import { SCENARIO_RESULTS, type ScenarioResult } from './grade-scenarios.ts';
import { VIEWPORT } from './qa-run.ts';
import type { ExpectedResults, StepRecord } from './qa-scenario.ts';
import type { Side } from './qa-stack.ts';
import { SIDES } from './qa-switch.ts';
import type { Band, StoryboardSideInput } from './storyboard.ts';

export const FFMPEG = 'ffmpeg';

export const VIDEO_FPS = 25;

/** A request that cannot be re-rendered: a bad invocation or a missing input, exit 2. */
export class CombineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CombineInputError';
  }
}

/**
 * What a `video` scenario's step-records file saves for its MP4, beyond the
 * steps: the tab it follows and, per side, that tab's recording facts. No
 * recording path (a re-render finds the recording in the run folder's layout).
 */
export interface StepRecordsVideo {
  tab: string;
  sides: Partial<
    Record<
      Side,
      { device: string; tab: string; label: string; openedAtMs: number }
    >
  >;
}

/** A scenario's step-records file, as `qa:run` saved it (`storyboardFor`). */
export interface StepRecordsFile {
  id: string;
  capture: 'screenshot' | 'video';
  title: string;
  expected: ExpectedResults;
  commits: Record<Side, string>;
  /** Field names the caption check refused at `qa:run`; non-empty means no re-render. */
  refused?: string[];
  video?: StepRecordsVideo;
  sides: Partial<Record<Side, StoryboardSideInput>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * Reads a step-records file's text, checking its shape. Throws a
 * `CombineInputError` that names the file and the part that is wrong, and
 * never quotes a value from it.
 */
export function parseStepRecords(
  text: string,
  id: string,
  file: string,
): StepRecordsFile {
  const bad = (what: string): never => {
    throw new CombineInputError(`${file} is not a step-records file: ${what}`);
  };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return bad('it is not JSON');
  }
  if (!isRecord(json)) return bad('it is not an object');
  if (json.id !== id) return bad(`it is not scenario "${id}"`);
  if (json.capture !== 'screenshot' && json.capture !== 'video') {
    return bad('its capture is not screenshot or video');
  }
  if (!isString(json.title)) return bad('no title');
  const { expected, commits } = json;
  if (!isRecord(expected) || !isString(expected.after)) {
    return bad('no expected.after');
  }
  if (expected.before !== undefined && !isString(expected.before)) {
    return bad('expected.before is not text');
  }
  if (!isRecord(commits) || !SIDES.every((side) => isString(commits[side]))) {
    return bad('no commits');
  }
  if (
    json.refused !== undefined &&
    !(Array.isArray(json.refused) && json.refused.every(isString))
  ) {
    return bad('refused is not a list');
  }
  if (!isRecord(json.sides)) return bad('no sides');
  for (const side of SIDES) {
    const run = json.sides[side];
    if (run === undefined) continue;
    if (!isRecord(run) || !isString(run.outcome) || !Array.isArray(run.steps)) {
      return bad(`${side} has no outcome and steps`);
    }
    for (const step of run.steps) {
      if (
        !isRecord(step) ||
        !isString(step.caption) ||
        !isString(step.label) ||
        !isString(step.device) ||
        !isString(step.tab) ||
        !isString(step.still) ||
        typeof step.index !== 'number' ||
        typeof step.atMs !== 'number'
      ) {
        return bad(`${side} has a malformed step`);
      }
      const still = normalize(step.still);
      if (isAbsolute(still) || still.split(/[\\/]/).includes('..')) {
        return bad(`${side} step ${step.index} names a still outside the run`);
      }
    }
  }
  const video = json.video;
  if (video !== undefined) {
    const sides = isRecord(video) ? video.sides : undefined;
    if (
      !isRecord(video) ||
      !isString(video.tab) ||
      !isRecord(sides) ||
      !SIDES.every((side) => {
        const one = sides[side];
        return (
          one === undefined ||
          (isRecord(one) &&
            isString(one.device) &&
            isString(one.tab) &&
            isString(one.label) &&
            typeof one.openedAtMs === 'number')
        );
      })
    ) {
      return bad('its video block is malformed');
    }
  }
  return json as unknown as StepRecordsFile;
}

/** A graded result, from the run manifest's scenario entry; `null` when it has none. */
export function resultOf(
  manifestText: string,
  id: string,
): ScenarioResult | null {
  let json: unknown;
  try {
    json = JSON.parse(manifestText);
  } catch {
    return null;
  }
  const scenarios = isRecord(json) ? json.scenarios : undefined;
  if (!Array.isArray(scenarios)) return null;
  const found = scenarios.find((s) => isRecord(s) && s.id === id);
  const result = isRecord(found) ? found.result : undefined;
  return SCENARIO_RESULTS.find((known) => known === result) ?? null;
}

const QUIET = ['-y', '-hide_banner', '-loglevel', 'error'] as const;

/** The H.264 settings every MP4 is written with: plays inline, no audio. */
const MP4_OUTPUT = [
  '-an',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
] as const;

/** One side's recording panel in the MP4: the viewport every run uses, unscaled. */
export const VIDEO_PANEL = VIEWPORT;

/** The band across the top of the MP4, in pixels. */
export const VIDEO_BAND_HEIGHT = 96;

/** The caption strip under each side's panel, in pixels. */
export const VIDEO_STRIP_HEIGHT = 56;

/** The device and tab label at the top left of each side's panel, in pixels. */
export const VIDEO_LABEL_HEIGHT = 48;

/** One step, as the MP4 captions it: the parts of its step record the strip shows and times. */
export type VideoStep = Pick<
  StepRecord,
  'index' | 'caption' | 'atMs' | 'device' | 'tab' | 'label'
>;

/** One side of the MP4: its recording of the MP4's tab and its steps. */
export interface VideoSide {
  side: Side;
  /** The recording of the MP4's tab on this side. */
  video: string;
  device: string;
  tab: string;
  /** The tab's label, e.g. "Device B · tab B1". */
  label: string;
  /** When the recording starts, in milliseconds from the run's start. */
  openedAtMs: number;
  steps: readonly VideoStep[];
}

/** What one annotated MP4 is made from. */
export interface AnnotatedVideoPlan {
  /** The Storyboard's band, shown throughout. */
  band: Band;
  /** One or two sides, Before first. */
  sides: readonly VideoSide[];
  /** Where the MP4 is written. */
  output: string;
}

/**
 * One caption strip's time on screen, in seconds of the side's own video:
 * `step` is `null` for the strip shown before the first step, and `end` is
 * `null` for the last, which stays to the end.
 */
export interface CaptionWindow {
  step: VideoStep | null;
  start: number;
  end: number | null;
}

/** A step's moment in a side's video: its time from the run's start, less the recording's. */
function secondsInto(side: VideoSide, step: VideoStep): number {
  return Math.max(0, step.atMs - side.openedAtMs) / 1000;
}

/**
 * Each strip a side shows and when: the opening strip until the first step,
 * then each step's caption from that step's moment until the next step's.
 * A step taken before the recording started shows from 0; a strip that
 * would never be on screen (its next step is at the same moment) is dropped.
 */
export function captionWindows(side: VideoSide): CaptionWindow[] {
  const starts = side.steps.map((step) => secondsInto(side, step));
  const windows: CaptionWindow[] = [
    { step: null, start: 0, end: starts[0] ?? null },
    ...side.steps.map((step, i) => ({
      step,
      start: starts[i],
      end: starts[i + 1] ?? null,
    })),
  ];
  return windows.filter(({ start, end }) => end === null || end > start);
}

/** The overlay PNGs an MP4 is made with, by the ffmpeg input they become. */
export interface VideoOverlayFiles {
  band: string;
  /** Per side, in `plan.sides` order: its label and one strip per caption window. */
  sides: readonly { label: string; strips: readonly string[] }[];
}

const seconds = (value: number): string => value.toFixed(3);

/** When a strip is on screen, as an ffmpeg `enable` expression. */
export function enableExpression(window: CaptionWindow): string {
  return window.end === null
    ? `gte(t,${seconds(window.start)})`
    : `gte(t,${seconds(window.start)})*lt(t,${seconds(window.end)})`;
}

/**
 * The ffmpeg arguments for one annotated MP4. Inputs: each side's recording,
 * then the band, then per side its label and its strips, in
 * `captionWindows` order. Each side is scaled to the panel, labelled at the
 * top left and given a caption strip below, each strip enabled for its
 * window; the sides are stacked, and the band is overlaid across the top
 * with no `enable`, so it shows for the whole video.
 */
export function buildAnnotatedVideoArgs(
  plan: AnnotatedVideoPlan,
  overlays: VideoOverlayFiles,
): string[] {
  const { width, height } = VIDEO_PANEL;
  if (plan.sides.length < 1 || plan.sides.length > 2) {
    throw new Error('an annotated MP4 has one or two sides');
  }
  if (overlays.sides.length !== plan.sides.length) {
    throw new Error('one set of overlays is needed per side');
  }
  const inputs: string[] = plan.sides.map((side) => side.video);
  const bandInput = inputs.push(overlays.band) - 1;
  const graph: string[] = [];
  const panels: string[] = [];
  plan.sides.forEach((side, sideIndex) => {
    const files = overlays.sides[sideIndex];
    const windows = captionWindows(side);
    if (files.strips.length !== windows.length) {
      throw new Error(`${side.side}: one strip is needed per caption window`);
    }
    const labelInput = inputs.push(files.label) - 1;
    graph.push(
      `[${sideIndex}:v]fps=${VIDEO_FPS},scale=${width}:${height},setsar=1[p${sideIndex}]`,
      `[p${sideIndex}][${labelInput}:v]overlay=0:0[l${sideIndex}]`,
      `[l${sideIndex}]pad=${width}:${height + VIDEO_STRIP_HEIGHT}:0:0[c${sideIndex}_0]`,
    );
    windows.forEach((window, windowIndex) => {
      const stripInput = inputs.push(files.strips[windowIndex]) - 1;
      graph.push(
        `[c${sideIndex}_${windowIndex}][${stripInput}:v]overlay=0:${height}:enable='${enableExpression(window)}'[c${sideIndex}_${windowIndex + 1}]`,
      );
    });
    panels.push(`[c${sideIndex}_${windows.length}]`);
  });
  graph.push(
    panels.length === 2
      ? `${panels.join('')}hstack=inputs=2[stack]`
      : `${panels[0]}null[stack]`,
    `[stack]pad=iw:ih+${VIDEO_BAND_HEIGHT}:0:${VIDEO_BAND_HEIGHT}[framed]`,
    `[framed][${bandInput}:v]overlay=0:0[v]`,
  );
  return [
    ...QUIET,
    ...inputs.flatMap((input) => ['-i', input]),
    '-filter_complex',
    graph.join(';'),
    '-map',
    '[v]',
    ...MP4_OUTPUT,
    plan.output,
  ];
}

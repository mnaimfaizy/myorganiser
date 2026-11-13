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
 * The `qa:combine` file pair: until #1550 makes a bare pair a refusal, a
 * screenshot or video pair is still stacked side by side, Before on the
 * left, unlabelled.
 *
 * Pure: this module decides the kind, the output paths, the caption timing
 * and every ffmpeg argument list. `qa-combine-executor.ts` runs them. ffmpeg
 * is the system binary, not an npm dependency. A shorter video holds its last
 * frame while the longer one finishes.
 */
import { extname } from 'node:path';

import { VIEWPORT } from './qa-run.ts';
import type { StepRecord } from './qa-scenario.ts';
import type { Side } from './qa-stack.ts';
import type { Band } from './storyboard.ts';

export const FFMPEG = 'ffmpeg';

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'] as const;
export const VIDEO_EXTENSIONS = ['.webm', '.mp4', '.mov'] as const;

export type CombineKind = 'image' | 'video';

export const DEFAULT_HEIGHT = 720;
export const VIDEO_FPS = 25;

/** A request that cannot be combined: a bad invocation, exit 2. */
export class CombineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CombineInputError';
  }
}

export function kindOf(path: string): CombineKind | null {
  const extension = extname(path).toLowerCase();
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
    return 'image';
  }
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(extension)) {
    return 'video';
  }
  return null;
}

/** Both sides must be the same kind of file; returns that kind. */
export function combineKind(before: string, after: string): CombineKind {
  const beforeKind = kindOf(before);
  const afterKind = kindOf(after);
  if (!beforeKind || !afterKind) {
    throw new CombineInputError(
      `cannot tell the kind of "${beforeKind ? after : before}": expected one of ${[...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].join(' ')}`,
    );
  }
  if (beforeKind !== afterKind) {
    throw new CombineInputError(
      `before is ${beforeKind === 'image' ? 'an image' : 'a video'} but after is ${afterKind === 'image' ? 'an image' : 'a video'}`,
    );
  }
  return beforeKind;
}

export function validateHeight(height: number): number {
  if (!Number.isInteger(height) || height < 2 || height % 2 !== 0) {
    throw new CombineInputError('height must be an even integer, 2 or more');
  }
  return height;
}

/** `out` is a path without an extension; the extension is chosen from the kind. */
export function outputFor(kind: CombineKind, out: string): string {
  if (extname(out) !== '') {
    throw new CombineInputError(
      '--out is a path without an extension; the extension is chosen from the kind',
    );
  }
  return `${out}${PAIR[kind].extension}`;
}

function sideBySideFilter(height: number, fps: boolean): string {
  const prepare = (input: number, label: string): string =>
    `[${input}:v]${fps ? `fps=${VIDEO_FPS},` : ''}scale=-2:${height}[${label}]`;
  return [prepare(0, 'b'), prepare(1, 'a'), '[b][a]hstack=inputs=2[v]'].join(
    ';',
  );
}

export interface CombineFiles {
  before: string;
  after: string;
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

function inputArgs(files: CombineFiles): string[] {
  return [...QUIET, '-i', files.before, '-i', files.after];
}

export function buildImageArgs(
  files: CombineFiles,
  output: string,
  height: number,
): string[] {
  return [
    ...inputArgs(files),
    '-filter_complex',
    sideBySideFilter(height, false),
    '-map',
    '[v]',
    '-frames:v',
    '1',
    output,
  ];
}

export function buildVideoArgs(
  files: CombineFiles,
  output: string,
  height: number,
): string[] {
  return [
    ...inputArgs(files),
    '-filter_complex',
    sideBySideFilter(height, true),
    '-map',
    '[v]',
    ...MP4_OUTPUT,
    output,
  ];
}

/** Per kind, the pair's output extension and the arguments that combine it. */
export const PAIR = {
  image: { extension: '.png', build: buildImageArgs },
  video: { extension: '.mp4', build: buildVideoArgs },
} as const satisfies Record<
  CombineKind,
  {
    extension: string;
    build: (files: CombineFiles, output: string, height: number) => string[];
  }
>;

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

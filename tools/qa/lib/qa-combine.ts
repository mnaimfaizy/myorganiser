/**
 * The ffmpeg rules for a QA Artifact (PRD #1544).
 *
 * A `Capture: video` scenario's annotated MP4: that scenario's tab, Before
 * beside After, with the Storyboard's band throughout, each step's caption
 * from its step's hold, and the device and tab label on each side. The MP4
 * is paced so a viewer can follow it (`pacedTimeline`): each step holds on
 * its frame, steps start at the same moment on both sides, and playback
 * between steps is slower. The overlays are PNGs rendered in Chromium
 * (`video-overlay-html.ts`, `video-overlay-render.ts`); ffmpeg only scales, stacks and overlays them,
 * and never needs `drawtext`.
 *
 * Pure: this module reads and checks a scenario's saved step records (what
 * `qa:combine` re-renders from), and decides the caption timing and every
 * ffmpeg argument list. `qa-combine-executor.ts` runs them. ffmpeg
 * is the system binary, not an npm dependency. A shorter segment holds its
 * last frame while the longer one finishes.
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

/** How long both sides hold on each step's frame, in output seconds. */
export const VIDEO_STEP_HOLD_SECONDS = 2.5;

/** The speed each side plays at between steps (1 is the recording's own speed). */
export const VIDEO_PLAYBACK_SPEED = 0.75;

export const FFPROBE = 'ffprobe';

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
      {
        device: string;
        tab: string;
        label: string;
        openedAtMs: number;
        /**
         * The wall clock when this side's run began (its steps' `atMs` 0), in
         * epoch milliseconds. Absent in records `qa:run` saved before it was
         * added: they still re-render, without clock times.
         */
        startedAtMs?: number;
      }
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
        typeof step.atMs !== 'number' ||
        (step.checked !== undefined && step.checked !== true)
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
            typeof one.openedAtMs === 'number' &&
            (one.startedAtMs === undefined ||
              (typeof one.startedAtMs === 'number' &&
                Number.isFinite(one.startedAtMs))))
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

/** The strip under each side's panel (caption line, timing line), in pixels. */
export const VIDEO_STRIP_HEIGHT = 88;

/** The device and tab label at the top left of each side's panel, in pixels. */
export const VIDEO_LABEL_HEIGHT = 48;

/** One step, as the MP4 captions it: the parts of its step record the strip shows and times. */
export type VideoStep = Pick<
  StepRecord,
  'index' | 'caption' | 'atMs' | 'device' | 'tab' | 'label' | 'checked'
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
  /** The wall clock at the run's start, epoch ms; absent when the records predate it. */
  startedAtMs?: number;
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
  /** The IANA time zone clock times are shown in; the rendering machine's own when absent. */
  timeZone?: string;
}

/**
 * One caption strip's time on screen, in seconds of the paced MP4: `step`
 * is `null` for the strip shown before the first step, and `end` is `null`
 * for the last, which stays to the end.
 */
export interface CaptionWindow {
  step: VideoStep | null;
  /** The step's timing on this side; absent for the strip before step 1. */
  timing?: StepTiming;
  start: number;
  end: number | null;
}

/** One stretch of a side's output: its recording played slower, or one frame held. */
export interface PacedPiece {
  kind: 'play' | 'hold';
  /** Seconds into the side's own recording. A hold shows the frame at `srcStart`. */
  srcStart: number;
  srcEnd: number;
  /** Seconds into the paced MP4. A play shorter than this holds its last frame. */
  outStart: number;
  outEnd: number;
}

/** One side of the paced MP4: what it shows, in order, and its caption strips. */
export interface PacedSide {
  side: Side;
  pieces: PacedPiece[];
  windows: CaptionWindow[];
}

/** The MP4's time, worked out once and read by the ffmpeg arguments and the strips. */
export interface PacedTimeline {
  /** When each step's hold starts, by step position (the first step is `[0]`); the same on every side. */
  holdStarts: number[];
  /** The MP4's length in seconds. */
  total: number;
  sides: PacedSide[];
}

const EPSILON = 1e-6;
const FRAME = 1 / VIDEO_FPS;

/**
 * A recording's length in seconds, from the `pts_time` of every video packet
 * (one per line, as `ffprobe -show_entries packet=pts_time -of csv=p=0`
 * prints them): the last packet's time less the first's, plus one frame. A live-written WebM
 * has no length in its header, so the packets are what is read. `null` when
 * there is no packet time.
 */
export function durationFromPackets(output: string): number | null {
  const times = output
    .split('\n')
    .map((line) => Number.parseFloat(line.split(',')[0]))
    .filter((time) => Number.isFinite(time));
  if (times.length === 0) return null;
  // One loop, not `Math.max(...times)`: a long recording has too many packets to spread.
  // ffmpeg reads an input from its first packet, so the length is last less first, plus a frame.
  let first = times[0];
  let last = times[0];
  for (const time of times) {
    first = Math.min(first, time);
    last = Math.max(last, time);
  }
  return last - first + FRAME;
}

/** The ffprobe arguments that `durationFromPackets` reads. */
export function probeDurationArgs(video: string): string[] {
  return [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'packet=pts_time',
    '-of',
    'csv=p=0',
    video,
  ];
}

/** What the overlay shows of one step's timing on one side; every part is milliseconds. */
export interface StepTiming {
  /** Time since the side began: the step's `atMs`. */
  elapsedMs: number;
  /** The wall clock (epoch ms) of the step; absent when the side has no saved start. */
  clockMs?: number;
  /**
   * How much later (+) or earlier (-) this side reached the step than Before,
   * steps matched by position. Present on After when Before ran and has the
   * step; absent on Before and on a single-side run.
   */
  differenceMs?: number;
}

/** The timing of step `n` (0-based) on `sides[sideIndex]`, from the step records alone. */
export function stepTiming(
  sides: readonly VideoSide[],
  sideIndex: number,
  n: number,
): StepTiming | undefined {
  const side = sides[sideIndex];
  const step = side.steps[n];
  if (step === undefined) return undefined;
  const before = sides.find((one) => one.side === 'before');
  const beforeStep = before?.steps[n];
  return {
    elapsedMs: step.atMs,
    ...(side.startedAtMs === undefined
      ? {}
      : { clockMs: side.startedAtMs + step.atMs }),
    ...(side.side === 'after' && beforeStep !== undefined
      ? { differenceMs: step.atMs - beforeStep.atMs }
      : {}),
  };
}

/** Time since a side began: `0:14.9`, or `1:02:03.0` from an hour on. */
export function formatElapsed(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100);
  const total = Math.floor(tenths / 10);
  const frac = tenths % 10;
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const two = (v: number): string => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}.${frac}` : `${m}:${two(s)}.${frac}`;
}

/** How far After was from Before: `+1.3 s`, `-0.4 s`, `+0.0 s`; the sign is never left out. */
export function formatDifference(ms: number): string {
  const tenths = Math.round(Math.abs(ms) / 100);
  const sign = tenths === 0 || ms > 0 ? '+' : '-';
  return `${sign}${(tenths / 10).toFixed(1)} s`;
}

/**
 * The wall clock with its zone, `14:40:41 AEDT`. The locale is pinned so
 * every machine writes it alike; `timeZone` is the rendering machine's own
 * unless given (tests give one). Zones with no abbreviation in the locale
 * come out as an offset label such as `GMT+11`, which is as unambiguous.
 */
export function formatClock(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).formatToParts(new Date(ms));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}:${get('second')} ${get('timeZoneName')}`;
}

/** A step's moment in a side's recording: its time from the run's start, less the recording's. */
function secondsInto(side: VideoSide, step: VideoStep): number {
  return Math.max(0, step.atMs - side.openedAtMs) / 1000;
}

/**
 * Where each step is on a side's recording, in seconds, kept in order and
 * inside the recording, with the recording's start and end around them and a
 * side that ran fewer steps than the most padded out with its end:
 * `[0, step 1, … step n, … end, end]`, `count + 2` long. A side with no
 * steps has its whole recording before "step 1".
 */
function anchors(side: VideoSide, duration: number, count: number): number[] {
  const marks = [0];
  for (let n = 0; n < count; n++) {
    const step = side.steps[n];
    marks.push(
      step === undefined
        ? duration
        : Math.min(duration, Math.max(marks[n], secondsInto(side, step))),
    );
  }
  marks.push(duration);
  return marks;
}

/**
 * The paced timeline of an MP4 (PRD #1544, #1555). `durations` is each side's
 * recording length, in `sides` order.
 *
 * Every side's steps are matched by position. Before step 1, between steps
 * and after the last step each side plays at `VIDEO_PLAYBACK_SPEED`; a
 * stretch lasts as long as the longest side's takes, and a side whose stretch
 * is shorter holds its last frame until the longest has finished. At each
 * step, every side holds on that step's frame for `VIDEO_STEP_HOLD_SECONDS`,
 * all starting together. A side with fewer steps holds its last frame through
 * the holds and stretches it did not take part in.
 *
 * Each step's caption shows from the start of its hold until the next step's
 * hold (the last stays to the end); the strip before step 1 shows until the
 * first hold, and is left out when that is the very start.
 */
export function pacedTimeline(
  sides: readonly VideoSide[],
  durations: readonly number[],
): PacedTimeline {
  if (durations.length !== sides.length) {
    throw new Error('one recording length is needed per side');
  }
  durations.forEach((duration, i) => {
    if (!(duration > 0)) {
      throw new Error(`${sides[i].side}: the recording has no length`);
    }
  });
  const count = Math.max(0, ...sides.map((side) => side.steps.length));
  const marks = sides.map((side, i) => anchors(side, durations[i], count));
  // Stretch n runs between mark n and mark n+1 (0 is before step 1, `count` is after the last).
  const stretches = Array.from({ length: count + 1 }, (_, n) =>
    Math.max(
      0,
      ...marks.map((side) => (side[n + 1] - side[n]) / VIDEO_PLAYBACK_SPEED),
    ),
  );
  const holdStarts: number[] = [];
  const stretchStarts: number[] = [];
  let at = 0;
  for (let n = 0; n <= count; n++) {
    stretchStarts.push(at);
    at += stretches[n];
    if (n < count) {
      holdStarts.push(at);
      at += VIDEO_STEP_HOLD_SECONDS;
    }
  }
  const total = at;

  return {
    holdStarts,
    total,
    sides: sides.map((side, i) => {
      const edge = marks[i];
      const pieces: PacedPiece[] = [];
      const piece = (
        kind: PacedPiece['kind'],
        srcStart: number,
        srcEnd: number,
        outStart: number,
        outEnd: number,
      ): void => {
        if (outEnd - outStart > EPSILON) {
          pieces.push({ kind, srcStart, srcEnd, outStart, outEnd });
        }
      };
      // One frame at `mark`, kept inside the recording.
      const frame = (mark: number): [number, number] => {
        const from = Math.max(0, Math.min(mark, durations[i] - FRAME));
        return [from, from + FRAME];
      };
      for (let n = 0; n <= count; n++) {
        const [from, to] = [edge[n], edge[n + 1]];
        const outStart = stretchStarts[n];
        const outEnd = outStart + stretches[n];
        if (to - from > EPSILON) piece('play', from, to, outStart, outEnd);
        else piece('hold', ...frame(from), outStart, outEnd);
        if (n < count) {
          piece(
            'hold',
            ...frame(edge[n + 1]),
            holdStarts[n],
            holdStarts[n] + VIDEO_STEP_HOLD_SECONDS,
          );
        }
      }
      const windows: CaptionWindow[] = [
        {
          step: null,
          start: 0,
          end: side.steps.length === 0 ? null : (holdStarts[0] ?? null),
        },
        ...side.steps.map((step, n) => ({
          step,
          timing: stepTiming(sides, i, n),
          start: holdStarts[n],
          end: n + 1 < side.steps.length ? holdStarts[n + 1] : null,
        })),
      ].filter(({ start, end }) => end === null || end - start > EPSILON);
      return { side: side.side, pieces, windows };
    }),
  };
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

const trimmed = (from: number, to: number): string =>
  `trim=start=${seconds(from)}:end=${seconds(to)}`;

/** One piece of a side's output, as the filters that cut and time it. */
function pieceFilters(piece: PacedPiece): string {
  const length = seconds(piece.outEnd - piece.outStart);
  const cut = trimmed(piece.srcStart, piece.srcEnd);
  // A play is slowed by stretching its timestamps; both kinds are then
  // padded with their last frame and cut to the piece's length.
  const retime =
    piece.kind === 'play'
      ? `setpts=(PTS-STARTPTS)/${VIDEO_PLAYBACK_SPEED}`
      : 'setpts=PTS-STARTPTS';
  return `${cut},${retime},fps=${VIDEO_FPS},tpad=stop_mode=clone:stop_duration=${length},trim=duration=${length},setpts=PTS-STARTPTS`;
}

/**
 * The ffmpeg arguments for one annotated MP4, laid out by `timeline`
 * (`pacedTimeline`, from the same plan). Inputs: each side's recording,
 * then the band, then per side its label and its strips, in the timeline's
 * `windows` order. Each side is scaled to the panel, cut into its paced
 * pieces (played slower, or one frame held) and joined; it is then labelled
 * at the top left and given a caption strip below, each strip enabled for
 * its window; the sides are stacked, and the band is overlaid across the top
 * with no `enable`, so it shows for the whole video.
 */
export function buildAnnotatedVideoArgs(
  plan: AnnotatedVideoPlan,
  overlays: VideoOverlayFiles,
  timeline: PacedTimeline,
): string[] {
  const { width, height } = VIDEO_PANEL;
  if (plan.sides.length < 1 || plan.sides.length > 2) {
    throw new Error('an annotated MP4 has one or two sides');
  }
  if (overlays.sides.length !== plan.sides.length) {
    throw new Error('one set of overlays is needed per side');
  }
  if (timeline.sides.length !== plan.sides.length) {
    throw new Error('one paced timeline is needed per side');
  }
  const inputs: string[] = plan.sides.map((side) => side.video);
  const bandInput = inputs.push(overlays.band) - 1;
  const graph: string[] = [];
  const panels: string[] = [];
  plan.sides.forEach((side, sideIndex) => {
    const files = overlays.sides[sideIndex];
    const { pieces, windows } = timeline.sides[sideIndex];
    if (files.strips.length !== windows.length) {
      throw new Error(`${side.side}: one strip is needed per caption window`);
    }
    const labelInput = inputs.push(files.label) - 1;
    const parts = pieces.map((_, n) => `[s${sideIndex}_${n}]`);
    graph.push(
      `[${sideIndex}:v]fps=${VIDEO_FPS},scale=${width}:${height},setsar=1,split=${pieces.length}${parts.join('')}`,
      ...pieces.map(
        (piece, n) => `${parts[n]}${pieceFilters(piece)}[q${sideIndex}_${n}]`,
      ),
      `${pieces.map((_, n) => `[q${sideIndex}_${n}]`).join('')}concat=n=${pieces.length}:v=1:a=0[p${sideIndex}]`,
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

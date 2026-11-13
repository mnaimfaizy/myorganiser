/**
 * The scenario runner's rules: `yarn qa:run` (ADR 0147 decisions 1-4).
 *
 * A QA session writes each scenario as a script under `tmp/qa/` and the
 * runner plays it in real Chromium on Before and After. This module is the
 * one place for:
 *
 *   - the parse options a scenario script is checked with (the contract
 *     itself is `qa-scenario.ts`);
 *   - the capture-keeping policy: every run records a video, a final
 *     screenshot and the backend calls, and keeps only what the scenario's
 *     `Capture:` line asks for, plus a failed run's recording, locally;
 *   - the run order: a fix serves Before then After, a feature After only,
 *     re-running on the merge-base only the scenarios that failed After;
 *   - the inputs it hands to grading, combining and the redactor, and the
 *     `run.json` manifest, which marks what may be offered for upload.
 *
 * Pure: nothing touches disk, a process or a browser. The steps run in
 * `qa-run-executor.ts`; the browser is `qa-run-browser.ts`; the command-line
 * wrapper is `tools/qa/qa-run.ts`.
 */
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  type BeforeOutcome,
  type ChangeKind,
  type GradingInput,
  type GradingReport,
  type Headline,
  type ScenarioResult,
} from './grade-scenarios.ts';
import { readFlags } from './qa-cli.ts';
import {
  type Capture,
  type ParseOptions,
  RunInputError,
  type Scenario,
  stepNumber,
} from './qa-scenario.ts';
import type { Side } from './qa-stack.ts';
import { SIDES } from './qa-switch.ts';
import { type ArtifactSide, isUploadEligible } from './upload-eligibility.ts';

/** How one run of a scenario on one side ended. */
export const RUN_OUTCOMES = ['pass', 'fail', 'cannot-run'] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** What every run records, whatever its `Capture:` line says. */
export const RECORDINGS = ['video', 'screenshot', 'calls'] as const;
export type Recording = (typeof RECORDINGS)[number];

/**
 * Where a kept recording goes: `side` is `<out>/<before|after>/`, the
 * scenario's QA Artifact for that side; `local` is `<out>/local/`, kept only
 * so a person can inspect a failure, and never offered for upload.
 */
export type KeptPlace = 'side' | 'local';

/**
 * The capture-keeping policy. Recording is always on; a recording not named
 * here is deleted before the run ends, so the kept files match the line
 * exactly. A failed run keeps its video locally whatever the line says; when
 * the line already asks for the video, that video is the QA Artifact.
 * `calls` become the Request Transcript after redaction.
 */
export const KEEP = {
  video: {
    pass: { video: 'side' },
    fail: { video: 'side' },
    'cannot-run': { video: 'side' },
  },
  screenshot: {
    pass: { screenshot: 'side' },
    fail: { screenshot: 'side', video: 'local' },
    'cannot-run': { screenshot: 'side' },
  },
  transcript: {
    pass: { calls: 'side' },
    fail: { calls: 'side', video: 'local' },
    'cannot-run': { calls: 'side' },
  },
  none: {
    pass: {},
    fail: { video: 'local' },
    'cannot-run': {},
  },
} as const satisfies Record<
  Capture,
  Record<RunOutcome, Partial<Record<Recording, KeptPlace>>>
>;

/** What a run keeps, and where. Anything not listed is deleted. */
export function keptRecordings(
  capture: Capture,
  outcome: RunOutcome,
): Partial<Record<Recording, KeptPlace>> {
  return KEEP[capture][outcome];
}

/** A recording kept as a file. Calls are kept in memory and become a Request Transcript. */
export type MediaRecording = Exclude<Recording, 'calls'>;

/** The file extension each media recording is written with. */
export const RECORDING_EXTENSION = {
  video: '.webm',
  screenshot: '.png',
} as const satisfies Record<MediaRecording, string>;

/** Where a kept recording lands under `--out`. */
export function keptPath(
  out: string,
  id: string,
  side: Side,
  recording: MediaRecording,
  place: KeptPlace,
): string {
  const extension = RECORDING_EXTENSION[recording];
  return place === 'side'
    ? join(out, side, `${id}${extension}`)
    : join(out, 'local', `${id}-${side}${extension}`);
}

/** The viewport every run uses, Before and After alike (ADR 0147 decision 2). */
export const VIEWPORT = { width: 1280, height: 720 } as const;

/** The longest a single scenario run may take before it is a failure. */
export const SCENARIO_TIMEOUT_MS = 120_000;

/**
 * Whether a capture's QA Artifact needs ffmpeg. A screen scenario's
 * Storyboard is rendered in Chromium; only a video's Before/After pair is
 * still combined into an MP4 and GIF by `qa:combine` (until #1549), so a run
 * of screenshots, transcripts or none does not require ffmpeg.
 */
export const FFMPEG_CAPTURE = {
  video: true,
  screenshot: false,
  transcript: false,
  none: false,
} as const satisfies Record<Capture, boolean>;

/** True when some scenario's pair will be combined with ffmpeg. */
export function needsFfmpeg(
  scenarios: readonly Pick<Scenario, 'capture'>[],
): boolean {
  return scenarios.some(({ capture }) => FFMPEG_CAPTURE[capture]);
}

export interface RunArgs {
  worktree: string;
  changeKind: ChangeKind;
  mergeBase: string;
  head: string;
  withBefore: boolean;
  scenarios: string;
  out: string;
}

export const RUN_USAGE =
  'usage: node tools/qa/qa-run.ts --worktree <path> --change-kind fix|feature --merge-base <sha> --head <sha> --scenarios <dir under tmp/qa/> --out <dir under tmp/qa/> [--with-before]';

/** `tmp/qa/` of the repository the tooling runs from: gitignored, never committed. */
export const QA_TMP_DIR = 'tmp/qa';

/** True if `path` is inside `<repoRoot>/tmp/qa/` (and not that directory itself). */
export function isUnderQaTmp(repoRoot: string, path: string): boolean {
  const rel = relative(resolve(repoRoot, QA_TMP_DIR), resolve(repoRoot, path));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function parseRunArgs(
  argv: readonly string[],
  repoRoot: string,
): RunArgs {
  const flags = readFlags(
    argv,
    [
      '--worktree',
      '--change-kind',
      '--merge-base',
      '--head',
      '--scenarios',
      '--out',
    ],
    ['--with-before'],
  );
  if (typeof flags === 'string') throw new RunInputError(flags);
  const value = (flag: string): string => {
    const found = flags.get(flag);
    if (typeof found !== 'string')
      throw new RunInputError(`${flag} is required`);
    return found;
  };
  const changeKind = value('--change-kind');
  if (changeKind !== 'fix' && changeKind !== 'feature') {
    throw new RunInputError('--change-kind must be fix or feature');
  }
  const withBefore = flags.has('--with-before');
  if (withBefore && changeKind === 'fix') {
    throw new RunInputError(
      '--with-before is for a feature; a fix always runs Before',
    );
  }
  const scenarios = resolve(repoRoot, value('--scenarios'));
  const out = resolve(repoRoot, value('--out'));
  for (const [flag, path] of [
    ['--scenarios', scenarios],
    ['--out', out],
  ] as const) {
    if (!isUnderQaTmp(repoRoot, path)) {
      throw new RunInputError(
        `${flag} must be a directory under ${QA_TMP_DIR}/, which is never committed`,
      );
    }
  }
  return {
    worktree: resolve(repoRoot, value('--worktree')),
    changeKind,
    mergeBase: value('--merge-base'),
    head: value('--head'),
    withBefore,
    scenarios,
    out,
  };
}

/** The `qa:stack start` arguments for a run, or for its merge-base re-run. */
export function stackStartArgs(args: RunArgs, beforeOnly: boolean): string[] {
  return [
    'start',
    '--worktree',
    args.worktree,
    '--change-kind',
    args.changeKind,
    '--merge-base',
    args.mergeBase,
    '--head',
    args.head,
    ...(beforeOnly ? ['--before-only'] : []),
    ...(args.withBefore ? ['--with-before'] : []),
  ];
}

/** What every scenario script is checked against for this run. */
export function parseOptions(
  args: Pick<RunArgs, 'changeKind' | 'withBefore'>,
): ParseOptions {
  return { runsBefore: args.changeKind === 'fix' || args.withBefore };
}

export function switchArgs(worktree: string, to: Side): string[] {
  return ['--worktree', worktree, '--to', to];
}

/**
 * The scenarios a feature re-runs on the merge-base: only those that failed
 * After, and only when the run served After alone. A fix, or a feature run
 * `--with-before`, already ran Before, so it re-runs nothing.
 */
export function rerunOnMergeBase(
  sides: readonly Side[],
  after: ReadonlyMap<string, RunOutcome>,
): string[] {
  if (sides.length !== 1 || sides[0] !== 'after') return [];
  return [...after]
    .filter(([, outcome]) => outcome === 'fail')
    .map(([id]) => id);
}

/** The grading input. A side a scenario never ran on is `not-run`. */
export function gradingInput(
  changeKind: ChangeKind,
  ids: readonly string[],
  outcomes: Record<Side, ReadonlyMap<string, RunOutcome>>,
): GradingInput {
  return {
    changeKind,
    scenarios: ids.map((id) => {
      const before: BeforeOutcome = outcomes.before.get(id) ?? 'not-run';
      // After always runs; a missing one is a bug in the executor.
      const after = outcomes.after.get(id);
      if (after === undefined) {
        throw new RunInputError(`scenario "${id}" has no After outcome`);
      }
      return { id, before, after };
    }),
  };
}

/** The `qa:combine` arguments for a scenario whose two sides both kept a screenshot or video. */
export function combineArgs(
  out: string,
  id: string,
  before: string,
  after: string,
): string[] {
  return [
    '--before',
    before,
    '--after',
    after,
    '--out',
    join(out, 'combined', id),
  ];
}

/**
 * The files `qa:combine` reports making, from the JSON it prints on success:
 * the combined image or MP4, then the GIF preview for a video.
 */
export function combinedFiles(printed: string): string[] {
  const made = JSON.parse(printed) as { combined?: unknown; gif?: unknown };
  if (typeof made.combined !== 'string') {
    throw new Error('qa:combine printed no combined file');
  }
  return typeof made.gif === 'string'
    ? [made.combined, made.gif]
    : [made.combined];
}

/** The directory one side's step stills are kept in, relative to `--out`. */
export function stepStillDir(id: string, side: Side): string {
  return join('steps', id, side);
}

/**
 * Where a step's still is kept, relative to `--out`, so a run directory can
 * move and its step records still point at their stills.
 */
export function stepStillPath(id: string, side: Side, index: number): string {
  return join(stepStillDir(id, side), `${stepNumber(index)}.png`);
}

/** Where a scenario's step records are saved under `--out`, for a re-render. */
export function stepRecordsPath(out: string, id: string): string {
  return join(out, 'steps', `${id}.json`);
}

/** Where a scenario's Storyboard PNG is made under `--out`. */
export function storyboardPath(out: string, id: string): string {
  return join(out, 'combined', `${id}.png`);
}

/** One call a scenario made to the QA backend, as the redactor reads it. Headers are never recorded. */
export interface RecordedCall {
  request: { method: string; path: string; body?: unknown };
  response: { status: number; body?: unknown };
}

/** The redactor's input for one scenario's calls, Before then After. */
export function transcriptInput(
  id: string,
  calls: Partial<Record<Side, readonly RecordedCall[]>>,
): { scenarios: { id: string; calls: unknown[] }[] } {
  return {
    scenarios: [
      {
        id,
        calls: SIDES.flatMap((side) =>
          (calls[side] ?? []).map((call) => ({ side, ...call })),
        ),
      },
    ],
  };
}

/** Where a kept file sits, as `run.json` reports it. */
export type FilePlace = ArtifactSide | 'local' | 'transcript';

export interface ManifestFile {
  path: string;
  place: FilePlace;
  uploadEligible: boolean;
}

/**
 * Whether a kept file may be offered for upload. Only a combined file can
 * be (upload-eligibility.ts); a local file never is; a Request Transcript
 * goes inline in the QA Report and has no upload choice (ADR 0147 decision 7).
 */
const PLACE_ELIGIBILITY = {
  before: (result) => isUploadEligible(result, 'before'),
  after: (result) => isUploadEligible(result, 'after'),
  combined: (result) => isUploadEligible(result, 'combined'),
  local: () => false,
  transcript: () => false,
} as const satisfies Record<FilePlace, (result: ScenarioResult) => boolean>;

export function manifestFile(
  path: string,
  place: FilePlace,
  result: ScenarioResult,
): ManifestFile {
  return { path, place, uploadEligible: PLACE_ELIGIBILITY[place](result) };
}

export interface ScenarioRecord {
  id: string;
  capture: Capture;
  /** Per side: the outcome and, for a failure, the first line of its message. */
  runs: Partial<Record<Side, { outcome: RunOutcome; message?: string }>>;
  files: { path: string; place: FilePlace }[];
  problems: string[];
}

export interface RunManifest {
  changeKind: ChangeKind;
  mergeBase: string;
  head: string;
  headline: Headline;
  scenarios: {
    id: string;
    capture: Capture;
    result: ScenarioResult;
    maintainerDecision: boolean;
    runs: ScenarioRecord['runs'];
    files: ManifestFile[];
    problems: string[];
  }[];
  stack: string;
}

/** The note every run ends with: the runner leaves the stack up for judgement checks. */
export const STACK_LEFT_UP =
  'the QA stack is still up for judgement checks through the qa-web launch entry; stop it with "yarn qa:stack:stop"';

export function buildManifest(
  args: Pick<RunArgs, 'changeKind' | 'mergeBase' | 'head'>,
  report: GradingReport,
  records: readonly ScenarioRecord[],
): RunManifest {
  const byId = new Map(records.map((record) => [record.id, record]));
  return {
    changeKind: args.changeKind,
    mergeBase: args.mergeBase,
    head: args.head,
    headline: report.headline,
    scenarios: report.scenarios.map(({ id, result, maintainerDecision }) => {
      const record = byId.get(id);
      if (!record) throw new RunInputError(`scenario "${id}" has no record`);
      return {
        id,
        capture: record.capture,
        result,
        maintainerDecision,
        runs: record.runs,
        files: record.files.map(({ path, place }) =>
          manifestFile(path, place, result),
        ),
        problems: record.problems,
      };
    }),
    stack: STACK_LEFT_UP,
  };
}

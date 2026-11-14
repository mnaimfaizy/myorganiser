/**
 * Runs `yarn qa:combine` (PRD #1544, #1550) and the annotated MP4's ffmpeg.
 *
 * `runCombine` re-renders one scenario's Storyboard PNG, and its annotated MP4
 * for a `video` scenario, from the step records a `qa:run` output folder saved
 * (`<out>/steps/<id>.json`) and the stills and recordings beside them. It
 * calls the same model, render, caption-check and MP4 code `qa:run` does
 * (`qa-storyboard-files.ts`, `buildStoryboard`, `makeAnnotatedVideo`), so the
 * files are the ones `qa:run` made. The files are rendered beside their
 * destination and moved into place once every one is made, so a render
 * failure leaves what was there untouched and nothing half-made. (Known
 * limit: the moves are two renames, PNG then MP4; if the second fails, the
 * new PNG is already in place beside the earlier MP4.) All-or-nothing is
 * deliberate: `qa:run` keeps the PNG when only the MP4 fails; a re-render
 * that cannot make everything makes nothing.
 *
 * Exit 0 = rendered (the files are printed as JSON). Exit 1 = the render
 * failed; nothing is left behind. Exit 2 = a bad invocation (a bare Before/
 * After file pair among them), a missing input (step records, the run's
 * manifest, a still, a recording, a `video` block) or a missing dependency
 * (Chromium, ffmpeg), or a scenario `qa:run` refused for caption privacy.
 *
 * Secrets are not saved with a run, so only the Bearer/JWT half of the
 * caption check is redone here, through `findCaptionLeaks` with no secrets.
 *
 * `makeAnnotatedVideo` makes the MP4: it renders the overlay PNGs in
 * Chromium into a temporary directory, runs ffmpeg once, and removes the
 * directory whatever happened. It rejects on any failure, leaving no MP4
 * behind.
 *
 * Every machine fact goes through `RecombineDeps` and `AnnotateDeps`, so a
 * test can stub them.
 */
import { dirname, join } from 'node:path';

import { findCaptionLeaks } from './caption-privacy.ts';
import { firstLine, readFlags } from './qa-cli.ts';
import {
  type AnnotatedVideoPlan,
  CombineInputError,
  FFMPEG,
  FFPROBE,
  buildAnnotatedVideoArgs,
  durationFromPackets,
  pacedTimeline,
  parseStepRecords,
  probeDurationArgs,
  resultOf,
} from './qa-combine.ts';
import {
  annotatedVideoPath,
  keptPath,
  stepRecordsPath,
  storyboardPath,
} from './qa-run.ts';
import { SCENARIO_ID, stepNumber } from './qa-scenario.ts';
import {
  type Mp4SideChoice,
  annotatedVideoSides,
  renderStoryboardPng,
  videoLabelFields,
} from './qa-storyboard-files.ts';
import type { Side } from './qa-stack.ts';
import { SIDES } from './qa-switch.ts';
import { type Storyboard, buildStoryboard } from './storyboard.ts';
import { type OverlayPage, videoOverlayPages } from './video-overlay-html.ts';

export interface CombineRun {
  /** `null` when the program could not be started (not installed). */
  status: number | null;
  stderr: string;
  /** What the program printed; only a probe reads it. */
  stdout?: string;
}

export interface CombineDeps {
  run(argv: readonly string[]): CombineRun;
  exists(path: string): boolean;
  makeDir(path: string): void;
  removePath(path: string): void;
  out(line: string): void;
  err(line: string): void;
}

export const COMBINE_USAGE =
  "usage: node tools/qa/qa-combine.ts --run <qa:run output folder> --scenario <id> (re-renders the scenario's Storyboard PNG, and its annotated MP4 for a video scenario, from the step records the run saved under <folder>/steps, beside the stills and recordings it kept; files are written to <folder>/combined as qa:run wrote them. A bare --before/--after file pair is refused. Secrets are not saved, so only the Bearer/JWT half of the caption check is redone: an exact-secret check cannot be redone here)";

export const FFMPEG_MISSING_MESSAGE =
  'ffmpeg or ffprobe was not found on PATH, so nothing was combined. Install ffmpeg, which ships ffprobe (macOS: `brew install ffmpeg`; Debian/Ubuntu: `sudo apt-get install ffmpeg`), and run again.';

/** The machine behind a re-render. The real one is in `tools/qa/qa-combine.ts`. */
export interface RecombineDeps extends CombineDeps {
  readFile(path: string): string;
  movePath(from: string, to: string): void;
  /** Renders a Storyboard to a PNG; rejects on failure, leaving no PNG. */
  renderStoryboard(
    storyboard: Storyboard,
    stillRoot: string,
    pngPath: string,
  ): Promise<void>;
  /** `makeAnnotatedVideo`; rejects on failure, leaving no MP4. */
  annotateVideo(plan: AnnotatedVideoPlan): Promise<void>;
  /** Why Chromium cannot be launched, or `null`. */
  chromiumMissing(): string | null;
}

function parseArgs(args: readonly string[]): { run: string; id: string } {
  if (args.includes('--before') || args.includes('--after')) {
    throw new CombineInputError(PAIR_REFUSAL);
  }
  const flags = readFlags(args, ['--run', '--scenario'], []);
  if (typeof flags === 'string') {
    throw new CombineInputError(`${flags}\n${COMBINE_USAGE}`);
  }
  const run = flags.get('--run');
  const id = flags.get('--scenario');
  if (typeof run !== 'string' || typeof id !== 'string') {
    throw new CombineInputError(
      `${!run ? '--run <qa:run output folder>' : '--scenario <id>'} is missing\n${COMBINE_USAGE}`,
    );
  }
  if (!SCENARIO_ID.test(id)) {
    throw new CombineInputError(
      `"${id}" is not a scenario id (letters, digits, _ and -, starting with a letter or digit)`,
    );
  }
  return { run, id };
}

const PAIR_REFUSAL = `a bare Before/After file pair is not combined any more: it has no step records, and no run folder or scenario id to find them by. Give --run <qa:run output folder> --scenario <id>.\n${COMBINE_USAGE}`;

export async function runCombine(
  args: readonly string[],
  deps: RecombineDeps,
): Promise<number> {
  try {
    return await recombine(args, deps);
  } catch (error) {
    if (error instanceof CombineInputError) {
      deps.err(`qa:combine: ${error.message}`);
      return 2;
    }
    deps.err(`qa:combine: ${firstLine(error)}`);
    return 1;
  }
}

async function recombine(
  args: readonly string[],
  deps: RecombineDeps,
): Promise<number> {
  const { run, id } = parseArgs(args);
  const missing = (path: string, what: string): never => {
    throw new CombineInputError(`${what}: ${path} does not exist`);
  };

  const recordsPath = stepRecordsPath(run, id);
  if (!deps.exists(recordsPath)) {
    missing(recordsPath, `no step records for scenario "${id}" in ${run}`);
  }
  const records = parseStepRecords(deps.readFile(recordsPath), id, recordsPath);
  if (records.refused && records.refused.length > 0) {
    throw new CombineInputError(
      `scenario "${id}" was refused for caption privacy when qa:run made it, so it is not re-rendered`,
    );
  }
  const manifestPath = join(run, 'run.json');
  if (!deps.exists(manifestPath)) {
    missing(manifestPath, 'the run manifest is needed for the graded result');
  }
  const result = resultOf(deps.readFile(manifestPath), id);
  if (result === null) {
    throw new CombineInputError(
      `${manifestPath} has no graded result for scenario "${id}"`,
    );
  }

  const isVideo = records.capture === 'video';
  // Each side's MP4 tab, from the saved `video` block and the run folder's layout.
  const choices: Partial<Record<Side, Mp4SideChoice>> = {};
  if (isVideo) {
    if (!records.video) {
      throw new CombineInputError(
        `${recordsPath} has no video block, so the MP4 cannot be re-rendered (the run predates it)`,
      );
    }
    for (const side of SIDES) {
      const saved = records.video.sides[side];
      if (!records.sides[side]) continue;
      const path = keptPath(run, id, side, 'video', 'side');
      if (!saved) {
        // qa:run found no recording of the MP4's tab on this side: no MP4 input.
        throw new CombineInputError(
          `${side} ran but no recording of the MP4's tab was saved for it; the recording would be ${path}`,
        );
      }
      if (!deps.exists(path))
        missing(path, `${side}'s recording of tab "${saved.tab}"`);
      choices[side] = {
        ok: true,
        recording: {
          device: saved.device,
          tab: saved.tab,
          path,
          openedAtMs: saved.openedAtMs,
        },
        label: saved.label,
      };
    }
  }
  for (const side of SIDES) {
    for (const step of records.sides[side]?.steps ?? []) {
      const still = join(run, step.still);
      if (!deps.exists(still))
        missing(still, `${side} step ${step.index}'s still`);
    }
  }

  const input = {
    id,
    title: records.title,
    expected: records.expected,
    result,
    commits: records.commits,
    sides: records.sides,
  };
  // No secrets are saved, so only the Bearer/JWT half of the check can run.
  const leaks = findCaptionLeaks(input, [], videoLabelFields(id, choices));
  if (leaks.length > 0) {
    throw new CombineInputError(
      `scenario "${id}" was refused for caption privacy: a secret or credential is in ${leaks.join('; ')}`,
    );
  }

  const chromium = deps.chromiumMissing();
  if (chromium) throw new CombineInputError(chromium);
  if (
    isVideo &&
    [FFMPEG, FFPROBE].some(
      (program) => deps.run([program, '-version']).status !== 0,
    )
  ) {
    throw new CombineInputError(FFMPEG_MISSING_MESSAGE);
  }

  const storyboard = buildStoryboard(input);
  if (storyboard.problems.length > 0) {
    deps.err(`qa:combine: ${storyboard.problems.join('; ')}`);
    return 1;
  }

  // Rendered beside their destination, moved into place only once all are made.
  const png = storyboardPath(run, id);
  const tempPng = join(dirname(png), `.recombine-${id}.png`);
  const mp4 = annotatedVideoPath(run, id);
  const tempMp4 = join(dirname(mp4), `.recombine-${id}.mp4`);
  const cleanUp = (): void => {
    deps.removePath(tempPng);
    deps.removePath(tempMp4);
  };
  try {
    const failed = await renderStoryboardPng(deps, storyboard, run, tempPng);
    if (failed !== null) {
      deps.err(`qa:combine: ${failed}`);
      return 1;
    }
    if (isVideo) {
      const video = annotatedVideoSides(
        records.video?.tab ?? '',
        records.sides,
        choices,
      );
      if (video.missing.length > 0) {
        deps.err(`qa:combine: ${video.missing.join('; ')}`);
        return 1;
      }
      try {
        await deps.annotateVideo({
          band: storyboard.band,
          sides: video.sides,
          output: tempMp4,
        });
      } catch (error) {
        deps.err(`qa:combine: the MP4 could not be made: ${firstLine(error)}`);
        return 1;
      }
    }
    deps.movePath(tempPng, png);
    if (isVideo) deps.movePath(tempMp4, mp4);
  } catch (error) {
    deps.err(`qa:combine: ${firstLine(error)}`);
    return 1;
  } finally {
    cleanUp();
  }
  deps.out(
    JSON.stringify(
      { scenario: id, combined: isVideo ? [png, mp4] : [png] },
      null,
      2,
    ),
  );
  return 0;
}

/** One overlay page to render, and where its PNG goes. */
export interface OverlayPng extends OverlayPage {
  path: string;
}

/** The machine behind an annotated MP4. The real one is `nodeAnnotateDeps`. */
export interface AnnotateDeps extends Pick<
  CombineDeps,
  'run' | 'exists' | 'makeDir' | 'removePath'
> {
  makeTempDir(): string;
  /** The design tokens' stylesheets, checked (`readTokenCss`). */
  tokenCss(): string;
  /** Renders each page to its PNG in Chromium; rejects on failure. */
  renderPngs(pages: readonly OverlayPng[]): Promise<void>;
}

/** A side's recording length, read from its packets; throws when it cannot be. */
function recordingSeconds(
  side: AnnotatedVideoPlan['sides'][number],
  deps: Pick<AnnotateDeps, 'run'>,
): number {
  const probed = deps.run([FFPROBE, ...probeDurationArgs(side.video)]);
  const seconds =
    probed.status === 0 ? durationFromPackets(probed.stdout ?? '') : null;
  if (seconds === null) {
    throw new Error(
      `ffprobe could not read the length of ${side.side}'s recording: ${firstLine(probed.stderr) || 'it printed no packet times'}`,
    );
  }
  return seconds;
}

/**
 * Makes one annotated MP4 at `plan.output`. Rejects with the reason on any
 * failure, with no MP4 left behind; the overlay PNGs never outlive the call.
 */
export async function makeAnnotatedVideo(
  plan: AnnotatedVideoPlan,
  deps: AnnotateDeps,
): Promise<void> {
  const timeline = pacedTimeline(
    plan.sides,
    plan.sides.map((side) => recordingSeconds(side, deps)),
  );
  const pages = videoOverlayPages(plan, deps.tokenCss(), timeline);
  const temp = deps.makeTempDir();
  try {
    const band: OverlayPng = { ...pages.band, path: join(temp, 'band.png') };
    const sides = pages.sides.map(({ side, label, strips }) => ({
      label: { ...label, path: join(temp, `${side}-label.png`) },
      strips: strips.map((strip, n) => ({
        ...strip,
        path: join(temp, `${side}-strip-${stepNumber(n)}.png`),
      })),
    }));
    await deps.renderPngs([
      band,
      ...sides.flatMap(({ label, strips }) => [label, ...strips]),
    ]);
    deps.makeDir(dirname(plan.output));
    const made = deps.run([
      FFMPEG,
      ...buildAnnotatedVideoArgs(
        plan,
        {
          band: band.path,
          sides: sides.map(({ label, strips }) => ({
            label: label.path,
            strips: strips.map((strip) => strip.path),
          })),
        },
        timeline,
      ),
    ]);
    if (made.status !== 0 || !deps.exists(plan.output)) {
      throw new Error(
        `ffmpeg failed to make the MP4: ${firstLine(made.stderr) || 'it wrote no file'}`,
      );
    }
  } catch (error) {
    deps.removePath(plan.output);
    throw error;
  } finally {
    deps.removePath(temp);
  }
}

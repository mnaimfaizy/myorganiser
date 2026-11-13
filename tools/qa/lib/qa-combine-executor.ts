/**
 * Runs the ffmpeg rules `qa-combine.ts` builds.
 *
 * `runCombine` is `yarn qa:combine`'s file pair, interim until #1550 makes a
 * bare pair a refusal: it checks ffmpeg is there and stacks the pair side by
 * side, Before on the left, unlabelled. Exit 0 = combined, and the file is
 * printed as JSON. Exit 1 = ffmpeg ran and failed; the output is removed, so
 * a half-made result is never left to be used. Exit 2 = bad invocation, an
 * input that is missing, or ffmpeg not installed. No exit reports a result
 * without the combined file existing.
 *
 * `makeAnnotatedVideo` makes a `Capture: video` scenario's annotated MP4
 * (PRD #1544): it renders the overlay PNGs in Chromium into a temporary
 * directory, runs ffmpeg once, and removes the directory whatever happened.
 * It rejects on any failure, leaving no MP4 behind.
 *
 * Every machine fact goes through `CombineDeps` and `AnnotateDeps`, so a
 * test can stub them.
 */
import { dirname, join } from 'node:path';

import {
  type AnnotatedVideoPlan,
  type CombineKind,
  CombineInputError,
  DEFAULT_HEIGHT,
  FFMPEG,
  buildAnnotatedVideoArgs,
  PAIR,
  combineKind,
  outputFor,
  validateHeight,
} from './qa-combine.ts';
import { stepNumber } from './qa-scenario.ts';
import { type OverlayPage, videoOverlayPages } from './video-overlay-html.ts';

export interface CombineRun {
  /** `null` when the program could not be started (not installed). */
  status: number | null;
  stderr: string;
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
  'usage: node tools/qa/qa-combine.ts --before <file> --after <file> --out <path without extension> [--height <even px, default 720>] (interim until #1550: the pair is stacked unlabelled, Before on the left)';

export const FFMPEG_MISSING_MESSAGE =
  'ffmpeg was not found on PATH, so nothing was combined. Install it (macOS: `brew install ffmpeg`; Debian/Ubuntu: `sudo apt-get install ffmpeg`) and run again.';

interface Parsed {
  before: string;
  after: string;
  out: string;
  height: number;
}

function parseArgs(args: readonly string[]): Parsed {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (
      !['--before', '--after', '--out', '--height'].includes(flag) ||
      value === undefined ||
      value.startsWith('--') ||
      values.has(flag)
    ) {
      throw new CombineInputError(COMBINE_USAGE);
    }
    values.set(flag, value);
  }
  const before = values.get('--before');
  const after = values.get('--after');
  const out = values.get('--out');
  if (!before || !after || !out) throw new CombineInputError(COMBINE_USAGE);
  const heightText = values.get('--height');
  const height =
    heightText === undefined
      ? DEFAULT_HEIGHT
      : /^\d+$/.test(heightText)
        ? Number(heightText)
        : Number.NaN;
  return { before, after, out, height: validateHeight(height) };
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

export function runCombine(args: readonly string[], deps: CombineDeps): number {
  let parsed: Parsed;
  let kind: CombineKind;
  let output: string;
  try {
    parsed = parseArgs(args);
    kind = combineKind(parsed.before, parsed.after);
    output = outputFor(kind, parsed.out);
  } catch (error) {
    if (error instanceof CombineInputError) {
      deps.err(`qa:combine: ${error.message}`);
      return 2;
    }
    throw error;
  }
  for (const input of [parsed.before, parsed.after]) {
    if (!deps.exists(input)) {
      deps.err(`qa:combine: input "${input}" does not exist`);
      return 2;
    }
  }
  if (deps.run([FFMPEG, '-version']).status !== 0) {
    deps.err(`qa:combine: ${FFMPEG_MISSING_MESSAGE}`);
    return 2;
  }

  deps.makeDir(dirname(output));
  const combined = deps.run([
    FFMPEG,
    ...PAIR[kind].build(
      { before: parsed.before, after: parsed.after },
      output,
      parsed.height,
    ),
  ]);
  if (combined.status !== 0 || !deps.exists(output)) {
    deps.removePath(output);
    deps.err(
      `qa:combine: ffmpeg failed to combine: ${firstLine(combined.stderr)}`,
    );
    return 1;
  }
  deps.out(JSON.stringify({ kind, combined: output }, null, 2));
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

/**
 * Makes one annotated MP4 at `plan.output`. Rejects with the reason on any
 * failure, with no MP4 left behind; the overlay PNGs never outlive the call.
 */
export async function makeAnnotatedVideo(
  plan: AnnotatedVideoPlan,
  deps: AnnotateDeps,
): Promise<void> {
  const pages = videoOverlayPages(plan, deps.tokenCss());
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
      ...buildAnnotatedVideoArgs(plan, {
        band: band.path,
        sides: sides.map(({ label, strips }) => ({
          label: label.path,
          strips: strips.map((strip) => strip.path),
        })),
      }),
    ]);
    if (made.status !== 0 || !deps.exists(plan.output)) {
      throw new Error(
        `ffmpeg failed to make the MP4: ${firstLine(made.stderr)}`,
      );
    }
  } catch (error) {
    deps.removePath(plan.output);
    throw error;
  } finally {
    deps.removePath(temp);
  }
}

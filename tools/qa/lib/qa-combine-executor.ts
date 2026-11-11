/**
 * Runs `yarn qa:combine` (ADR 0147 decision 5): checks ffmpeg is there,
 * renders the labels, runs the argument lists `qa-combine.ts` builds, and
 * holds the GIF under its size cap.
 *
 * Every machine fact goes through `CombineDeps`, so a test can stub it.
 * Exit 0 = combined, and the files are printed as JSON. Exit 1 = ffmpeg ran
 * and failed, or no GIF could be made under the cap; any output already
 * written is removed, so a half-made result is never left to be used. Exit 2
 * = bad invocation, an input that is missing, or ffmpeg not installed. No
 * exit reports a result without the combined file existing.
 */
import { dirname, join } from 'node:path';

import {
  type CombineKind,
  type CombineOutputs,
  CombineInputError,
  DEFAULT_HEIGHT,
  FFMPEG,
  GIF_LADDER,
  GIF_SIZE_CAP_BYTES,
  buildGifArgs,
  buildImageArgs,
  buildVideoArgs,
  combineKind,
  outputsFor,
  validateHeight,
} from './qa-combine.ts';
import { labelScale, renderLabel } from './qa-label.ts';

export interface CombineRun {
  /** `null` when the program could not be started (not installed). */
  status: number | null;
  stderr: string;
}

export interface CombineDeps {
  run(argv: readonly string[]): CombineRun;
  exists(path: string): boolean;
  fileSize(path: string): number | null;
  makeTempDir(): string;
  makeDir(path: string): void;
  writeFile(path: string, bytes: Buffer): void;
  removePath(path: string): void;
  out(line: string): void;
  err(line: string): void;
}

export const COMBINE_USAGE =
  'usage: node tools/qa/qa-combine.ts --before <file> --after <file> --out <path without extension> [--height <even px, default 720>]';

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
  let outputs: CombineOutputs;
  try {
    parsed = parseArgs(args);
    kind = combineKind(parsed.before, parsed.after);
    outputs = outputsFor(kind, parsed.out);
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

  const temp = deps.makeTempDir();
  const written: string[] = [];
  const fail = (message: string): number => {
    for (const path of written) deps.removePath(path);
    deps.err(`qa:combine: ${message}`);
    return 1;
  };
  try {
    const scale = labelScale(parsed.height);
    const beforeLabel = join(temp, 'before-label.png');
    const afterLabel = join(temp, 'after-label.png');
    deps.writeFile(beforeLabel, renderLabel('BEFORE', scale).png);
    deps.writeFile(afterLabel, renderLabel('AFTER', scale).png);
    const files = {
      before: parsed.before,
      after: parsed.after,
      beforeLabel,
      afterLabel,
    };

    deps.makeDir(dirname(outputs.primary));
    written.push(outputs.primary);
    const build = kind === 'image' ? buildImageArgs : buildVideoArgs;
    const combined = deps.run([
      FFMPEG,
      ...build(files, outputs.primary, parsed.height),
    ]);
    if (combined.status !== 0 || !deps.exists(outputs.primary)) {
      return fail(`ffmpeg failed to combine: ${firstLine(combined.stderr)}`);
    }

    let gifBytes: number | null = null;
    if (outputs.gif) {
      written.push(outputs.gif);
      for (const rung of GIF_LADDER) {
        const made = deps.run([
          FFMPEG,
          ...buildGifArgs(outputs.primary, outputs.gif, rung),
        ]);
        if (made.status !== 0) {
          return fail(
            `ffmpeg failed to make the GIF: ${firstLine(made.stderr)}`,
          );
        }
        const size = deps.fileSize(outputs.gif);
        if (size !== null && size <= GIF_SIZE_CAP_BYTES) {
          gifBytes = size;
          break;
        }
      }
      if (gifBytes === null) {
        const smallest = GIF_LADDER[GIF_LADDER.length - 1];
        return fail(
          `no GIF under ${GIF_SIZE_CAP_BYTES} bytes could be made from "${outputs.primary}" (smallest tried: ${smallest.width}px at ${smallest.fps} fps); trim the recording and run again`,
        );
      }
    }

    deps.out(
      JSON.stringify(
        { kind, combined: outputs.primary, gif: outputs.gif, gifBytes },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    deps.removePath(temp);
  }
}

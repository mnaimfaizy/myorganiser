/**
 * Combining a Before and an After QA Artifact into one (ADR 0147 decision 5):
 * a screenshot pair becomes one labelled side-by-side PNG, a video pair one
 * side-by-side MP4 plus a GIF preview under a fixed size cap.
 *
 * Pure: this module decides the kind, the output paths and every ffmpeg
 * argument list. `qa-combine-executor.ts` runs them. ffmpeg is the system
 * binary, not an npm dependency.
 *
 * Both sides are scaled to the same height (`height`, even) so they stack
 * level; the label PNGs (qa-label.ts) are overlaid at the top left of each.
 * A shorter video holds its last frame while the longer one finishes.
 */
import { extname } from 'node:path';

export const FFMPEG = 'ffmpeg';

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'] as const;
export const VIDEO_EXTENSIONS = ['.webm', '.mp4', '.mov'] as const;

export type CombineKind = 'image' | 'video';

export const DEFAULT_HEIGHT = 720;
export const VIDEO_FPS = 25;

/** The GIF has to show inline in a QA Report, so it is held under this size. */
export const GIF_SIZE_CAP_BYTES = 2 * 1024 * 1024;

/**
 * Tried in order until a GIF fits the cap; the first that does wins, so the
 * best-looking one that fits is kept. Width is a ceiling, never an upscale.
 */
export const GIF_LADDER = [
  { fps: 10, width: 640 },
  { fps: 8, width: 480 },
  { fps: 6, width: 400 },
  { fps: 5, width: 320 },
] as const;
export type GifRung = (typeof GIF_LADDER)[number];

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

export interface CombineOutputs {
  /** The combined image, or the combined MP4. */
  primary: string;
  /** The GIF preview; video only. */
  gif: string | null;
}

/** `out` is a path without an extension; the extensions are fixed here. */
export function outputsFor(kind: CombineKind, out: string): CombineOutputs {
  if (extname(out) !== '') {
    throw new CombineInputError(
      '--out is a path without an extension; the extension is chosen from the kind',
    );
  }
  return kind === 'image'
    ? { primary: `${out}.png`, gif: null }
    : { primary: `${out}.mp4`, gif: `${out}.gif` };
}

function sideBySideFilter(height: number, fps: boolean): string {
  const prepare = (input: number, label: string): string =>
    `[${input}:v]${fps ? `fps=${VIDEO_FPS},` : ''}scale=-2:${height}[${label}]`;
  return [
    prepare(0, 'b'),
    prepare(1, 'a'),
    '[b][2:v]overlay=8:8[bl]',
    '[a][3:v]overlay=8:8[al]',
    '[bl][al]hstack=inputs=2[v]',
  ].join(';');
}

export interface CombineFiles {
  before: string;
  after: string;
  /** The rendered "BEFORE" and "AFTER" label PNGs. */
  beforeLabel: string;
  afterLabel: string;
}

function inputArgs(files: CombineFiles): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    files.before,
    '-i',
    files.after,
    '-i',
    files.beforeLabel,
    '-i',
    files.afterLabel,
  ];
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
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  ];
}

/** The GIF is made from the combined MP4, so it cannot differ from it. */
export function buildGifArgs(
  mp4: string,
  output: string,
  rung: GifRung,
): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    mp4,
    '-filter_complex',
    `[0:v]fps=${rung.fps},scale='min(${rung.width},iw)':-1:flags=lanczos,split[x][y];[x]palettegen[p];[y][p]paletteuse`,
    '-loop',
    '0',
    output,
  ];
}

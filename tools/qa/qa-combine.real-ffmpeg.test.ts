// One end-to-end check that the real command-line script and the real ffmpeg
// agree. Fixtures are generated with ffmpeg, the CLI runs as a subprocess, and
// the outputs are probed with ffprobe. Every other suite stubs ffmpeg; this is
// the only one that runs it.
//
// The CLI pair is interim (until #1550): it stacks a pair side by side, Before
// on the left, unlabelled, and prints `{kind, combined}`. A video pair becomes
// `<out>.mp4` and no GIF is written beside it.
//
// Without ffmpeg the test is skipped with a visible reason. Set
// QA_REQUIRE_FFMPEG=1 (CI does) to make a missing ffmpeg a failure instead.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'qa-combine.ts');

function binaryAvailable(binary: string): boolean {
  return spawnSync(binary, ['-version'], { encoding: 'utf8' }).status === 0;
}

const MISSING = ['ffmpeg', 'ffprobe'].filter((b) => !binaryAvailable(b));
const SKIP =
  MISSING.length === 0 || process.env.QA_REQUIRE_FFMPEG
    ? false
    : `${MISSING.join(' and ')} not installed (set QA_REQUIRE_FFMPEG=1 to require it)`;

function ffmpeg(args: string[]): void {
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', ...args],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `fixture ffmpeg failed: ${result.stderr}`);
}

/** A 1 s, 10 fps test pattern of the given width, 48 px high. */
function testPattern(width: number): string[] {
  return ['-f', 'lavfi', '-i', `testsrc=size=${width}x48:rate=10:duration=1`];
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

test(
  'a PNG pair and a video pair combine to a side-by-side of the summed width',
  { skip: SKIP },
  () => {
    assert.deepEqual(
      MISSING,
      [],
      `${MISSING.join(' and ')} required in CI (QA_REQUIRE_FFMPEG is set) but not found on PATH`,
    );
    const dir = mkdtempSync(join(tmpdir(), 'qa-combine-real-'));
    try {
      const beforeMp4 = join(dir, 'before.mp4');
      const afterMp4 = join(dir, 'after.mp4');
      const beforePng = join(dir, 'before.png');
      const afterPng = join(dir, 'after.png');
      // The second pair is 96 px wide, so the combined width must be 64 + 96.
      ffmpeg([
        ...testPattern(64),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        beforeMp4,
      ]);
      ffmpeg([
        ...testPattern(96),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        afterMp4,
      ]);
      ffmpeg(['-i', beforeMp4, '-frames:v', '1', beforePng]);
      ffmpeg(['-i', afterMp4, '-frames:v', '1', afterPng]);

      const image = spawnSync(
        process.execPath,
        [
          CLI,
          '--before',
          beforePng,
          '--after',
          afterPng,
          '--out',
          join(dir, 'image'),
          '--height',
          '48',
        ],
        { encoding: 'utf8' },
      );
      assert.equal(image.status, 0, image.stderr);
      const imageResult = JSON.parse(image.stdout);
      assert.equal(imageResult.kind, 'image');
      assert.deepEqual(probeSize(imageResult.combined), [160, 48]);

      const video = spawnSync(
        process.execPath,
        [
          CLI,
          '--before',
          beforeMp4,
          '--after',
          afterMp4,
          '--out',
          join(dir, 'clip'),
          '--height',
          '48',
        ],
        { encoding: 'utf8' },
      );
      assert.equal(video.status, 0, video.stderr);
      const videoResult = JSON.parse(video.stdout);
      assert.equal(videoResult.kind, 'video');
      assert.equal(videoResult.combined, join(dir, 'clip.mp4'));
      assert.deepEqual(probeSize(videoResult.combined), [160, 48]);
      assert.equal(
        'gif' in videoResult,
        false,
        'the video result names no GIF',
      );
      assert.equal(
        existsSync(join(dir, 'clip.gif')),
        false,
        'no clip.gif is written beside the MP4',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

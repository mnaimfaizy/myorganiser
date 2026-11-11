// Contracts for the pure combine rules (ADR 0147 decision 5): kind detection,
// height and output validation, the ffmpeg argument lists, the GIF ladder, and
// the "BEFORE" / "AFTER" label PNGs. Everything here is a pure function, so no
// process and no file is touched; the executor is in qa-combine-executor.test.ts
// and the real ffmpeg run is in ../qa-combine.real-ffmpeg.test.ts.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { inflateSync } from 'node:zlib';

import {
  type CombineFiles,
  CombineInputError,
  GIF_LADDER,
  buildGifArgs,
  buildImageArgs,
  buildVideoArgs,
  combineKind,
  kindOf,
  outputsFor,
  validateHeight,
} from './qa-combine.ts';
import { LABEL_TEXTS, labelScale, renderLabel } from './qa-label.ts';

const FILES: CombineFiles = {
  before: '/in/before.png',
  after: '/in/after.png',
  beforeLabel: '/tmp/before-label.png',
  afterLabel: '/tmp/after-label.png',
};

/** The value following each `-i`, in argument order. */
function inputsOf(args: readonly string[]): string[] {
  return args.flatMap((arg, i) => (arg === '-i' ? [args[i + 1]] : []));
}

function valueAfter(args: readonly string[], flag: string): string {
  const at = args.indexOf(flag);
  assert.notEqual(at, -1, `missing ${flag}`);
  return args[at + 1];
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

interface PngChunk {
  type: string;
  data: Buffer;
}

/** Splits a PNG into its chunks, asserting the signature on the way. */
function pngChunks(png: Buffer): PngChunk[] {
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  const chunks: PngChunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    chunks.push({
      type: png.subarray(at + 4, at + 8).toString('ascii'),
      data: png.subarray(at + 8, at + 8 + length),
    });
    at += 12 + length;
  }
  return chunks;
}

describe('kindOf and combineKind', () => {
  test('image extensions are an image; video extensions are a video', () => {
    for (const path of ['a.png', 'a.jpg', 'a.jpeg']) {
      assert.equal(kindOf(path), 'image', path);
    }
    for (const path of ['a.webm', 'a.mp4', 'a.mov']) {
      assert.equal(kindOf(path), 'video', path);
    }
  });

  test('the extension match is case-insensitive', () => {
    assert.equal(kindOf('SHOT.PNG'), 'image');
    assert.equal(kindOf('clip.MP4'), 'video');
    assert.equal(combineKind('A.PNG', 'b.Jpeg'), 'image');
    assert.equal(combineKind('A.MOV', 'b.WebM'), 'video');
  });

  test('an unknown or missing extension is not a kind', () => {
    assert.equal(kindOf('notes.gif'), null);
    assert.equal(kindOf('notes.txt'), null);
    assert.equal(kindOf('no-extension'), null);
  });

  test('a matching image pair and a matching video pair combine', () => {
    assert.equal(combineKind('before.png', 'after.jpg'), 'image');
    assert.equal(combineKind('before.webm', 'after.mp4'), 'video');
  });

  test('a mixed image and video pair is a CombineInputError', () => {
    assert.throws(
      () => combineKind('before.png', 'after.mp4'),
      (error: unknown) =>
        error instanceof CombineInputError &&
        /before is an image but after is a video/.test(error.message),
    );
    assert.throws(
      () => combineKind('before.mov', 'after.jpg'),
      CombineInputError,
    );
  });

  test('an unknown extension on either side names that side', () => {
    assert.throws(
      () => combineKind('before.gif', 'after.png'),
      (error: unknown) =>
        error instanceof CombineInputError &&
        error.message.includes('before.gif'),
    );
    assert.throws(
      () => combineKind('before.png', 'after.txt'),
      (error: unknown) =>
        error instanceof CombineInputError &&
        error.message.includes('after.txt'),
    );
  });
});

describe('validateHeight', () => {
  test('an even integer of 2 or more is returned unchanged', () => {
    assert.equal(validateHeight(2), 2);
    assert.equal(validateHeight(48), 48);
    assert.equal(validateHeight(720), 720);
  });

  for (const height of [
    0,
    -2,
    1,
    721,
    48.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    test(`${height} is rejected`, () => {
      assert.throws(() => validateHeight(height), CombineInputError);
    });
  }
});

describe('outputsFor', () => {
  test('an image produces a PNG and no GIF', () => {
    assert.deepEqual(outputsFor('image', 'out/shot'), {
      primary: 'out/shot.png',
      gif: null,
    });
  });

  test('a video produces an MP4 and a GIF', () => {
    assert.deepEqual(outputsFor('video', 'out/clip'), {
      primary: 'out/clip.mp4',
      gif: 'out/clip.gif',
    });
  });

  test('an --out that already carries an extension is rejected for both kinds', () => {
    assert.throws(() => outputsFor('image', 'out/shot.png'), CombineInputError);
    assert.throws(() => outputsFor('video', 'out/clip.mp4'), CombineInputError);
  });
});

describe('buildImageArgs', () => {
  test('starts with the quiet, overwrite flags', () => {
    const args = buildImageArgs(FILES, '/out/shot.png', 48);
    assert.deepEqual(args.slice(0, 4), [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
    ]);
  });

  test('the four inputs are the two sides then the two labels, in that order', () => {
    const args = buildImageArgs(FILES, '/out/shot.png', 48);
    assert.deepEqual(inputsOf(args), [
      FILES.before,
      FILES.after,
      FILES.beforeLabel,
      FILES.afterLabel,
    ]);
  });

  test('both sides are scaled to the requested height and stacked before-left', () => {
    const filter = valueAfter(
      buildImageArgs(FILES, '/out/shot.png', 48),
      '-filter_complex',
    );
    assert.equal(countOf(filter, 'scale=-2:48'), 2);
    assert.ok(filter.includes('[bl][al]hstack=inputs=2'), filter);
  });

  test('the height argument flows into the scale filter', () => {
    const filter = valueAfter(
      buildImageArgs(FILES, '/out/shot.png', 720),
      '-filter_complex',
    );
    assert.equal(countOf(filter, 'scale=-2:720'), 2);
    assert.equal(filter.includes('scale=-2:48'), false);
  });

  test('each label is overlaid on its own side at the top left', () => {
    const filter = valueAfter(
      buildImageArgs(FILES, '/out/shot.png', 48),
      '-filter_complex',
    );
    assert.ok(filter.includes('[b][2:v]overlay=8:8[bl]'), filter);
    assert.ok(filter.includes('[a][3:v]overlay=8:8[al]'), filter);
  });

  test('a single frame is written, with no fps change and no video encoder', () => {
    const args = buildImageArgs(FILES, '/out/shot.png', 48);
    assert.equal(valueAfter(args, '-frames:v'), '1');
    assert.equal(valueAfter(args, '-map'), '[v]');
    assert.equal(args.includes('libx264'), false);
    assert.equal(valueAfter(args, '-filter_complex').includes('fps='), false);
    assert.equal(args.at(-1), '/out/shot.png');
  });
});

describe('buildVideoArgs', () => {
  test('starts with the quiet, overwrite flags', () => {
    const args = buildVideoArgs(FILES, '/out/clip.mp4', 48);
    assert.deepEqual(args.slice(0, 4), [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
    ]);
  });

  test('the four inputs are the two sides then the two labels, in that order', () => {
    const args = buildVideoArgs(FILES, '/out/clip.mp4', 48);
    assert.deepEqual(inputsOf(args), [
      FILES.before,
      FILES.after,
      FILES.beforeLabel,
      FILES.afterLabel,
    ]);
  });

  test('both sides are brought to VIDEO_FPS, scaled to the height and stacked before-left', () => {
    const filter = valueAfter(
      buildVideoArgs(FILES, '/out/clip.mp4', 48),
      '-filter_complex',
    );
    assert.equal(countOf(filter, 'fps=25,'), 2);
    assert.equal(countOf(filter, 'scale=-2:48'), 2);
    assert.ok(filter.includes('[bl][al]hstack=inputs=2'), filter);
  });

  test('each label is overlaid on its own side', () => {
    const filter = valueAfter(
      buildVideoArgs(FILES, '/out/clip.mp4', 48),
      '-filter_complex',
    );
    assert.ok(filter.includes('[2:v]overlay=8:8'), filter);
    assert.ok(filter.includes('[3:v]overlay=8:8'), filter);
  });

  test('the output is H.264 in yuv420p with no audio and a fast-start container', () => {
    const args = buildVideoArgs(FILES, '/out/clip.mp4', 48);
    assert.equal(valueAfter(args, '-c:v'), 'libx264');
    assert.equal(valueAfter(args, '-pix_fmt'), 'yuv420p');
    assert.ok(args.includes('-an'));
    assert.equal(valueAfter(args, '-movflags'), '+faststart');
    assert.equal(args.includes('-frames:v'), false);
    assert.equal(args.at(-1), '/out/clip.mp4');
  });
});

describe('buildGifArgs', () => {
  test('starts with the quiet, overwrite flags', () => {
    const args = buildGifArgs('/out/clip.mp4', '/out/clip.gif', GIF_LADDER[0]);
    assert.deepEqual(args.slice(0, 4), [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
    ]);
  });

  test('the GIF is made from the combined MP4 alone', () => {
    const args = buildGifArgs('/out/clip.mp4', '/out/clip.gif', GIF_LADDER[0]);
    assert.deepEqual(inputsOf(args), ['/out/clip.mp4']);
    assert.equal(args.at(-1), '/out/clip.gif');
    assert.equal(valueAfter(args, '-loop'), '0');
  });

  for (const rung of GIF_LADDER) {
    test(`rung ${rung.fps} fps / ${rung.width}px sets fps and the width ceiling`, () => {
      const filter = valueAfter(
        buildGifArgs('/out/clip.mp4', '/out/clip.gif', rung),
        '-filter_complex',
      );
      assert.ok(filter.includes(`fps=${rung.fps},`), filter);
      assert.ok(filter.includes(`scale='min(${rung.width},iw)':-1`), filter);
      assert.ok(filter.includes('palettegen'), filter);
      assert.ok(filter.includes('paletteuse'), filter);
    });
  }
});

describe('GIF_LADDER', () => {
  test('each rung is strictly smaller than the one before in both fps and width', () => {
    for (let i = 1; i < GIF_LADDER.length; i++) {
      const previous = GIF_LADDER[i - 1];
      const current = GIF_LADDER[i];
      assert.ok(current.fps < previous.fps, `fps at rung ${i}`);
      assert.ok(current.width < previous.width, `width at rung ${i}`);
    }
  });
});

describe('renderLabel', () => {
  for (const text of LABEL_TEXTS) {
    test(`"${text}" is a valid RGBA PNG whose IHDR matches the returned size`, () => {
      const label = renderLabel(text, 2);
      const chunks = pngChunks(label.png);
      assert.deepEqual(
        chunks.map((chunk) => chunk.type),
        ['IHDR', 'IDAT', 'IEND'],
      );
      const header = chunks[0].data;
      assert.equal(header.readUInt32BE(0), label.width);
      assert.equal(header.readUInt32BE(4), label.height);
      assert.equal(header[8], 8, 'bit depth');
      assert.equal(header[9], 6, 'colour type RGBA');
    });

    test(`"${text}" decodes to width x height opaque pixels with white glyphs`, () => {
      const label = renderLabel(text, 1);
      const idat = pngChunks(label.png).find((c) => c.type === 'IDAT');
      assert.ok(idat);
      const raw = inflateSync(idat.data);
      assert.equal(raw.length, (label.width * 4 + 1) * label.height);
      for (let y = 0; y < label.height; y++) {
        const row = y * (label.width * 4 + 1);
        for (let x = 0; x < label.width; x++) {
          assert.equal(raw[row + 1 + x * 4 + 3], 255, `alpha at ${x},${y}`);
        }
      }
      let whiteGlyphPixels = 0;
      for (let y = 0; y < label.height; y++) {
        const row = y * (label.width * 4 + 1);
        for (let x = 0; x < label.width; x++) {
          if (raw[row + 1 + x * 4] === 255) whiteGlyphPixels++;
        }
      }
      assert.ok(whiteGlyphPixels > 0, 'at least one white glyph pixel');
      // The padding is the dark bar, so the top-left pixel is not a glyph.
      assert.equal(raw[1], raw[2]);
      assert.equal(raw[1], raw[3]);
      assert.ok(raw[1] < 255);
    });
  }

  test('a larger scale draws a larger label in both dimensions', () => {
    const small = renderLabel('BEFORE', 1);
    const large = renderLabel('BEFORE', 3);
    assert.ok(large.width > small.width, 'width');
    assert.ok(large.height > small.height, 'height');
  });

  test('a letter with no glyph throws rather than drawing a blank', () => {
    assert.throws(() => renderLabel('BEFORX', 1), RangeError);
    assert.throws(() => renderLabel('before', 1), /no glyph for "b"/);
  });

  test('empty text and a non-positive or fractional scale throw', () => {
    assert.throws(() => renderLabel('', 1), RangeError);
    assert.throws(() => renderLabel('AFTER', 0), RangeError);
    assert.throws(() => renderLabel('AFTER', 1.5), RangeError);
  });
});

describe('labelScale', () => {
  test('is at least 1 and grows with the frame height', () => {
    assert.equal(labelScale(48), 1);
    assert.equal(labelScale(720), 3);
    let previous = labelScale(2);
    assert.ok(previous >= 1);
    for (let height = 4; height <= 2160; height += 2) {
      const scale = labelScale(height);
      assert.ok(scale >= 1, `scale at ${height}`);
      assert.ok(scale >= previous, `monotonic at ${height}`);
      previous = scale;
    }
  });
});

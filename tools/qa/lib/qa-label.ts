/**
 * The "Before" / "After" label baked into a combined QA Artifact, drawn as a
 * PNG by this module instead of by ffmpeg's `drawtext`. `drawtext` needs
 * ffmpeg built with freetype and a usable font, which a stock Homebrew or CI
 * build may lack; a bitmap rendered here is the same on every machine.
 *
 * Pure: returns the PNG bytes. Only the letters of the two labels have
 * glyphs; any other text throws rather than drawing blanks.
 */
import { deflateSync } from 'node:zlib';

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
};

export const LABEL_TEXTS = ['BEFORE', 'AFTER'] as const;
export type LabelText = (typeof LABEL_TEXTS)[number];

export interface LabelImage {
  width: number;
  height: number;
  png: Buffer;
}

/** Glyph pixel size for a frame of the given height, so a label stays about 1/12 of it. */
export function labelScale(frameHeight: number): number {
  return Math.max(1, Math.floor(frameHeight / 240));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** White glyphs on an opaque dark bar, padded by one glyph pixel-row's worth. */
export function renderLabel(text: string, scale: number): LabelImage {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new RangeError('label scale must be a positive integer');
  }
  const letters = [...text];
  if (letters.length === 0) throw new RangeError('label text is empty');
  for (const letter of letters) {
    if (!GLYPHS[letter]) {
      throw new RangeError(`no glyph for "${letter}" in a QA label`);
    }
  }
  const pad = 2 * scale;
  const gap = scale;
  const width =
    pad * 2 + letters.length * GLYPH_WIDTH * scale + (letters.length - 1) * gap;
  const height = pad * 2 + GLYPH_HEIGHT * scale;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const gx = x - pad;
      const gy = Math.floor((y - pad) / scale);
      let on = false;
      if (gx >= 0 && gy >= 0 && gy < GLYPH_HEIGHT) {
        const stride = GLYPH_WIDTH * scale + gap;
        const letterIndex = Math.floor(gx / stride);
        const within = gx - letterIndex * stride;
        if (letterIndex < letters.length && within < GLYPH_WIDTH * scale) {
          on =
            GLYPHS[letters[letterIndex]][gy][Math.floor(within / scale)] ===
            '1';
        }
      }
      const value = on ? 255 : 24;
      const at = rowStart + 1 + x * 4;
      raw[at] = value;
      raw[at + 1] = value;
      raw[at + 2] = value;
      raw[at + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { width, height, png };
}

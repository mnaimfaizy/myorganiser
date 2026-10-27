/**
 * Generates the mobile app icon for iOS and Android from the BrandMark shield.
 * Usage: yarn mobile:app-icon:generate
 *
 * What the outputs are and where every value comes from lives in
 * tools/scripts/lib/mobile-app-icon.ts, which this script and
 * `yarn mobile:app-icon:check` share. This file writes the text outputs as
 * planned and rasterises the PNGs through Playwright's Chromium, as
 * generate-og-image.ts does.
 *
 * Re-run it after the shield or a Brand Primitive changes, and commit the
 * output; `yarn mobile:app-icon:check` fails until you do.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { planMobileAppIcon } from './lib/mobile-app-icon.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fromRoot = (path: string) => resolve(repoRoot, path);

// -------------------------------------------------------------------- PNG --

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

/**
 * Re-encodes an 8-bit RGBA screenshot as RGB. App Store Connect rejects an
 * app icon that carries an alpha channel, and Chromium always writes one.
 */
function withoutAlpha(png: Buffer): Buffer {
  let offset = PNG_SIGNATURE.length;
  let header: Buffer | undefined;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = data;
    if (type === 'IDAT') idat.push(data);
    offset += length + 12;
  }
  if (!header) throw new Error('The screenshot carries no IHDR chunk');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const [bitDepth, colourType, , , interlace] = header.subarray(8);
  if (colourType === 2) return png;
  if (bitDepth !== 8 || colourType !== 6 || interlace !== 0) {
    throw new Error('Expected an 8-bit, non-interlaced RGBA screenshot');
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgb = Buffer.alloc(height * (width * 3 + 1));
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
    );
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = previous[x];
      const upLeft = x >= 4 ? previous[x - 4] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const distLeft = Math.abs(estimate - left);
        const distUp = Math.abs(estimate - up);
        const distUpLeft = Math.abs(estimate - upLeft);
        if (distLeft <= distUp && distLeft <= distUpLeft) predicted = left;
        else predicted = distUp <= distUpLeft ? up : upLeft;
      }
      row[x] = (row[x] + predicted) & 0xff;
    }
    const out = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      if (row[x * 4 + 3] !== 255) {
        throw new Error('An iOS icon must be fully opaque');
      }
      row.copy(rgb, out + 1 + x * 3, x * 4, x * 4 + 3);
    }
    previous = row;
  }

  const rgbHeader = Buffer.from(header);
  rgbHeader[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', rgbHeader),
    pngChunk('IDAT', deflateSync(rgb, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ write --

function write(path: string, content: string | Buffer): void {
  mkdirSync(dirname(fromRoot(path)), { recursive: true });
  writeFileSync(fromRoot(path), content);
  console.log(`✓ ${path}`);
}

const { files, rasters } = planMobileAppIcon({ root: repoRoot });
for (const { path, content } of files) write(path, content);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const { path, svg, size, opaque } of rasters) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
    );
    const png = await page.screenshot({ type: 'png', omitBackground: true });
    write(path, opaque ? withoutAlpha(png) : png);
  }
} finally {
  await browser.close();
}

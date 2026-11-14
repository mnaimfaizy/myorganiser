// Real renders for a scenario step's `showing` option (PRD #1544). The Storyboard
// suite checks that a still is written; this one checks what a still shows.
// Chromium paints a solid magenta toast into the app's toast region, and the PNG
// `step()` writes must contain that colour when the step waits for the toast with
// `showing`, and must not when the step has no `showing`, which hides the toast
// region.
//
// The test launches Chromium. Without it the tests are skipped with a visible
// reason. Set QA_REQUIRE_REAL_RENDER=1 (CI's QA tooling step does) to make a
// missing Chromium a failure instead.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

import { chromium } from '@playwright/test';

import { TOAST_REGION, stepRecorder } from './lib/qa-scenario-context.ts';

const EXECUTABLE = chromium.executablePath();
const PRESENT = existsSync(EXECUTABLE);
const SKIP =
  PRESENT || process.env.QA_REQUIRE_REAL_RENDER
    ? false
    : "Playwright's Chromium is not installed (set QA_REQUIRE_REAL_RENDER=1 to require it)";

const MISSING_CHROMIUM = `Playwright's Chromium is required (QA_REQUIRE_REAL_RENDER is set) but not found at ${EXECUTABLE}`;

const VIEWPORT = { width: 800, height: 600 };
/** The toast, in viewport pixels: it lies wholly inside the viewport. */
const TOAST = { left: 100, top: 100, width: 400, height: 200 };
const TOAST_AREA = TOAST.width * TOAST.height;
/** The toast appears this long after the page loads, and lives this long after that. */
const TOAST_APPEARS_MS = 300;
const TOAST_LIFETIME_MS = 2_000;
/** Solid magenta: nothing else on the page is painted this colour. */
const MAGENTA: Rgb = [255, 0, 255];
/** Per-channel slack for a match. The page is lossless, so this is small. */
const COLOUR_TOLERANCE = 8;
const TOAST_SELECTOR = `${TOAST_REGION} [data-toast]`;

type Rgb = [red: number, green: number, blue: number];

/**
 * An app-shaped page: a toast region, and a magenta toast inserted into it after
 * TOAST_APPEARS_MS. With `removeAfterMs`, the toast removes itself that long
 * after it appeared; with `null`, it stays.
 */
function appPage(removeAfterMs: number | null): string {
  const remove =
    removeAfterMs === null
      ? ''
      : `setTimeout(function () { toast.remove(); }, ${removeAfterMs});`;
  return `<!doctype html>
<html><body style="margin:0;background:#ffffff">
<div role="region" aria-label="Notifications (F8)"></div>
<script>
setTimeout(function () {
  var toast = document.createElement('div');
  toast.setAttribute('data-toast', '');
  toast.setAttribute('role', 'status');
  toast.style.cssText = 'position:fixed;left:${TOAST.left}px;top:${TOAST.top}px;width:${TOAST.width}px;height:${TOAST.height}px;background:#ff00ff';
  document.querySelector('[role="region"]').appendChild(toast);
  ${remove}
}, ${TOAST_APPEARS_MS});
</script>
</body></html>`;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface Image {
  width: number;
  height: number;
  /** Bytes per pixel: 3 for RGB, 4 for RGBA. */
  bpp: number;
  /** The unfiltered 8-bit samples, row by row. */
  pixels: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const estimate = a + b - c;
  const distA = Math.abs(estimate - a);
  const distB = Math.abs(estimate - b);
  const distC = Math.abs(estimate - c);
  if (distA <= distB && distA <= distC) return a;
  return distB <= distC ? b : c;
}

function predictor(
  filter: number,
  left: number,
  up: number,
  upLeft: number,
): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4:
      return paeth(left, up, upLeft);
    default:
      throw new Error(`PNG filter ${filter} is not one the spec defines`);
  }
}

/**
 * Decodes an 8-bit, non-interlaced RGB or RGBA PNG, which is what Chromium
 * writes for a screenshot. Built on Node's zlib, so it adds no dependency.
 */
function decodePng(png: Buffer): Image {
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE), 'the file is a PNG');
  let header: Buffer | undefined;
  const idat: Buffer[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = data;
    if (type === 'IDAT') idat.push(data);
    offset += length + 12;
  }
  assert.ok(header, 'the PNG has an IHDR chunk');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const colourType = header[9];
  const interlace = header[12];
  assert.equal(bitDepth, 8, 'the PNG is 8 bits a channel');
  assert.ok(
    colourType === 2 || colourType === 6,
    `the PNG is RGB or RGBA, not colour type ${colourType}`,
  );
  assert.equal(interlace, 0, 'the PNG is not interlaced');

  const bpp = colourType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(
    raw.length,
    height * (stride + 1),
    'the image data is the size its header says',
  );
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const input = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? pixels[row + x - bpp] : 0;
      const up = y > 0 ? pixels[row - stride + x] : 0;
      const upLeft = x >= bpp && y > 0 ? pixels[row - stride + x - bpp] : 0;
      pixels[row + x] =
        (raw[input + x] + predictor(filter, left, up, upLeft)) & 0xff;
    }
  }
  return { width, height, bpp, pixels };
}

/** How many pixels of the image are the colour, within COLOUR_TOLERANCE on each channel. */
function countColour(image: Image, [red, green, blue]: Rgb): number {
  let matches = 0;
  for (let i = 0; i < image.pixels.length; i += image.bpp) {
    if (
      Math.abs(image.pixels[i] - red) <= COLOUR_TOLERANCE &&
      Math.abs(image.pixels[i + 1] - green) <= COLOUR_TOLERANCE &&
      Math.abs(image.pixels[i + 2] - blue) <= COLOUR_TOLERANCE
    ) {
      matches += 1;
    }
  }
  return matches;
}

test(
  'a step with showing captures the toast that appears after the step began',
  { skip: SKIP },
  async () => {
    assert.ok(PRESENT, MISSING_CHROMIUM);
    const dir = mkdtempSync(join(tmpdir(), 'scenario-context-real-'));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: VIEWPORT });
      await page.setContent(appPage(TOAST_LIFETIME_MS));
      const recorder = stepRecorder({
        side: 'before',
        workDir: dir,
        startedAt: Date.now(),
      });
      // Taken at once, before the toast leaves: the step waits for it to show.
      await recorder.step(page, 'the toast shows', {
        showing: page.locator(TOAST_SELECTOR),
      });

      assert.equal(recorder.steps.length, 1, 'one step is recorded');
      const image = decodePng(readFileSync(recorder.steps[0].still));
      assert.equal(
        image.width,
        VIEWPORT.width,
        'the still is the viewport wide',
      );
      const matches = countColour(image, MAGENTA);
      assert.ok(
        matches >= TOAST_AREA * 0.9,
        `the still has ${matches} magenta pixels; the toast covers ${TOAST_AREA}`,
      );
    } finally {
      await browser.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'a step without showing hides the toast region, so a toast on the page is not in its still',
  { skip: SKIP },
  async () => {
    assert.ok(PRESENT, MISSING_CHROMIUM);
    const dir = mkdtempSync(join(tmpdir(), 'scenario-context-real-'));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: VIEWPORT });
      // The toast stays, so it is on screen for the whole test: the control is
      // not a race against its removal.
      await page.setContent(appPage(null));
      await page.locator(TOAST_SELECTOR).waitFor({ state: 'visible' });
      // A raw screenshot first: it proves the magenta is really painted, so an
      // absent colour in the step's still means the step hid it.
      const raw = join(dir, 'raw.png');
      await page.screenshot({ path: raw });
      const painted = countColour(decodePng(readFileSync(raw)), MAGENTA);
      assert.ok(
        painted >= TOAST_AREA * 0.9,
        `the raw page has ${painted} magenta pixels; the control needs the toast painted`,
      );

      const recorder = stepRecorder({
        side: 'before',
        workDir: dir,
        startedAt: Date.now(),
      });
      await recorder.step(page, 'the toast is hidden');

      assert.equal(recorder.steps.length, 1, 'one step is recorded');
      const image = decodePng(readFileSync(recorder.steps[0].still));
      assert.equal(
        countColour(image, MAGENTA),
        0,
        'the still has no magenta pixels',
      );
    } finally {
      await browser.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

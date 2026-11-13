/**
 * Renders an annotated MP4's overlay pages (`video-overlay-html.ts`) to PNGs
 * in Playwright's Chromium, as the Storyboard is rendered (PRD #1544), and
 * wires the real machine behind `makeAnnotatedVideo`.
 *
 * One browser renders every overlay of one MP4. Each page is set at its exact
 * pixel size and screenshotted clipped to it; the label keeps a transparent
 * background so the recording shows around it. The pages are set as content,
 * not written to disk: they reference no file.
 *
 * Kept apart from the executor so its tests never load a browser. The one
 * test that runs it is `tools/qa/storyboard.real-render.test.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

import type { AnnotateDeps, OverlayPng } from './qa-combine-executor.ts';
import { nodeCombineDeps } from './qa-combine-node-deps.ts';
import { readTokenCss } from './storyboard-palette.ts';

/** Renders each overlay page to its PNG; on failure, removes any it wrote and rejects. */
export async function renderOverlayPngs(
  pages: readonly OverlayPng[],
): Promise<void> {
  const browser = await chromium.launch();
  try {
    for (const overlay of pages) {
      const page = await browser.newPage({
        viewport: { width: overlay.width, height: overlay.height },
      });
      await page.setContent(overlay.html, { waitUntil: 'load' });
      await page.screenshot({
        path: overlay.path,
        omitBackground: overlay.transparent,
        clip: { x: 0, y: 0, width: overlay.width, height: overlay.height },
      });
      await page.close();
    }
  } catch (error) {
    for (const overlay of pages) rmSync(overlay.path, { force: true });
    throw error;
  } finally {
    await browser.close();
  }
}

/**
 * The real `AnnotateDeps`: system ffmpeg, Chromium, and the tokens read from
 * `repoRoot`. Overlay PNGs go in a fresh directory under `tempRoot` (the
 * system temp directory unless given), removed once the MP4 is made.
 */
export function nodeAnnotateDeps(
  repoRoot: string,
  tempRoot: string = tmpdir(),
): AnnotateDeps {
  const { run, exists, makeDir, removePath } = nodeCombineDeps();
  return {
    run,
    exists,
    makeDir,
    removePath,
    makeTempDir: () => mkdtempSync(join(tempRoot, 'qa-overlays-')),
    tokenCss: () => readTokenCss(repoRoot),
    renderPngs: renderOverlayPngs,
  };
}

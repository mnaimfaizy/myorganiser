/**
 * Renders a Storyboard to a PNG in Playwright's Chromium, the browser the
 * runner already plays scenarios in, through the repository's existing
 * `@playwright/test` dependency (PRD #1544). Each render launches its own
 * browser, as each scenario run does. Real fonts and any text; no ffmpeg
 * `drawtext`.
 *
 * The page (`storyboard-html.ts`, coloured from the stylesheets
 * `storyboard-palette.ts` reads) is written next to the PNG and opened by
 * `file://` URL, so the stills it references by absolute `file://` URL load.
 * It is removed once the screenshot is taken, and a failed render leaves no
 * PNG behind.
 *
 * Kept apart from the executor so its tests never load a browser. The one
 * test that runs it is `tools/qa/storyboard.real-render.test.ts`.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

import { VIEWPORT } from './qa-run.ts';
import { storyboardHtml } from './storyboard-html.ts';
import { readTokenCss } from './storyboard-palette.ts';
import type { Storyboard } from './storyboard.ts';

/** Screenshots an HTML page, 1280 px wide and as tall as its content, to a PNG. */
export async function renderHtml(html: string, pngPath: string): Promise<void> {
  const htmlPath = `${pngPath}.html`;
  const browser = await chromium.launch();
  try {
    writeFileSync(htmlPath, html, { mode: 0o600 });
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.screenshot({ path: pngPath, fullPage: true });
  } catch (error) {
    rmSync(pngPath, { force: true });
    throw error;
  } finally {
    await browser.close();
    rmSync(htmlPath, { force: true });
  }
}

/**
 * The real `RunDeps.renderStoryboard`: a step's still path is relative to
 * `stillRoot` (the run's `--out`), and the tokens are read from `repoRoot`.
 */
export function storyboardRenderer(
  repoRoot: string,
): (
  storyboard: Storyboard,
  stillRoot: string,
  pngPath: string,
) => Promise<void> {
  return async (storyboard, stillRoot, pngPath) => {
    const html = storyboardHtml(
      storyboard,
      (step) => pathToFileURL(join(stillRoot, step.still)).href,
      readTokenCss(repoRoot),
    );
    await renderHtml(html, pngPath);
  };
}

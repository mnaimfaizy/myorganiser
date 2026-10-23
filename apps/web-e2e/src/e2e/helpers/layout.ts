import { expect, type Page } from '@playwright/test';

/**
 * Assert the page's only `<h1>` has exactly `text`. Both checks retry, so the
 * count can be 1 on the old screen while the new heading is still rendering:
 * the text check waits it out.
 */
export async function expectSingleH1(page: Page, text: string): Promise<void> {
  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText(text);
}

/**
 * Assert the page does not scroll sideways at the current viewport.
 *
 * Two measures, because either can hide an overflow the other misses:
 * - the document: `scrollWidth` past `clientWidth` on `<html>` means the page
 *   itself scrolls sideways;
 * - `<main>`: the dashboard's content column. Its own `scrollWidth` past its
 *   `clientWidth` means content spills out of the column even when the
 *   document is clipped and does not scroll.
 *
 * Polled, because a layout settles after the route's content does. A missing
 * `<main>` fails rather than passing silently: every dashboard route renders one.
 * `label` names the screen in the failure message.
 */
export async function expectNoHorizontalOverflow(
  page: Page,
  label: string,
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const root = document.documentElement;
          const main = document.querySelector('main');
          const rootOverflow = root.scrollWidth - root.clientWidth;
          const mainOverflow = main
            ? main.scrollWidth - main.clientWidth
            : Number.POSITIVE_INFINITY;
          return Math.max(rootOverflow, mainOverflow);
        }),
      { message: label, timeout: 10000 },
    )
    .toBeLessThanOrEqual(0);
}

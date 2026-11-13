/**
 * The browser side of a scenario's `step()` and `observed()` (PRD #1544),
 * for `qa-run-browser.ts`. Kept apart from the executor so its tests never
 * load a browser.
 *
 * Before its still, `step()`:
 *
 *   - settles: waits for the subject to be visible and its box to hold still
 *     across two animation frames, and for no finite animation to be running,
 *     then takes the still with animations disabled. A wait that times out
 *     still takes the still, recorded `settled: false` and tagged on the
 *     Storyboard;
 *   - hides the toast region, unless the subject is a toast or sits inside
 *     one, so a stale toast does not cover or confuse the subject;
 *   - records the subject's bounding box, in viewport pixels.
 *
 * Only the runner's own page exists in this slice: it is device A, tab A.
 * Named devices and tabs are #1547's.
 */
import { join } from 'node:path';

import type { Locator, Page } from '@playwright/test';

import {
  type Box,
  type StepOptions,
  type StepRecord,
  stepNumber,
} from './qa-scenario.ts';
import type { Side } from './qa-stack.ts';

/** The app's toast region: Radix Toast's viewport, wrapped in a labelled region. */
export const TOAST_REGION = '[role="region"][aria-label^="Notifications"]';

/** The default device and tab: the runner's own page. */
export const DEFAULT_DEVICE = 'A';
export const DEFAULT_TAB = 'A';

/** The label on the default page's stills. Named devices and tabs are #1547's. */
export const DEFAULT_LABEL = `Device ${DEFAULT_DEVICE}`;

/** How long settling may wait before the still is taken anyway. */
const SETTLE_TIMEOUT_MS = 5_000;
/** How many frame pairs a subject's box may keep moving before the still is taken anyway. */
const STABLE_TRIES = 30;

/** True when no finite animation is running; an endless one (a spinner) never settles. */
const NO_RUNNING_ANIMATION = `document.getAnimations().every((a) => a.playState !== 'running' || (a.effect && a.effect.getTiming().iterations === Infinity))`;

const TWO_FRAMES = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`;

function sameBox(a: Box | null, b: Box | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

/**
 * Waits for the subject to be visible and its box to stop moving; false when
 * it was still moving after every try. A subject that never becomes visible
 * throws, failing the run.
 */
async function settleSubject(page: Page, subject: Locator): Promise<boolean> {
  await subject.waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS });
  let box = await subject.boundingBox();
  for (let i = 0; i < STABLE_TRIES; i++) {
    await page.evaluate(TWO_FRAMES);
    const next = await subject.boundingBox();
    if (sameBox(box, next)) return true;
    box = next;
  }
  return false;
}

/** Waits for no finite animation to be running; false when one still was at the timeout. */
async function settleAnimations(page: Page): Promise<boolean> {
  return page
    .waitForFunction(NO_RUNNING_ANIMATION, undefined, {
      timeout: SETTLE_TIMEOUT_MS,
    })
    .then(
      () => true,
      () => false,
    );
}

async function insideToast(subject: Locator): Promise<boolean> {
  return subject.evaluate(
    (element: { closest(selector: string): unknown }, selector: string) =>
      element.closest(selector) !== null,
    TOAST_REGION,
  );
}

export interface StepRecorder {
  step(on: Page, caption: string, options?: StepOptions): Promise<void>;
  observed(text: string): void;
  /** Every step taken so far, in order. */
  readonly steps: readonly StepRecord[];
  /** The last text passed to `observed`, if any. */
  observation(): string | undefined;
}

/** A recorder for one run: stills go into `workDir`, times count from `startedAt`. */
export function stepRecorder(run: {
  side: Side;
  workDir: string;
  startedAt: number;
  now?: () => number;
}): StepRecorder {
  const now = run.now ?? Date.now;
  const steps: StepRecord[] = [];
  let observation: string | undefined;
  return {
    steps,
    observation: () => observation,
    observed(text) {
      observation = text;
    },
    async step(on, caption, options = {}) {
      const { subject } = options;
      const index = steps.length + 1;
      const subjectSettled = subject ? await settleSubject(on, subject) : true;
      const animationsSettled = await settleAnimations(on);
      const box: Box | null = subject ? await subject.boundingBox() : null;
      const showToasts = subject ? await insideToast(subject) : false;
      const still = join(run.workDir, `step-${stepNumber(index)}.png`);
      const atMs = now() - run.startedAt;
      await on.screenshot({
        path: still,
        animations: 'disabled',
        ...(showToasts
          ? {}
          : { style: `${TOAST_REGION}{visibility:hidden !important}` }),
      });
      steps.push({
        side: run.side,
        index,
        device: DEFAULT_DEVICE,
        tab: DEFAULT_TAB,
        label: DEFAULT_LABEL,
        caption,
        still,
        subject: box,
        atMs,
        // The still is taken anyway, and marked, so a reader can tell.
        ...(subjectSettled && animationsSettled ? {} : { settled: false }),
      });
    },
  };
}

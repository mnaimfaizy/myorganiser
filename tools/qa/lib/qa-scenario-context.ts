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
 * The runner owns devices and tabs (`deviceRegistry`): the runner's own page
 * is device A, tab A, and a script asks for more with `device(name).tab(name)`.
 * Each step is labelled from the tab it names, and every device is closed at
 * the end, whatever happened.
 */
import { join } from 'node:path';

import type { BrowserContext, Locator, Page, Response } from '@playwright/test';

import {
  type Box,
  type StepOptions,
  type StepRecord,
  stepNumber,
} from './qa-scenario.ts';
import type { RunOutcome } from './qa-run.ts';
import type { Side } from './qa-stack.ts';

/** The app's toast region: Radix Toast's viewport, wrapped in a labelled region. */
export const TOAST_REGION = '[role="region"][aria-label^="Notifications"]';

/** The default device and tab: the runner's own page. */
export const DEFAULT_DEVICE = 'A';
export const DEFAULT_TAB = 'A';

/**
 * A tab's label on its stills: "Device <d> · tab <t>", or just "Device <d>"
 * when the device has one tab and it is named like the device.
 */
export function tabLabel(
  device: string,
  tab: string,
  tabsOnDevice: number,
): string {
  return tabsOnDevice === 1 && tab === device
    ? `Device ${device}`
    : `Device ${device} · tab ${tab}`;
}

/** A tab the registry made or adopted. */
export interface TabEntry {
  device: string;
  tab: string;
  page: Page;
  /**
   * Milliseconds from the run's start to when the tab's page opened, which is
   * when its recording starts; the default tab's is 0. A step's `atMs` minus
   * this is the step's moment in the tab's own video.
   */
  openedAtMs: number;
}

/** A tab's recording, once its device is closed; `path` is `null` when none was written. */
export interface TabRecording {
  device: string;
  tab: string;
  path: string | null;
  /** When the tab's recording starts, in milliseconds from the run's start. */
  openedAtMs: number;
}

export interface DeviceRegistry {
  /** A named device; its `tab(name)` opens the tab on first use and returns the same page after. */
  device(name: string): { tab(name: string): Promise<Page> };
  /**
   * A tab's label once the run is over, from every tab the device ended with:
   * one tab, one label, for every step that named it. `lookup` labels from
   * what is open at the moment of a step; this is the label a Storyboard shows.
   */
  finalLabel(device: string, tab: string): string;
  /** The device and tab a page belongs to, or `undefined` for a page the runner did not make. */
  lookup(
    page: Page,
  ): { device: string; tab: string; label: string } | undefined;
  /** Every tab opened so far, the default first. */
  tabs(): readonly TabEntry[];
  /**
   * Closes every device context, even when one fails to close, then reports
   * each tab's recording. Safe after a timeout or a throw.
   */
  closeAll(): Promise<TabRecording[]>;
}

/**
 * The runner's devices. `open` makes a context at the fixed viewport and
 * baseURL with video on, and hooks its backend calls; `own` is the runner's
 * context and page, already open, which are device A, tab A.
 */
export function deviceRegistry(deps: {
  open(device: string): Promise<BrowserContext>;
  own: { context: BrowserContext; page: Page };
  /** How long closing waits for a tab or device still opening; defaults to 2s. */
  openGraceMs?: number;
  /** Milliseconds since the run's start, stamped on each tab as it opens; defaults to 0. */
  elapsedMs?: () => number;
}): DeviceRegistry {
  let closed = false;
  const contexts = new Map<string, Promise<BrowserContext>>();
  const tabs = new Map<string, Map<string, Promise<TabEntry>>>();
  const entries: TabEntry[] = [];
  const byPage = new Map<Page, TabEntry>();

  const elapsedMs = deps.elapsedMs ?? (() => 0);
  const register = (
    device: string,
    tab: string,
    page: Page,
    openedAtMs: number,
  ): TabEntry => {
    const entry = { device, tab, page, openedAtMs };
    entries.push(entry);
    byPage.set(page, entry);
    return entry;
  };
  contexts.set(DEFAULT_DEVICE, Promise.resolve(deps.own.context));
  tabs.set(
    DEFAULT_DEVICE,
    new Map([
      [
        DEFAULT_TAB,
        Promise.resolve(
          register(DEFAULT_DEVICE, DEFAULT_TAB, deps.own.page, 0),
        ),
      ],
    ]),
  );

  const tabsOf = (device: string) => {
    let known = tabs.get(device);
    if (!known) {
      known = new Map();
      tabs.set(device, known);
    }
    return known;
  };
  const contextOf = (device: string) => {
    let context = contexts.get(device);
    if (!context) {
      context = deps.open(device).then(async (opened) => {
        // Opened after the run was closed: nothing will close it later.
        if (closed) await opened.close().catch(() => undefined);
        return opened;
      });
      contexts.set(device, context);
    }
    return context;
  };

  return {
    device(device) {
      return {
        async tab(tab) {
          if (closed) {
            throw new Error(
              `device ${device}, tab ${tab}: the run has ended, so no tab can open`,
            );
          }
          const known = tabsOf(device);
          let entry = known.get(tab);
          if (!entry) {
            entry = contextOf(device).then(async (context) => {
              const opened = await context.newPage();
              return register(device, tab, opened, elapsedMs());
            });
            known.set(tab, entry);
          }
          return (await entry).page;
        },
      };
    },
    lookup(page) {
      const entry = byPage.get(page);
      if (!entry) return undefined;
      const count = entries.filter((e) => e.device === entry.device).length;
      return {
        device: entry.device,
        tab: entry.tab,
        label: tabLabel(entry.device, entry.tab, count),
      };
    },
    tabs: () => entries,
    finalLabel(device, tab) {
      const count = entries.filter((e) => e.device === device).length;
      return tabLabel(device, tab, count);
    },
    async closeAll() {
      closed = true;
      // A tab or device still opening (a timeout can land mid-open) gets a
      // short grace to join; one that never settles is left, and closed if it
      // opens late, so it can never keep device A open.
      const grace = deps.openGraceMs ?? OPEN_GRACE_MS;
      await settledWithin(
        [...tabs.values()].flatMap((known) => [...known.values()]),
        grace,
      );
      await settledWithin([...contexts.values()], grace);
      // The recording is complete only once its context closes.
      const videos = entries.map((entry) => ({
        entry,
        video: entry.page.video(),
      }));
      const opened = await Promise.all(
        [...contexts.values()].map((context) => settledValue(context, grace)),
      );
      await Promise.allSettled(
        opened.flatMap((context) =>
          context ? [Promise.resolve().then(() => context.close())] : [],
        ),
      );
      return Promise.all(
        videos.map(async ({ entry, video }) => ({
          device: entry.device,
          tab: entry.tab,
          path: video ? await video.path().catch(() => null) : null,
          openedAtMs: entry.openedAtMs,
        })),
      );
    },
  };
}

/** How long closing waits for a device or tab that is still opening. */
const OPEN_GRACE_MS = 2_000;

/** Waits for the promise, never longer than `ms`; its value if it was fulfilled by then. */
async function settledValue<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value) => value,
        () => undefined,
      ),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function settledWithin(
  promises: readonly Promise<unknown>[],
  ms: number,
): Promise<void> {
  await Promise.all(promises.map((promise) => settledValue(promise, ms)));
}

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

/**
 * Records the calls a context makes to the QA backend. Hooked on every device
 * the runner opens, not only the first. `record` is called for each response
 * whose origin is the backend's; its promises collect in `pending`.
 */
export function watchBackend<T>(
  context: Pick<BrowserContext, 'on'>,
  backendOrigin: string,
  record: (response: Response) => Promise<T>,
  pending: Promise<T>[],
): void {
  context.on('response', (response) => {
    if (new URL(response.url()).origin === backendOrigin) {
      pending.push(record(response));
    }
  });
}

/** How a scenario's run ended. */
export interface Played {
  outcome: RunOutcome;
  message?: string;
  returned?: unknown;
  /** Each tab's recording, from closing every device. */
  recordings: TabRecording[];
}

/**
 * Runs a scenario against a time limit, then closes every device whatever
 * happened: it passed, threw, cannot run, or timed out. `before` closing
 * runs first (the final screenshot), and may not throw.
 */
export async function playScenario(play: {
  run(): Promise<unknown>;
  timeoutMs: number;
  isCannotRun(error: unknown): boolean;
  describe(error: unknown): string;
  registry: Pick<DeviceRegistry, 'closeAll'>;
  /** Called after the run ends and before any device closes. */
  beforeClose?(): Promise<void>;
}): Promise<Played> {
  let recordings: TabRecording[] = [];
  let result: Omit<Played, 'recordings'>;
  let timer: NodeJS.Timeout | undefined;
  try {
    try {
      const returned = await Promise.race([
        play.run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`timed out after ${play.timeoutMs / 1000}s`)),
            play.timeoutMs,
          );
        }),
      ]);
      result = { outcome: 'pass', returned };
    } catch (error) {
      result = {
        outcome: play.isCannotRun(error) ? 'cannot-run' : 'fail',
        message: play.describe(error),
      };
    } finally {
      clearTimeout(timer);
    }
    await play.beforeClose?.().catch(() => undefined);
  } finally {
    // Every device closes, after a timeout or a throw too.
    recordings = await play.registry.closeAll();
  }
  return { ...result, recordings };
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
  /** Which device and tab a page is; a page it does not know is the default. */
  lookup?: DeviceRegistry['lookup'];
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
      const { subject, checked } = options;
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
      const named = run.lookup?.(on) ?? {
        device: DEFAULT_DEVICE,
        tab: DEFAULT_TAB,
        label: tabLabel(DEFAULT_DEVICE, DEFAULT_TAB, 1),
      };
      steps.push({
        side: run.side,
        index,
        device: named.device,
        tab: named.tab,
        label: named.label,
        caption,
        still,
        subject: box,
        atMs,
        ...(checked ? { checked: true as const } : {}),
        // The still is taken anyway, and marked, so a reader can tell.
        ...(subjectSettled && animationsSettled ? {} : { settled: false }),
      });
    },
  };
}

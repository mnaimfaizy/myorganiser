/**
 * The scenario contract: what a scenario script under `tmp/qa/` exports, what
 * its `run` is handed, what one `step()` records, and the check that refuses
 * a malformed script before the QA stack starts (ADR 0147 decision 1; PRD
 * #1544's Storyboards).
 *
 * A scenario with a screen (`video` or `screenshot`) must also declare its
 * `title` and the result each side is expected to show, because its QA
 * Artifact, a Storyboard, stands alone: someone holding only the file can
 * tell which scenario it is and what each side was expected to do. A
 * `video` scenario also declares `tab`, the tab its annotated MP4 follows. A
 * `transcript` or `none` scenario needs none of these.
 *
 * Pure: types and a parser. The browser side of `step()` is
 * `qa-scenario-context.ts`; the runner's rules are `qa-run.ts`.
 */
import type { Locator, Page } from '@playwright/test';

import type { Side } from './qa-stack.ts';

/** A scenario's `Capture:` line (ADR 0147 decision 4). */
export const CAPTURES = ['video', 'screenshot', 'transcript', 'none'] as const;
export type Capture = (typeof CAPTURES)[number];

/**
 * Whether a capture has a screen, so its scenario declares a title and
 * expected results, calls `step()`, and gets a Storyboard.
 */
export const SCREEN_CAPTURE = {
  video: true,
  screenshot: true,
  transcript: false,
  none: false,
} as const satisfies Record<Capture, boolean>;

/** A refusal to run at all: a bad invocation or a malformed script, exit 2. */
export class RunInputError extends Error {}

/** Thrown by a scenario's `cannotRun`: the side cannot run this scenario. */
export class CannotRunError extends Error {}

/** A QA Account's sign-in values, so Before and After sign in alike. */
export interface ScenarioAccount {
  id: string;
  email: string;
  password: string;
  vaultPassphrase: string;
}

/** A rectangle in viewport pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What one `step()` call records. Saved in the run's output so a Storyboard
 * can be re-rendered without running Before and After again.
 */
export interface StepRecord {
  side: Side;
  /** 1-based, in call order. */
  index: number;
  device: string;
  tab: string;
  /** How the still is labelled, e.g. "Device A". */
  label: string;
  caption: string;
  /** The still's path: in the run's work directory, then relative to `--out` once kept. */
  still: string;
  /** The step's subject in the still, or `null` for a full-frame still. */
  subject: Box | null;
  /** Milliseconds from the run's start. */
  atMs: number;
  /** Set when the script marked this step as the one the check is made on. */
  checked?: true;
  /**
   * `false` when the still was taken after settling timed out (the subject
   * kept moving, or an animation kept running); absent when it settled.
   */
  settled?: false;
}

/** A step's number as it names a still file: two digits, zero-padded. */
export function stepNumber(index: number): string {
  return String(index).padStart(2, '0');
}

export interface StepOptions {
  /** The element the step is about: the still is cropped to it and it is outlined. */
  subject?: Locator;
  /**
   * Marks this step as the one the scenario's check is made on. Without a
   * marked step it is the last one. At most one step per side may be marked.
   */
  checked?: true;
}

/** What a scenario's `run` is given. */
export interface ScenarioContext {
  /** The default device and tab: device A, tab A. */
  page: Page;
  /**
   * A named device; `device(name).tab(name)` returns that tab's page, opening
   * it on first use. Every tab is recorded and labelled, and every device is
   * closed by the runner at the end.
   */
  device(name: string): { tab(name: string): Promise<Page> };
  /** The QA stack's web origin. */
  baseURL: string;
  side: Side;
  account(id: string): ScenarioAccount;
  /**
   * Marks a value that must never appear in a Storyboard title, caption,
   * expected or observed text. `account()` marks its password and vault
   * passphrase already. Exact substrings only.
   */
  secret(value: string): void;
  /** Ends this run as "cannot run" on this side. */
  cannotRun(reason: string): never;
  /** Settles the page and takes one numbered still of it for the Storyboard. */
  step(on: Page, caption: string, options?: StepOptions): Promise<void>;
  /** What a passing run observed; an alternative to returning it. */
  observed(text: string): void;
}

/** The result each side was expected to show, copied from the QA Plan. */
export interface ExpectedResults {
  before?: string;
  after: string;
}

/** What a scenario script under `tmp/qa/` exports as its default. */
export interface Scenario {
  id: string;
  /** The plan's `Capture:` line, copied. */
  capture: Capture;
  /** The plan's scenario heading. Required when the capture has a screen. */
  title?: string;
  /** Required when the capture has a screen. */
  expected?: ExpectedResults;
  /**
   * The tab the annotated MP4 follows, by its tab name (`'A'` is the default
   * tab), matched across devices. Required when the capture is `video`.
   */
  tab?: string;
  /**
   * Resolves = pass, with what it observed as a returned string (or through
   * `observed`); throws = fail, the message being what it observed;
   * `cannotRun` = cannot run.
   */
  run(context: ScenarioContext): Promise<string | void>;
}

/** A screen scenario, once parsed: its title and expected results are present. */
export type ScreenScenario = Scenario & {
  title: string;
  expected: ExpectedResults;
};

/** A `video` scenario, once parsed: it also names the tab its MP4 follows. */
export type VideoScenario = ScreenScenario & { capture: 'video'; tab: string };

export interface ParseOptions {
  /** True when the run plays Before up front (a fix, or a feature `--with-before`). */
  runsBefore: boolean;
}

/** The id shape: it names files, so no separators or dots. */
export const SCENARIO_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function isOneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
  );
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Narrows a script's default export to a `Scenario`, naming the file on a
 * refusal. A screen scenario must declare `title` and `expected.after`, and
 * `expected.before` too when the run plays Before. A `video` scenario must
 * also declare `tab`, the tab its MP4 follows.
 */
export function parseScenario(
  exported: unknown,
  file: string,
  options: ParseOptions,
): Scenario {
  if (typeof exported !== 'object' || exported === null) {
    throw new RunInputError(
      `${file}: the default export must be a scenario object`,
    );
  }
  const { id, capture, run, title, expected, tab } = exported as Record<
    string,
    unknown
  >;
  if (typeof id !== 'string' || !SCENARIO_ID.test(id)) {
    throw new RunInputError(
      `${file}: id must be letters, digits, "-" or "_" (it names files)`,
    );
  }
  if (!isOneOf(CAPTURES, capture)) {
    throw new RunInputError(
      `${file}: capture must be one of ${CAPTURES.join(', ')} (the plan's Capture: line)`,
    );
  }
  if (typeof run !== 'function') {
    throw new RunInputError(`${file}: run must be a function`);
  }
  if (SCREEN_CAPTURE[capture]) {
    if (!isText(title)) {
      throw new RunInputError(
        `${file}: a ${capture} scenario must declare title (the plan's scenario heading)`,
      );
    }
    if (typeof expected !== 'object' || expected === null) {
      throw new RunInputError(
        `${file}: a ${capture} scenario must declare expected: { before, after } (the plan's Expected line)`,
      );
    }
    const { before, after } = expected as Record<string, unknown>;
    if (!isText(after)) {
      throw new RunInputError(
        `${file}: a ${capture} scenario must declare expected.after`,
      );
    }
    if (options.runsBefore && !isText(before)) {
      throw new RunInputError(
        `${file}: a ${capture} scenario run on Before must declare expected.before`,
      );
    }
    if (before !== undefined && !isText(before)) {
      throw new RunInputError(
        `${file}: expected.before must be text when it is given`,
      );
    }
  }
  if (capture === 'video' && !isText(tab)) {
    throw new RunInputError(
      `${file}: a video scenario must declare tab (the tab its MP4 follows, e.g. 'A' for the default tab)`,
    );
  }
  return exported as Scenario;
}

/** True when the scenario has a screen, narrowing it to its parsed shape. */
export function isScreenScenario(
  scenario: Scenario,
): scenario is ScreenScenario {
  return SCREEN_CAPTURE[scenario.capture];
}

/** True when the scenario is a `video` one, narrowing it to its parsed shape. */
export function isVideoScenario(scenario: Scenario): scenario is VideoScenario {
  return scenario.capture === 'video';
}

/** Refuses two scripts with the same id. */
export function checkScenarioIds(scenarios: readonly Scenario[]): void {
  if (scenarios.length === 0) {
    throw new RunInputError('no scenario scripts (*.ts) in --scenarios');
  }
  const seen = new Set<string>();
  for (const { id } of scenarios) {
    if (seen.has(id))
      throw new RunInputError(`scenario id "${id}" is used twice`);
    seen.add(id);
  }
}

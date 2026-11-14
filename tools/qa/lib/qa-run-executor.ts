/**
 * Runs `yarn qa:run` (ADR 0147 decisions 1-5 and 7): starts the QA stack,
 * plays every scenario script on Before and After in Chromium, keeps what
 * each `Capture:` line asks for, then grades, makes each screen scenario's
 * Storyboard (PRD #1544) and each `video` scenario's annotated MP4 of the
 * tab it names, and redacts.
 *
 * Every rule lives in `qa-run.ts` and the modules it names; nothing here is
 * re-implemented. The stack, the switch, the MP4, grading and redaction are
 * the existing `runQaStack`, `runQaSwitch`, `makeAnnotatedVideo`,
 * `gradeScenarios` and `redactTranscript`, reached through `RunDeps` so a
 * test can stub the browser, the stack and ffmpeg: no test starts any of
 * them.
 *
 * A caption refusal (`caption-privacy.ts`) refuses the scenario's combined
 * files, the MP4 with the Storyboard: the MP4's overlays show the same
 * title, captions and labels, and each side's MP4 tab label is passed to
 * the same check as one more field, so the one check covers both.
 *
 * `run.json` gets the same check (#1554): every side's failure message and
 * every problem, whatever the capture, against the run's known secrets (every
 * scenario's, both sides) and the Bearer/JWT detectors. A message that leaks
 * is kept owner-only in `local/<id>-<side>.message.txt` and replaced by a
 * marker naming that file; a problem that leaks is replaced by a marker. The
 * same secrets go to the Request Transcript redactor as exact values it must
 * withhold. A tab's local recording is named by side and tab number only.
 *
 * Exit 0 = every scenario ran and graded, the headline is not QA failed, and
 * every kept file was made. 1 = QA failed, the stack or a switch failed
 * closed (no scenario starts on that side), or a kept file could not be made
 * (a recording missing, a Storyboard refused or not rendered, the MP4's tab
 * missing or ambiguous or its MP4 not made, a Request Transcript refused).
 * 2 = bad invocation, a malformed scenario script (a `video` one without
 * `tab` among them), or a missing Chromium or (when a `video` scenario will
 * make an MP4) ffmpeg, checked before the stack starts; a
 * stack start, switch or stop that itself exits 2 (a bad invocation or a
 * missing dependency such as docker) passes its 2 through.
 */
import { dirname, join } from 'node:path';

import { GradingInputError, gradeScenarios } from './grade-scenarios.ts';
import { firstLine } from './qa-cli.ts';
import { FFMPEG_MISSING_MESSAGE } from './qa-combine-executor.ts';
import type { AnnotatedVideoPlan, StepRecordsVideo } from './qa-combine.ts';
import {
  type Mp4TabChoice,
  type RecordedCall,
  RECORDINGS,
  RUN_USAGE,
  type RunArgs,
  type RunOutcome,
  type ScenarioRecord,
  STACK_LEFT_UP,
  annotatedVideoPath,
  buildManifest,
  gradingInput,
  keptPath,
  keptRecordings,
  mp4TabOf,
  needsFfmpeg,
  parseOptions,
  parseRunArgs,
  rerunOnMergeBase,
  stackStartArgs,
  stepRecordsPath,
  stepStillDir,
  stepStillPath,
  storyboardPath,
  switchArgs,
  transcriptInput,
} from './qa-run.ts';
import {
  RunInputError,
  type Scenario,
  type ScreenScenario,
  type StepRecord,
  type VideoScenario,
  checkScenarioIds,
  isScreenScenario,
  isVideoScenario,
  parseScenario,
} from './qa-scenario.ts';
import {
  DEFAULT_DEVICE,
  DEFAULT_TAB,
  type TabRecording,
  tabLabel,
} from './qa-scenario-context.ts';
import type { ExitCode } from './qa-stack-executor.ts';
import type { Side } from './qa-stack.ts';
import { SIDES, planSides } from './qa-switch.ts';
import {
  type CheckedField,
  WITHHELD_FIELD,
  findCaptionLeaks,
  leaks,
  withholdLeaks,
} from './caption-privacy.ts';
import { redactTranscript, renderTranscript } from './redact-transcript.ts';
import type { ScenarioResult } from './grade-scenarios.ts';
import {
  annotatedVideoSides,
  renderStoryboardPng,
  videoLabelFields,
} from './qa-storyboard-files.ts';
import { runContext } from './storyboard-context.ts';
import {
  type Storyboard,
  type StoryboardInput,
  type StoryboardSideInput,
  buildStoryboard,
} from './storyboard.ts';

/** One run of one scenario on one side, as the browser reports it. */
export interface RecordedRun {
  outcome: RunOutcome;
  /** First line of a failure's message. */
  message?: string;
  /** What a passing run returned or passed to `observed`. */
  observed?: string;
  /**
   * Values the Storyboard may not show (QA Account secrets, `secret()`).
   * Held in memory only: never written to a file, the manifest or output.
   */
  denied?: string[];
  /** The ids of the QA Accounts the scenario signed in with (ids only, no emails). */
  accountIds?: string[];
  /** Each `step()`, its still inside the run's work directory. */
  steps: StepRecord[];
  /** Files inside the run's work directory, or `null` if none was recorded. */
  video: string | null;
  screenshot: string | null;
  calls: RecordedCall[];
  /**
   * The recordings of every tab other than the default page. Absent when
   * none was opened. Each is listed `place: local` and never offered for
   * upload, except a `video` scenario's MP4 tab, which is kept as its side's
   * recording and made into the MP4.
   */
  tabVideos?: TabRecording[];
  /** The wall clock when the run began (`atMs` 0), epoch milliseconds. */
  startedAtMs?: number;
}

/** The machine, as the runner sees it. The real one is in `tools/qa/qa-run.ts`. */
export interface RunDeps {
  /** The repository the tooling runs from; `tmp/qa/` is under it. */
  repoRoot: string;
  /** `runQaStack`: `start …` and `stop`. */
  stack(argv: readonly string[]): Promise<ExitCode>;
  /** `runQaSwitch`. */
  switchStack(argv: readonly string[]): Promise<ExitCode>;
  /**
   * Renders a Storyboard to a PNG in Chromium, its stills' paths relative to
   * `stillRoot`; rejects on failure, leaving no PNG behind.
   */
  renderStoryboard(
    storyboard: Storyboard,
    stillRoot: string,
    pngPath: string,
  ): Promise<void>;
  /**
   * `makeAnnotatedVideo`: makes a `video` scenario's MP4 at `plan.output`;
   * rejects on failure, leaving no MP4 behind.
   */
  annotateVideo(plan: AnnotatedVideoPlan): Promise<void>;
  /** Why Chromium cannot be launched, or `null`. */
  chromiumMissing(): string | null;
  ffmpegMissing(): boolean;
  /** The `*.ts` scenario scripts in a directory, sorted. */
  listScenarioFiles(dir: string): string[];
  /** The script's default export. */
  loadScenario(file: string): Promise<unknown>;
  /** Plays one scenario in a fresh, always-recording browser context. */
  runScenario(
    scenario: Scenario,
    run: { side: Side; workDir: string },
  ): Promise<RecordedRun>;
  makeDir(path: string): void;
  moveFile(from: string, to: string): void;
  /** Written readable by the owner only: a calls file holds QA Account data. */
  writeFile(path: string, text: string): void;
  removePath(path: string): void;
  out(line: string): void;
  err(line: string): void;
}

/**
 * Where a non-default tab's recording is kept: local, by side and tab number
 * only. Device and tab names are author-written and could hold a secret.
 */
export function tabVideoPath(
  out: string,
  id: string,
  side: Side,
  n: number,
): string {
  return join(out, 'local', `${id}-${side}-tab${n}.webm`);
}

/** Where a withheld failure message is kept: local, owner-only, relative to `--out`. */
export function withheldMessagePath(id: string, side: Side): string {
  return join('local', `${id}-${side}.message.txt`);
}

/** What `run.json` shows for a failure message that leaks. */
export function withheldMessage(id: string, side: Side): string {
  return `[withheld: it holds a secret or credential; the message is in ${withheldMessagePath(id, side)}]`;
}

/** What `run.json` shows for a problem that leaks. */
export const WITHHELD_PROBLEM = '[withheld: it holds a secret or credential]';

const CLEAN_UP =
  'stop whatever the QA stack left running with "yarn qa:stack:stop" before anything else';

/** Ends the run without grading: nothing past this point is trustworthy. */
class RunStopped extends Error {
  readonly code: ExitCode;
  constructor(message: string, code: ExitCode) {
    super(message);
    this.code = code;
  }
}

export async function runQaRun(
  argv: readonly string[],
  deps: RunDeps,
): Promise<ExitCode> {
  let args: RunArgs;
  const scenarios: Scenario[] = [];
  try {
    args = parseRunArgs(argv, deps.repoRoot);
    for (const file of deps.listScenarioFiles(args.scenarios)) {
      let exported: unknown;
      try {
        exported = await deps.loadScenario(file);
      } catch (error) {
        throw new RunInputError(
          `${file} could not be loaded: ${firstLine(error)}`,
        );
      }
      scenarios.push(parseScenario(exported, file, parseOptions(args)));
    }
    checkScenarioIds(scenarios);
  } catch (error) {
    if (error instanceof RunInputError) {
      deps.err(`qa:run: ${error.message}\n${RUN_USAGE}`);
      return 2;
    }
    throw error;
  }

  const chromium = deps.chromiumMissing();
  if (chromium) {
    deps.err(`qa:run: ${chromium}`);
    return 2;
  }
  if (needsFfmpeg(scenarios) && deps.ffmpegMissing()) {
    deps.err(`qa:run: ${FFMPEG_MISSING_MESSAGE}`);
    return 2;
  }

  try {
    return await runScenarios(args, scenarios, deps);
  } catch (error) {
    if (error instanceof RunStopped) {
      deps.err(`qa:run: ${error.message}; ${CLEAN_UP}`);
      return error.code;
    }
    deps.err(`qa:run: ${firstLine(error)}; ${CLEAN_UP}`);
    return 1;
  }
}

/**
 * Withholds from a scenario's `run.json` entry every failure message and
 * problem that leaks. A leaking message is first kept owner-only under
 * `local/`, so the session can still read it.
 */
function withholdRunJson(
  record: ScenarioRecord,
  secrets: readonly string[],
  out: string,
  deps: Pick<RunDeps, 'makeDir' | 'writeFile'>,
): void {
  for (const side of SIDES) {
    const run = record.runs[side];
    if (run?.message === undefined || !leaks(run.message, secrets)) continue;
    const path = join(out, withheldMessagePath(record.id, side));
    deps.makeDir(dirname(path));
    deps.writeFile(path, `${run.message}\n`);
    record.files.push({ path, place: 'local' });
    run.message = withheldMessage(record.id, side);
  }
  record.problems = record.problems.map((problem) =>
    leaks(problem, secrets) ? WITHHELD_PROBLEM : problem,
  );
}

async function runScenarios(
  args: RunArgs,
  scenarios: readonly Scenario[],
  deps: RunDeps,
): Promise<ExitCode> {
  const records = new Map<string, ScenarioRecord>(
    scenarios.map(({ id, capture }) => [
      id,
      { id, capture, runs: {}, files: [], problems: [] },
    ]),
  );
  const recordOf = (id: string): ScenarioRecord => {
    const record = records.get(id);
    if (!record) throw new Error(`no record for scenario "${id}"`);
    return record;
  };
  const outcomes: Record<Side, Map<string, RunOutcome>> = {
    before: new Map(),
    after: new Map(),
  };
  const calls = new Map<string, Partial<Record<Side, RecordedCall[]>>>();
  /** Per scenario, the values its Storyboard may not show. In memory only. */
  const denied = new Map<string, Set<string>>();
  /** QA Account ids each scenario signed in with, over both sides. */
  const accountIds = new Map<string, Set<string>>();

  /** Each screen scenario's side runs, their step stills already kept under `--out`. */
  const stepRuns = new Map<
    string,
    Partial<Record<Side, StoryboardSideInput>>
  >();

  /** Moves a screen run's step stills out of its work directory, before it is removed. */
  function keepSteps(
    scenario: Scenario,
    side: Side,
    recorded: RecordedRun,
  ): void {
    deps.removePath(join(args.out, stepStillDir(scenario.id, side)));
    const steps = recorded.steps.map((step) => {
      const still = stepStillPath(scenario.id, side, step.index);
      const dest = join(args.out, still);
      deps.makeDir(dirname(dest));
      deps.moveFile(step.still, dest);
      return { ...step, still };
    });
    stepRuns.set(scenario.id, {
      ...stepRuns.get(scenario.id),
      [side]: {
        outcome: recorded.outcome,
        ...(recorded.observed === undefined
          ? {}
          : { observed: recorded.observed }),
        ...(recorded.message === undefined
          ? {}
          : { message: recorded.message }),
        steps,
      },
    });
  }

  /** Keeps every other tab's recording locally: never a QA Artifact, never offered. */
  function keepTabVideos(
    scenario: Scenario,
    side: Side,
    recorded: RecordedRun,
    record: ScenarioRecord,
  ): void {
    for (const [n, tab] of (recorded.tabVideos ?? []).entries()) {
      if (tab.path === null) {
        record.problems.push(`${side}: no video was recorded for tab ${n + 1}`);
        continue;
      }
      const dest = tabVideoPath(args.out, scenario.id, side, n + 1);
      deps.makeDir(dirname(dest));
      deps.moveFile(tab.path, dest);
      record.files.push({ path: dest, place: 'local' });
    }
  }

  /**
   * Per `video` scenario and side, the kept recording its MP4 follows and
   * that tab's label, or why there is none.
   */
  const mp4Tabs = new Map<
    string,
    Partial<Record<Side, Mp4TabChoice & { label?: string }>>
  >();

  /**
   * Keeps a `video` scenario's recordings: the MP4 tab's as the side's
   * recording (`<out>/<side>/<id>.webm`), which the MP4 is made from, and
   * every other tab's locally, the default tab's too when the MP4 follows
   * another.
   */
  function keepVideoTabs(
    scenario: VideoScenario,
    side: Side,
    recorded: RecordedRun,
    record: ScenarioRecord,
  ): void {
    const all: TabRecording[] = [
      {
        device: DEFAULT_DEVICE,
        tab: DEFAULT_TAB,
        path: recorded.video,
        openedAtMs: 0,
      },
      ...(recorded.tabVideos ?? []),
    ].map((tab) =>
      recorded.startedAtMs === undefined
        ? tab
        : { ...tab, startedAtMs: recorded.startedAtMs },
    );
    const choice = mp4TabOf(scenario.tab, side, all);
    let tabNumber = 0;
    for (const tab of all) {
      const isDefault = tab === all[0];
      const isMp4 =
        choice.ok &&
        tab.device === choice.recording.device &&
        tab.tab === choice.recording.tab;
      if (!isDefault) tabNumber++;
      if (tab.path === null) {
        // A missing recording of the MP4's tab is reported with the MP4 (mp4TabOf).
        const reportedWithMp4 = tab.tab === scenario.tab;
        if (!reportedWithMp4) {
          record.problems.push(
            isDefault
              ? `${side}: no video was recorded`
              : `${side}: no video was recorded for tab ${tabNumber}`,
          );
        }
        continue;
      }
      const dest = isMp4
        ? keptPath(args.out, scenario.id, side, 'video', 'side')
        : isDefault
          ? keptPath(args.out, scenario.id, side, 'video', 'local')
          : tabVideoPath(args.out, scenario.id, side, tabNumber);
      deps.makeDir(dirname(dest));
      deps.moveFile(tab.path, dest);
      record.files.push({ path: dest, place: isMp4 ? side : 'local' });
    }
    // Labelled from every tab its device ended with, as its steps are.
    const mp4Tab = choice.ok
      ? {
          ok: true as const,
          recording: {
            ...choice.recording,
            path: keptPath(args.out, scenario.id, side, 'video', 'side'),
          },
          label: tabLabel(
            choice.recording.device,
            choice.recording.tab,
            all.filter((tab) => tab.device === choice.recording.device).length,
          ),
        }
      : choice;
    mp4Tabs.set(scenario.id, { ...mp4Tabs.get(scenario.id), [side]: mp4Tab });
  }

  async function runOne(scenario: Scenario, side: Side): Promise<void> {
    const record = recordOf(scenario.id);
    const workDir = join(args.out, '.work', side, scenario.id);
    deps.removePath(workDir);
    deps.makeDir(workDir);
    const recorded = await deps.runScenario(scenario, { side, workDir });
    outcomes[side].set(scenario.id, recorded.outcome);
    const values = denied.get(scenario.id) ?? new Set<string>();
    for (const value of recorded.denied ?? []) values.add(value);
    denied.set(scenario.id, values);
    const ids = accountIds.get(scenario.id) ?? new Set<string>();
    for (const id of recorded.accountIds ?? []) ids.add(id);
    accountIds.set(scenario.id, ids);
    record.runs[side] =
      recorded.message === undefined
        ? { outcome: recorded.outcome }
        : { outcome: recorded.outcome, message: recorded.message };
    const keep = keptRecordings(scenario.capture, recorded.outcome);
    for (const recording of RECORDINGS) {
      const place = keep[recording];
      if (!place) continue;
      // A video scenario's recordings are kept by the tab its MP4 follows.
      if (recording === 'video' && isVideoScenario(scenario)) continue;
      if (recording === 'calls') {
        calls.set(scenario.id, {
          ...calls.get(scenario.id),
          [side]: recorded.calls,
        });
        continue;
      }
      const source = recorded[recording];
      if (source === null) {
        record.problems.push(`${side}: no ${recording} was recorded`);
        continue;
      }
      const dest = keptPath(args.out, scenario.id, side, recording, place);
      deps.makeDir(dirname(dest));
      deps.moveFile(source, dest);
      record.files.push({
        path: dest,
        place: place === 'side' ? side : 'local',
      });
    }
    if (isVideoScenario(scenario)) {
      keepVideoTabs(scenario, side, recorded, record);
    } else {
      keepTabVideos(scenario, side, recorded, record);
    }
    if (isScreenScenario(scenario)) keepSteps(scenario, side, recorded);
    // Whatever the line did not ask for goes with the work directory.
    deps.removePath(workDir);
    deps.out(`qa:run: ${scenario.id} on ${side}: ${recorded.outcome}`);
  }

  /** Each side's commit, as the step records and the band name them. */
  const commits = { before: args.mergeBase, after: args.head };

  /**
   * What the step-records file keeps of a `video` scenario's MP4 tabs: the
   * facts a re-render needs, and no path. A label the caption check refused
   * is withheld as the steps' fields are.
   */
  function videoRecord(
    scenario: VideoScenario,
    leakingFields: readonly string[],
    secrets: readonly string[],
  ): StepRecordsVideo {
    const sides: StepRecordsVideo['sides'] = {};
    let anyRefused = false;
    for (const side of SIDES) {
      const choice = mp4Tabs.get(scenario.id)?.[side];
      if (!choice?.ok || choice.label === undefined) continue;
      const { device, tab, openedAtMs, startedAtMs } = choice.recording;
      const clock = startedAtMs === undefined ? {} : { startedAtMs };
      // A label is built from its device and tab names, so a refused label
      // withholds all three.
      const refused = leakingFields.includes(
        `${scenario.id} video ${side} label`,
      );
      if (refused) anyRefused = true;
      sides[side] = refused
        ? {
            device: WITHHELD_FIELD,
            tab: WITHHELD_FIELD,
            label: WITHHELD_FIELD,
            openedAtMs,
            ...clock,
          }
        : { device, tab, label: choice.label, openedAtMs, ...clock };
    }
    // The declared tab is written even when no side built a label from it.
    const tabLeaks = leaks(scenario.tab, secrets);
    return {
      tab: anyRefused || tabLeaks ? WITHHELD_FIELD : scenario.tab,
      sides,
    };
  }

  /**
   * Saves a screen scenario's step records, then checks its Storyboard and
   * draws it. Returns the Storyboard once its PNG is made, or `null` when no
   * combined file may be made for the scenario: a caption was refused, the
   * model reported a problem (no steps, or a different step count on each
   * side), which this refuses on without knowing what it is, the render
   * failed, or nothing was graded or ran.
   */
  async function storyboardFor(
    scenario: ScreenScenario,
    record: ScenarioRecord,
    result: ScenarioResult | undefined,
  ): Promise<Storyboard | null> {
    const sides = stepRuns.get(scenario.id) ?? {};
    const input: StoryboardInput = {
      id: scenario.id,
      title: scenario.title,
      expected: scenario.expected,
      // The check reads text only; an ungraded scenario returns before the model is built.
      result: result ?? 'Not proven',
      commits,
      context: runContext(
        args.changeKind,
        [...(accountIds.get(scenario.id) ?? [])],
        SIDES.flatMap((side) => sides[side]?.steps ?? []),
      ),
      sides,
    };
    const secrets = [...(denied.get(scenario.id) ?? [])];
    // The MP4 shows its tab's label on each side, which no step need carry.
    const videoLabels: CheckedField[] = isVideoScenario(scenario)
      ? videoLabelFields(scenario.id, mp4Tabs.get(scenario.id) ?? {})
      : [];
    const leakingFields = findCaptionLeaks(input, secrets, videoLabels);
    const kept =
      leakingFields.length > 0 ? withholdLeaks(input, secrets) : input;
    const recordsPath = stepRecordsPath(args.out, scenario.id);
    deps.makeDir(dirname(recordsPath));
    deps.writeFile(
      recordsPath,
      `${JSON.stringify(
        {
          id: scenario.id,
          capture: scenario.capture,
          title: kept.title,
          expected: kept.expected,
          commits,
          context: kept.context,
          // Field names only. A re-render (`qa:combine`) refuses a file that lists any.
          ...(leakingFields.length > 0 ? { refused: leakingFields } : {}),
          ...(isVideoScenario(scenario)
            ? { video: videoRecord(scenario, leakingFields, secrets) }
            : {}),
          sides: kept.sides,
        },
        null,
        2,
      )}\n`,
    );
    record.files.push({ path: recordsPath, place: 'local' });
    if (leakingFields.length > 0) {
      // A leaking failure message is withheld from run.json with every other one (withholdRunJson).
      record.problems.push(
        `the Storyboard was refused: a secret or credential is in ${leakingFields.join('; ')}`,
      );
      return null;
    }
    if (result === undefined || (!sides.before && !sides.after)) return null;

    const storyboard = buildStoryboard(input);
    if (storyboard.problems.length > 0) {
      record.problems.push(...storyboard.problems);
      return null;
    }
    const png = storyboardPath(args.out, scenario.id);
    const failed = await renderStoryboardPng(deps, storyboard, args.out, png);
    if (failed !== null) {
      record.problems.push(failed);
      return null;
    }
    record.files.push({ path: png, place: 'combined' });
    return storyboard;
  }

  /**
   * Makes a `video` scenario's annotated MP4 from its Storyboard's band and
   * each side's steps, on the recording of the tab it names. Every side that
   * ran must have that tab's recording, or there is no MP4.
   */
  async function videoFor(
    scenario: VideoScenario,
    record: ScenarioRecord,
    storyboard: Storyboard,
  ): Promise<void> {
    const { sides, missing } = annotatedVideoSides(
      scenario.tab,
      stepRuns.get(scenario.id) ?? {},
      mp4Tabs.get(scenario.id) ?? {},
    );
    if (missing.length > 0) {
      record.problems.push(...missing);
      return;
    }
    const output = annotatedVideoPath(args.out, scenario.id);
    try {
      await deps.annotateVideo({ band: storyboard.band, sides, output });
    } catch (error) {
      deps.removePath(output);
      record.problems.push(`the MP4 could not be made: ${firstLine(error)}`);
      return;
    }
    record.files.push({ path: output, place: 'combined' });
  }

  const sides = planSides({
    changeKind: args.changeKind,
    withBefore: args.withBefore,
    beforeOnly: false,
  });
  const started = await deps.stack(stackStartArgs(args, false));
  if (started !== 0) {
    throw new RunStopped(
      'the QA stack did not start, so no scenario ran',
      started,
    );
  }
  for (const [index, side] of sides.entries()) {
    if (index > 0) {
      const switched = await deps.switchStack(switchArgs(args.worktree, side));
      if (switched !== 0) {
        throw new RunStopped(
          `the switch to ${side} failed closed, so no scenario ran on ${side}`,
          switched,
        );
      }
    }
    for (const scenario of scenarios) await runOne(scenario, side);
  }

  const rerun = rerunOnMergeBase(sides, outcomes.after);
  if (rerun.length > 0) {
    deps.out(
      `qa:run: ${rerun.join(', ')} failed After; re-running on the merge-base on a fresh stack`,
    );
    const stopped = await deps.stack(['stop']);
    if (stopped !== 0) {
      throw new RunStopped(
        'the QA stack did not stop for the merge-base re-run, so nothing re-ran',
        stopped,
      );
    }
    const restarted = await deps.stack(stackStartArgs(args, true));
    if (restarted !== 0) {
      throw new RunStopped(
        'the QA stack did not start on the merge-base, so nothing re-ran',
        restarted,
      );
    }
    for (const scenario of scenarios) {
      if (rerun.includes(scenario.id)) await runOne(scenario, 'before');
    }
  }
  deps.removePath(join(args.out, '.work'));

  let report;
  try {
    report = gradeScenarios(
      gradingInput(
        args.changeKind,
        scenarios.map(({ id }) => id),
        outcomes,
      ),
    );
  } catch (error) {
    if (error instanceof GradingInputError || error instanceof RunInputError) {
      throw new RunStopped(`grading refused: ${error.message}`, 1);
    }
    throw error;
  }
  const results = new Map(report.scenarios.map((s) => [s.id, s.result]));
  /** Every scenario's known secrets, both sides. In memory only. */
  const runSecrets = [
    ...new Set([...denied.values()].flatMap((values) => [...values])),
  ];

  for (const scenario of scenarios) {
    const record = recordOf(scenario.id);
    // A screen scenario whose Storyboard was refused or failed to render
    // gets no combined file at all: no MP4 either.
    const storyboard = isScreenScenario(scenario)
      ? await storyboardFor(scenario, record, results.get(scenario.id))
      : null;
    if (storyboard && isVideoScenario(scenario)) {
      await videoFor(scenario, record, storyboard);
    }
    if (scenario.capture === 'transcript') {
      const input = transcriptInput(scenario.id, calls.get(scenario.id) ?? {});
      const redacted = redactTranscript(input, { knownSecrets: runSecrets });
      if (redacted.ok) {
        const path = join(args.out, 'transcripts', `${scenario.id}.md`);
        deps.makeDir(dirname(path));
        deps.writeFile(path, renderTranscript(redacted.transcript));
        record.files.push({ path, place: 'transcript' });
      } else {
        // Kept for the session to find which field #n was; local only.
        const path = join(args.out, 'local', `${scenario.id}.calls.json`);
        deps.makeDir(dirname(path));
        deps.writeFile(path, `${JSON.stringify(input, null, 2)}\n`);
        record.files.push({ path, place: 'local' });
        record.problems.push(
          `the Request Transcript was refused at: ${redacted.refusedPaths.join('; ')}`,
        );
      }
    }
  }

  for (const record of records.values()) {
    withholdRunJson(record, runSecrets, args.out, deps);
  }
  const manifest = buildManifest(args, report, [...records.values()]);
  const manifestPath = join(args.out, 'run.json');
  deps.makeDir(args.out);
  deps.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  let problems = 0;
  for (const scenario of manifest.scenarios) {
    deps.out(`  ${scenario.id}: ${results.get(scenario.id)}`);
    for (const problem of scenario.problems) {
      problems++;
      deps.err(`qa:run: ${scenario.id}: ${problem}`);
    }
  }
  deps.out(`qa:run: ${manifest.headline}`);
  deps.out(`qa:run: wrote ${manifestPath}`);
  deps.out(`qa:run: ${STACK_LEFT_UP}`);
  return manifest.headline === 'QA failed' || problems > 0 ? 1 : 0;
}

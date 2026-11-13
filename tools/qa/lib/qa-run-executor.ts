/**
 * Runs `yarn qa:run` (ADR 0147 decisions 1-5 and 7): starts the QA stack,
 * plays every scenario script on Before and After in Chromium, keeps what
 * each `Capture:` line asks for, then grades, makes each screen scenario's
 * Storyboard (PRD #1544), combines a video pair and redacts.
 *
 * Every rule lives in `qa-run.ts` and the modules it names; nothing here is
 * re-implemented. The stack, the switch, combining, grading and redaction are
 * the existing `runQaStack`, `runQaSwitch`, `runCombine`, `gradeScenarios` and
 * `redactTranscript`, reached through `RunDeps` so a test can stub the
 * browser, the stack and ffmpeg: no test starts any of them.
 *
 * Exit 0 = every scenario ran and graded, the headline is not QA failed, and
 * every kept file was made. 1 = QA failed, the stack or a switch failed
 * closed (no scenario starts on that side), or a kept file could not be made
 * (a recording missing, a Storyboard refused or not rendered, combining
 * failed, a Request Transcript refused).
 * 2 = bad invocation, a malformed scenario script, or a missing Chromium or
 * (when a pair will be combined) ffmpeg, checked before the stack starts; a
 * stack start, switch or stop that itself exits 2 (a bad invocation or a
 * missing dependency such as docker) passes its 2 through.
 */
import { dirname, join } from 'node:path';

import { GradingInputError, gradeScenarios } from './grade-scenarios.ts';
import { firstLine } from './qa-cli.ts';
import { FFMPEG_MISSING_MESSAGE } from './qa-combine-executor.ts';
import {
  FFMPEG_CAPTURE,
  type RecordedCall,
  RECORDINGS,
  RUN_USAGE,
  type RunArgs,
  type RunOutcome,
  type ScenarioRecord,
  STACK_LEFT_UP,
  buildManifest,
  combineArgs,
  gradingInput,
  keptPath,
  keptRecordings,
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
  checkScenarioIds,
  isScreenScenario,
  parseScenario,
} from './qa-scenario.ts';
import type { TabRecording } from './qa-scenario-context.ts';
import type { ExitCode } from './qa-stack-executor.ts';
import type { Side } from './qa-stack.ts';
import { planSides } from './qa-switch.ts';
import { redactTranscript, renderTranscript } from './redact-transcript.ts';
import type { ScenarioResult } from './grade-scenarios.ts';
import {
  type Storyboard,
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
  /** Each `step()`, its still inside the run's work directory. */
  steps: StepRecord[];
  /** Files inside the run's work directory, or `null` if none was recorded. */
  video: string | null;
  screenshot: string | null;
  calls: RecordedCall[];
  /**
   * The recordings of every tab other than the default page, each listed
   * `place: local` and never offered for upload. Absent when none was opened.
   */
  tabVideos?: TabRecording[];
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
  /** `runCombine`; on status 0, the files it made. */
  combine(argv: readonly string[]): { status: number; files: string[] };
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

/** Where a non-default tab's recording is kept: local, numbered so odd names never collide. */
export function tabVideoPath(
  out: string,
  id: string,
  side: Side,
  n: number,
  tab: { device: string; tab: string },
): string {
  const safe = (text: string) => text.replace(/[^A-Za-z0-9_-]/g, '_');
  return join(
    out,
    'local',
    `${id}-${side}-tab${n}-${safe(tab.device)}-${safe(tab.tab)}.webm`,
  );
}

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
  const media = new Map<string, Partial<Record<Side, string>>>();
  const calls = new Map<string, Partial<Record<Side, RecordedCall[]>>>();
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
        record.problems.push(
          `${side}: no video was recorded for device ${tab.device}, tab ${tab.tab}`,
        );
        continue;
      }
      const dest = tabVideoPath(args.out, scenario.id, side, n + 1, tab);
      deps.makeDir(dirname(dest));
      deps.moveFile(tab.path, dest);
      record.files.push({ path: dest, place: 'local' });
    }
  }

  async function runOne(scenario: Scenario, side: Side): Promise<void> {
    const record = recordOf(scenario.id);
    const workDir = join(args.out, '.work', side, scenario.id);
    deps.removePath(workDir);
    deps.makeDir(workDir);
    const recorded = await deps.runScenario(scenario, { side, workDir });
    outcomes[side].set(scenario.id, recorded.outcome);
    record.runs[side] =
      recorded.message === undefined
        ? { outcome: recorded.outcome }
        : { outcome: recorded.outcome, message: recorded.message };
    const keep = keptRecordings(scenario.capture, recorded.outcome);
    for (const recording of RECORDINGS) {
      const place = keep[recording];
      if (!place) continue;
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
      if (place === 'side') {
        media.set(scenario.id, { ...media.get(scenario.id), [side]: dest });
      }
    }
    keepTabVideos(scenario, side, recorded, record);
    if (isScreenScenario(scenario)) keepSteps(scenario, side, recorded);
    // Whatever the line did not ask for goes with the work directory.
    deps.removePath(workDir);
    deps.out(`qa:run: ${scenario.id} on ${side}: ${recorded.outcome}`);
  }

  /** Each side's commit, as the step records and the band name them. */
  const commits = { before: args.mergeBase, after: args.head };

  /**
   * Saves a screen scenario's step records, then checks its Storyboard and
   * draws it. True when no combined file may be made for the scenario: the
   * model reported a problem (no steps, or a different step count on each
   * side), which this
   * refuses on without knowing what it is, or the render failed.
   */
  async function storyboardFor(
    scenario: ScreenScenario,
    record: ScenarioRecord,
    result: ScenarioResult | undefined,
  ): Promise<boolean> {
    const sides = stepRuns.get(scenario.id) ?? {};
    const recordsPath = stepRecordsPath(args.out, scenario.id);
    deps.makeDir(dirname(recordsPath));
    deps.writeFile(
      recordsPath,
      `${JSON.stringify(
        {
          id: scenario.id,
          capture: scenario.capture,
          title: scenario.title,
          expected: scenario.expected,
          commits,
          sides,
        },
        null,
        2,
      )}\n`,
    );
    record.files.push({ path: recordsPath, place: 'local' });
    if (result === undefined || (!sides.before && !sides.after)) return false;

    const storyboard = buildStoryboard({
      id: scenario.id,
      title: scenario.title,
      expected: scenario.expected,
      result,
      commits,
      sides,
    });
    if (storyboard.problems.length > 0) {
      record.problems.push(...storyboard.problems);
      return true;
    }
    const png = storyboardPath(args.out, scenario.id);
    deps.makeDir(dirname(png));
    try {
      await deps.renderStoryboard(storyboard, args.out, png);
    } catch (error) {
      deps.removePath(png);
      record.problems.push(
        `the Storyboard could not be rendered: ${firstLine(error)}`,
      );
      return true;
    }
    record.files.push({ path: png, place: 'combined' });
    return false;
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

  for (const scenario of scenarios) {
    const record = recordOf(scenario.id);
    // A screen scenario whose Storyboard was refused or failed to render
    // gets no combined file at all.
    const screenRefused = isScreenScenario(scenario)
      ? await storyboardFor(scenario, record, results.get(scenario.id))
      : false;
    if (FFMPEG_CAPTURE[scenario.capture] && !screenRefused) {
      const pair = media.get(scenario.id);
      if (pair?.before && pair.after) {
        const combined = deps.combine(
          combineArgs(args.out, scenario.id, pair.before, pair.after),
        );
        if (combined.status === 0) {
          for (const path of combined.files) {
            record.files.push({ path, place: 'combined' });
          }
        } else {
          record.problems.push(
            `combining failed (qa:combine exit ${combined.status})`,
          );
        }
      }
    }
    if (scenario.capture === 'transcript') {
      const input = transcriptInput(scenario.id, calls.get(scenario.id) ?? {});
      const redacted = redactTranscript(input);
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

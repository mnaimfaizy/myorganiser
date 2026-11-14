// Contracts for `runQaRun` (ADR 0147 decisions 1-5 and 7, and 8's start
// refusal), run with a hand-written RunDeps: an in-memory disk, a call log of
// every stack, switch, annotate and scenario call in order, and scripted runs.
// No browser, stack, docker or ffmpeg starts here, and the modules that would
// reach one are never imported. The pure rules are in qa-run.test.ts.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { FFMPEG_MISSING_MESSAGE, runCombine } from './qa-combine-executor.ts';
import type { AnnotatedVideoPlan } from './qa-combine.ts';
import {
  type RecordedCall,
  type RunManifest,
  type RunOutcome,
} from './qa-run.ts';
import { type RecordedRun, type RunDeps, runQaRun } from './qa-run-executor.ts';
import {
  type Capture,
  type Scenario,
  type StepRecord,
  SCREEN_CAPTURE,
} from './qa-scenario.ts';
import { DEFAULT_TAB } from './qa-scenario-context.ts';
import type { ExitCode } from './qa-stack-executor.ts';
import type { Side } from './qa-stack.ts';
import { ALIKE_TEXT, NOT_DECLARED, type Storyboard } from './storyboard.ts';

const REPO = '/repo';
const WT = '/wt';
const SCENARIOS = '/repo/tmp/qa/pr-1/scenarios';
const OUT = '/repo/tmp/qa/pr-1/out';
const RUN_JSON = `${OUT}/run.json`;
const MERGE_BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

interface Scripted {
  outcome: RunOutcome;
  message?: string;
  observed?: string;
  video: boolean;
  screenshot: boolean;
  calls: RecordedCall[];
  /** How many `step()` calls the run makes; each still is written in its work directory. */
  steps: number;
  /** When set, the browser run rejects with this message instead of reporting. */
  throws?: string;
  /** Each other tab's recording; `path: null` when none was written. Absent when no other tab was opened. */
  tabVideos?: {
    device: string;
    tab: string;
    path: string | null;
    openedAtMs: number;
  }[];
  /** Each step's `atMs` by call order; a step past the list is at 0. */
  stepAtMs?: number[];
  /** The values the browser reports as denied for the Storyboard; absent when none. */
  denied?: string[];
  /** Each step's caption by call order; a step past the list keeps `step N`. */
  captions?: string[];
  /** The wall clock the run began at, as the browser runner reports it; absent when it reports none. */
  startedAtMs?: number;
}

const DEFAULT_RUN: Scripted = {
  outcome: 'pass',
  video: true,
  screenshot: true,
  calls: [],
  steps: 1,
};

interface Plan {
  /** Scenario script path to its default export. */
  exports: Record<string, unknown>;
  /** Scenario script paths whose load throws. */
  loadFails: string[];
  chromium: string | null;
  ffmpeg: boolean;
  runs: (id: string, side: Side) => Partial<Scripted> | undefined;
  stack: (argv: readonly string[]) => ExitCode;
  switchStack: (argv: readonly string[]) => ExitCode;
  /** Called with each MP4 plan; throwing makes `annotateVideo` reject. */
  annotate: (plan: AnnotatedVideoPlan) => void;
  /** Called with each Storyboard's PNG path; throwing makes the render reject. */
  render: (pngPath: string) => void;
}

function fakeRun(options: Partial<Plan> = {}) {
  const plan: Plan = {
    exports: {},
    loadFails: [],
    chromium: null,
    ffmpeg: false,
    runs: () => undefined,
    stack: () => 0,
    switchStack: () => 0,
    annotate: () => undefined,
    render: () => undefined,
    ...options,
  };
  const log: string[] = [];
  const disk = new Set<string>();
  const files = new Map<string, string>();
  const out: string[] = [];
  const err: string[] = [];
  const removed: string[] = [];
  /** Every disk move and removal, in call order. */
  const ops: string[] = [];
  /** Every Storyboard render, with the arguments the executor gave it. */
  const renders: {
    storyboard: Storyboard;
    stillRoot: string;
    pngPath: string;
  }[] = [];
  /** Every MP4 plan the executor asked for, in call order. */
  const annotations: AnnotatedVideoPlan[] = [];

  const deps: RunDeps = {
    repoRoot: REPO,
    async stack(argv) {
      log.push(`stack ${argv.join(' ')}`);
      return plan.stack(argv);
    },
    async switchStack(argv) {
      log.push(`switch ${argv.join(' ')}`);
      return plan.switchStack(argv);
    },
    async annotateVideo(annotation) {
      log.push(`annotate ${annotation.output}`);
      annotations.push(annotation);
      plan.annotate(annotation);
      disk.add(annotation.output);
    },
    chromiumMissing: () => plan.chromium,
    ffmpegMissing: () => plan.ffmpeg,
    listScenarioFiles: () => Object.keys(plan.exports).sort(),
    async loadScenario(file) {
      if (plan.loadFails.includes(file)) throw new Error('boom in the script');
      return plan.exports[file];
    },
    async runScenario(scenario, { side, workDir }) {
      log.push(`run ${scenario.id} ${side}`);
      const scripted: Scripted = {
        ...DEFAULT_RUN,
        ...plan.runs(scenario.id, side),
      };
      if (scripted.throws !== undefined) throw new Error(scripted.throws);
      const video = scripted.video ? `${workDir}/v.webm` : null;
      const screenshot = scripted.screenshot ? `${workDir}/s.png` : null;
      for (const path of [video, screenshot]) if (path) disk.add(path);
      for (const tab of scripted.tabVideos ?? []) {
        if (tab.path !== null) disk.add(tab.path);
      }
      const steps: StepRecord[] = Array.from(
        { length: scripted.steps },
        (_, i) => {
          const still = `${workDir}/${String(i + 1).padStart(2, '0')}.png`;
          disk.add(still);
          return {
            side,
            index: i + 1,
            device: 'Desktop',
            tab: '',
            label: 'Device Desktop',
            caption: scripted.captions?.[i] ?? `step ${i + 1}`,
            still,
            subject: null,
            atMs: scripted.stepAtMs?.[i] ?? 0,
          };
        },
      );
      const recorded: RecordedRun = {
        outcome: scripted.outcome,
        steps,
        video,
        screenshot,
        calls: scripted.calls,
      };
      if (scripted.tabVideos !== undefined) {
        recorded.tabVideos = scripted.tabVideos;
      }
      if (scripted.startedAtMs !== undefined) {
        recorded.startedAtMs = scripted.startedAtMs;
      }
      if (scripted.message !== undefined) recorded.message = scripted.message;
      if (scripted.observed !== undefined)
        recorded.observed = scripted.observed;
      if (scripted.denied !== undefined) recorded.denied = scripted.denied;
      return recorded;
    },
    async renderStoryboard(storyboard, stillRoot, pngPath) {
      log.push(`render ${pngPath}`);
      renders.push({ storyboard, stillRoot, pngPath });
      plan.render(pngPath);
      disk.add(pngPath);
    },
    makeDir: () => undefined,
    moveFile(from, to) {
      if (!disk.has(from)) throw new Error(`no file at ${from}`);
      ops.push(`move ${from} ${to}`);
      disk.delete(from);
      disk.add(to);
    },
    writeFile(path, text) {
      files.set(path, text);
      disk.add(path);
    },
    removePath(path) {
      removed.push(path);
      ops.push(`remove ${path}`);
      for (const existing of [...disk]) {
        if (existing === path || existing.startsWith(`${path}/`)) {
          disk.delete(existing);
        }
      }
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  return {
    deps,
    log,
    disk,
    files,
    out,
    err,
    removed,
    ops,
    renders,
    annotations,
  };
}

/** A scenario script; a screen capture also declares its title and expected results. */
const scenario = (id: string, capture: Capture): Scenario => {
  const script: Scenario = { id, capture, run: async () => undefined };
  if (!SCREEN_CAPTURE[capture]) return script;
  return {
    ...script,
    title: `${id} scenario`,
    expected: { before: 'the defect shows', after: 'the fix shows' },
    // A video scenario's MP4 follows the default tab unless a test says otherwise.
    ...(capture === 'video' ? { tab: DEFAULT_TAB } : {}),
  };
};

/** The scenario scripts a run finds in SCENARIOS, keyed by their path. */
function filesOf(...scenarios: Scenario[]): Record<string, unknown> {
  return Object.fromEntries(
    scenarios.map((s) => [`${SCENARIOS}/${s.id}.ts`, s]),
  );
}

function argvFor(changeKind: 'fix' | 'feature', ...extra: string[]): string[] {
  return [
    '--worktree',
    WT,
    '--change-kind',
    changeKind,
    '--merge-base',
    MERGE_BASE,
    '--head',
    HEAD,
    '--scenarios',
    SCENARIOS,
    '--out',
    OUT,
    ...extra,
  ];
}

/** The log line of a `qa:stack start` with the given flags, as the run makes it. */
function startLine(changeKind: 'fix' | 'feature', ...extra: string[]): string {
  return [
    'stack start',
    '--worktree',
    WT,
    '--change-kind',
    changeKind,
    '--merge-base',
    MERGE_BASE,
    '--head',
    HEAD,
    ...extra,
  ].join(' ');
}

const SWITCH_TO_AFTER = `switch --worktree ${WT} --to after`;

function manifestOf(fake: ReturnType<typeof fakeRun>): RunManifest {
  const text = fake.files.get(RUN_JSON);
  assert.ok(text !== undefined, 'run.json was written');
  return JSON.parse(text) as RunManifest;
}

function kept(fake: ReturnType<typeof fakeRun>): string[] {
  return [...fake.disk].sort();
}

/**
 * Every text the run writes or prints, which a known value must not reach:
 * each written file's path and text, each path listed in run.json, and what
 * was printed. A path in `ownerOnly` may hold the value (the owner-only copy of
 * a withheld message, #1554), so its text is left out.
 */
function everyOutput(
  fake: ReturnType<typeof fakeRun>,
  ownerOnly: readonly string[] = [],
): string[] {
  const listed = manifestOf(fake).scenarios.flatMap((s) =>
    s.files.map(({ path }) => path),
  );
  const written = [...fake.files].flatMap(([path, text]) =>
    ownerOnly.includes(path) ? [path] : [path, text],
  );
  return [...written, ...listed, ...fake.out, ...fake.err];
}

/** The Storyboard PNG a screen run with both sides renders. */
const storyboardPng = (id: string): string => `${OUT}/combined/${id}.png`;

/** What a screen run keeps for its steps: the step records, then each side's step still. */
function stepFiles(id: string, ...sides: Side[]): string[] {
  return [
    `${OUT}/steps/${id}.json`,
    ...sides.map((side) => `${OUT}/steps/${id}/${side}/01.png`),
  ];
}

const sorted = (paths: readonly string[]): string[] => [...paths].sort();

/** Before is the defect, so it fails as expected; After is the fix, so it passes. */
const reproduced = (_id: string, side: Side) =>
  side === 'before'
    ? { outcome: 'fail' as const, message: 'the defect shows here' }
    : { observed: 'the fix shows here' };

describe('a fix runs Before, switches, then runs After', () => {
  test('runs every scenario on Before, switches, runs every scenario on After, and never stops the stack', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('A', 'none'), scenario('B', 'none')),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(fake.log, [
      startLine('fix'),
      'run A before',
      'run B before',
      SWITCH_TO_AFTER,
      'run A after',
      'run B after',
    ]);
  });

  test('grades PASS and exits 0 when Before fails and After passes', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('A', 'none'), scenario('B', 'none')),
      runs: (_id, side) =>
        side === 'before'
          ? { outcome: 'fail', message: 'shows the defect' }
          : {},
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);
    const manifest = manifestOf(fake);
    assert.deepEqual(
      manifest.scenarios.map(({ id, result }) => [id, result]),
      [
        ['A', 'PASS'],
        ['B', 'PASS'],
      ],
    );
  });

  test('runs nothing on After and exits 1 when the switch fails closed', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('A', 'none'), scenario('B', 'none')),
      switchStack: () => 1,
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.log, [
      startLine('fix'),
      'run A before',
      'run B before',
      SWITCH_TO_AFTER,
    ]);
    const stderr = fake.err.join('\n');
    assert.match(stderr, /failed closed/);
    assert.match(stderr, /yarn qa:stack:stop/);
    assert.equal(fake.files.has(RUN_JSON), false, 'nothing is graded');
  });

  for (const code of [1, 2] as const) {
    test(`runs no scenario and exits with the start's code ${code} when the stack does not start`, async () => {
      const fake = fakeRun({
        exports: filesOf(scenario('A', 'none')),
        stack: () => code,
      });
      const exit = await runQaRun(argvFor('fix'), fake.deps);
      assert.equal(exit, code);
      assert.deepEqual(fake.log, [startLine('fix')]);
      assert.match(fake.err.join('\n'), /the QA stack did not start/);
    });
  }
});

describe('a feature runs After only, and re-runs only what failed After', () => {
  test('runs After only and grades Before as not-run, with no stop or re-run when everything passes', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('A', 'none'), scenario('B', 'none')),
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(fake.log, [
      startLine('feature'),
      'run A after',
      'run B after',
    ]);
    const manifest = manifestOf(fake);
    assert.equal(manifest.headline, 'QA passed');
    for (const entry of manifest.scenarios) {
      assert.equal(entry.result, 'PASS');
      assert.equal(
        entry.runs.before,
        undefined,
        `${entry.id} has no Before run`,
      );
    }
  });

  test('re-runs only the failed scenario on the merge-base; a pre-existing failure exits 0', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('A', 'none'), scenario('B', 'none')),
      runs: (id) => (id === 'B' ? { outcome: 'fail', message: 'broken' } : {}),
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(fake.log, [
      startLine('feature'),
      'run A after',
      'run B after',
      'stack stop',
      startLine('feature', '--before-only'),
      'run B before',
    ]);
    const manifest = manifestOf(fake);
    assert.equal(
      manifest.headline,
      'QA passed, not proven or pre-existing items listed',
    );
    const b = manifest.scenarios.find(({ id }) => id === 'B');
    assert.equal(b?.result, 'FAIL: pre-existing');
    assert.equal(b?.maintainerDecision, true);
  });

  test('a failure only After is a regression and exits 1', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('A', 'none'), scenario('B', 'none')),
      runs: (id, side) =>
        id === 'B' && side === 'after'
          ? { outcome: 'fail', message: 'broken' }
          : {},
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 1);
    const b = manifestOf(fake).scenarios.find(({ id }) => id === 'B');
    assert.equal(b?.result, 'FAIL: regression');
    assert.equal(manifestOf(fake).headline, 'QA failed');
    const printed = fake.out.join('\n');
    assert.match(printed, /still up/);
    assert.match(printed, /yarn qa:stack:stop/);
  });

  test('re-runs nothing and exits 1 when the stack does not stop for the re-run', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('A', 'none'), scenario('B', 'none')),
      runs: (id, side) =>
        id === 'B' && side === 'after' ? { outcome: 'fail' } : {},
      stack: (argv) => (argv[0] === 'stop' ? 1 : 0),
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.log, [
      startLine('feature'),
      'run A after',
      'run B after',
      'stack stop',
    ]);
    assert.match(fake.err.join('\n'), /nothing re-ran/);
  });

  test('re-runs nothing and exits 1 when the merge-base stack does not start', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('A', 'none'), scenario('B', 'none')),
      runs: (id, side) =>
        id === 'B' && side === 'after' ? { outcome: 'fail' } : {},
      stack: (argv) => (argv.includes('--before-only') ? 1 : 0),
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.log, [
      startLine('feature'),
      'run A after',
      'run B after',
      'stack stop',
      startLine('feature', '--before-only'),
    ]);
    assert.match(fake.err.join('\n'), /nothing re-ran/);
  });

  test('with --with-before runs Before then After through the switch, and never re-runs even when After fails', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('B', 'none')),
      runs: (_id, side) => (side === 'after' ? { outcome: 'fail' } : {}),
    });
    const exit = await runQaRun(argvFor('feature', '--with-before'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.log, [
      startLine('feature', '--with-before'),
      'run B before',
      SWITCH_TO_AFTER,
      'run B after',
    ]);
  });
});

describe('capture keeping', () => {
  // Both sides run and both fail or pass together, so each side's kept files
  // are visible on the disk. Everything else the run recorded must be gone.
  test('a screenshot that passes keeps its screenshot on each side and no video', async () => {
    const fake = fakeRun({ exports: filesOf(scenario('S', 'screenshot')) });
    await runQaRun(argvFor('fix'), fake.deps);
    assert.deepEqual(
      kept(fake),
      sorted([
        RUN_JSON,
        `${OUT}/before/S.png`,
        `${OUT}/after/S.png`,
        storyboardPng('S'),
        ...stepFiles('S', 'before', 'after'),
      ]),
    );
  });

  test('a screenshot that fails keeps its screenshot on each side and the video locally', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      runs: () => ({ outcome: 'fail', message: 'missing' }),
    });
    await runQaRun(argvFor('fix'), fake.deps);
    assert.deepEqual(
      kept(fake),
      sorted([
        RUN_JSON,
        `${OUT}/before/S.png`,
        `${OUT}/after/S.png`,
        `${OUT}/local/S-before.webm`,
        `${OUT}/local/S-after.webm`,
        storyboardPng('S'),
        ...stepFiles('S', 'before', 'after'),
      ]),
    );
  });

  test('a none that passes keeps nothing but the run manifest', async () => {
    const fake = fakeRun({ exports: filesOf(scenario('N', 'none')) });
    await runQaRun(argvFor('fix'), fake.deps);
    assert.deepEqual(kept(fake), [RUN_JSON]);
  });

  test('a none that fails keeps only the local video on each side', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('N', 'none')),
      runs: () => ({ outcome: 'fail', message: 'broken' }),
    });
    await runQaRun(argvFor('fix'), fake.deps);
    assert.deepEqual(
      kept(fake),
      sorted([
        RUN_JSON,
        `${OUT}/local/N-before.webm`,
        `${OUT}/local/N-after.webm`,
      ]),
    );
  });

  test("removes each side's work directory and leaves nothing under .work", async () => {
    const fake = fakeRun({ exports: filesOf(scenario('S', 'screenshot')) });
    await runQaRun(argvFor('fix'), fake.deps);
    assert.ok(fake.removed.includes(`${OUT}/.work/before/S`));
    assert.ok(fake.removed.includes(`${OUT}/.work/after/S`));
    assert.equal(
      [...fake.disk].some((path) => path.includes('/.work/')),
      false,
    );
  });
});

describe('video captures', () => {
  test('a fix video that passes on both sides keeps each side, and makes its MP4 from exactly those two sides', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: (id, side) => ({ ...reproduced(id, side), stepAtMs: [1500] }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(
      kept(fake),
      sorted([
        RUN_JSON,
        `${OUT}/before/V.webm`,
        `${OUT}/after/V.webm`,
        storyboardPng('V'),
        `${OUT}/combined/V.mp4`,
        ...stepFiles('V', 'before', 'after'),
      ]),
    );
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('annotate ')),
      [`annotate ${OUT}/combined/V.mp4`],
    );

    const [plan] = fake.annotations;
    assert.equal(plan.output, `${OUT}/combined/V.mp4`);
    assert.equal(plan.band.id, 'V');
    assert.equal(plan.band.title, 'V scenario');
    assert.equal(plan.band.result, 'PASS');
    assert.deepEqual(
      plan.sides.map(({ side, video, device, tab, label, openedAtMs }) => [
        side,
        video,
        device,
        tab,
        label,
        openedAtMs,
      ]),
      [
        ['before', `${OUT}/before/V.webm`, 'A', 'A', 'Device A', 0],
        ['after', `${OUT}/after/V.webm`, 'A', 'A', 'Device A', 0],
      ],
    );
    assert.deepEqual(
      plan.sides.map(({ steps }) =>
        steps.map(({ index, caption, atMs }) => [index, caption, atMs]),
      ),
      [[[1, 'step 1', 1500]], [[1, 'step 1', 1500]]],
    );

    const png = manifestOf(fake).scenarios[0].files.find(
      ({ path }) => path === storyboardPng('V'),
    );
    assert.deepEqual(png, {
      path: storyboardPng('V'),
      place: 'combined',
      uploadEligible: true,
    });
    const mp4 = manifestOf(fake).scenarios[0].files.find(
      ({ path }) => path === `${OUT}/combined/V.mp4`,
    );
    assert.deepEqual(mp4, {
      path: `${OUT}/combined/V.mp4`,
      place: 'combined',
      uploadEligible: true,
    });
  });

  test('a video graded FAIL: regression lists its Storyboard and MP4 and offers neither for upload', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: (_id, side) =>
        side === 'before'
          ? { observed: 'the label is still there' }
          : { outcome: 'fail', message: 'the label is gone' },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    const entry = manifestOf(fake).scenarios[0];
    assert.equal(entry.result, 'FAIL: regression');
    assert.deepEqual(
      entry.files.find(({ path }) => path === storyboardPng('V')),
      { path: storyboardPng('V'), place: 'combined', uploadEligible: false },
    );
    assert.deepEqual(
      entry.files.find(({ path }) => path === `${OUT}/combined/V.mp4`),
      {
        path: `${OUT}/combined/V.mp4`,
        place: 'combined',
        uploadEligible: false,
      },
    );
  });

  test('a fix video that fails keeps its video in each side directory, and nothing under local/', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: () => ({ outcome: 'fail', message: 'frozen' }),
    });
    await runQaRun(argvFor('fix'), fake.deps);
    assert.deepEqual(
      kept(fake),
      sorted([
        RUN_JSON,
        `${OUT}/before/V.webm`,
        `${OUT}/after/V.webm`,
        storyboardPng('V'),
        `${OUT}/combined/V.mp4`,
        ...stepFiles('V', 'before', 'after'),
      ]),
    );
    assert.equal(
      kept(fake).some((path) => path.includes('/local/')),
      false,
    );
  });

  test('a video export without tab exits 2 before any stack call or run, and names the missing tab', async () => {
    const file = `${SCENARIOS}/V.ts`;
    const fake = fakeRun({
      exports: {
        [file]: {
          id: 'V',
          capture: 'video',
          title: 'V scenario',
          expected: { before: 'the defect shows', after: 'the fix shows' },
          run: async () => undefined,
        },
      },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 2);
    assert.deepEqual(fake.log, []);
    assert.match(fake.err.join('\n'), /must declare tab/);
    assert.equal(fake.annotations.length, 0);
  });

  test('exits 2 before any stack call when ffmpeg is missing for a video scenario', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      ffmpeg: true,
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 2);
    assert.deepEqual(fake.log, []);
    assert.deepEqual(fake.err, [`qa:run: ${FFMPEG_MISSING_MESSAGE}`]);
  });
});

describe('a run that records less than its line asks for, or fails to run', () => {
  test('a Before screenshot that was not recorded is a problem, exits 1, and keeps no Before file', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      runs: (_id, side) => (side === 'before' ? { screenshot: false } : {}),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(manifestOf(fake).scenarios[0].problems, [
      'before: no screenshot was recorded',
    ]);
    assert.equal(fake.disk.has(`${OUT}/before/S.png`), false);
    assert.equal(fake.disk.has(`${OUT}/after/S.png`), true);
  });

  test('a browser run that rejects exits 1 with the stop command, and no After run follows', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'none')),
      runs: (_id, side) =>
        side === 'before' ? { throws: 'the browser closed' } : {},
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.log, [startLine('fix'), 'run S before']);
    const stderr = fake.err.join('\n');
    assert.match(stderr, /the browser closed/);
    assert.ok(
      stderr.includes(
        'stop whatever the QA stack left running with "yarn qa:stack:stop" before anything else',
      ),
    );
  });
});

describe('a side that cannot run', () => {
  test('an After that cannot run is graded Left for a person, and its screenshot is kept per KEEP', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      runs: (_id, side) => (side === 'after' ? { outcome: 'cannot-run' } : {}),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);
    const entry = manifestOf(fake).scenarios[0];
    assert.equal(entry.result, 'Left for a person');
    assert.equal(entry.runs.after?.outcome, 'cannot-run');
    assert.deepEqual(
      kept(fake),
      sorted([
        RUN_JSON,
        `${OUT}/before/S.png`,
        `${OUT}/after/S.png`,
        storyboardPng('S'),
        ...stepFiles('S', 'before', 'after'),
      ]),
    );
  });
});

describe('combining the kept Before and After captures', () => {
  test('a screenshot never makes an MP4; its Storyboard is rendered from both sides', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      runs: reproduced,
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('annotate ')),
      [],
    );
    assert.equal(fake.annotations.length, 0);
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('render ')),
      [`render ${OUT}/combined/S.png`],
    );
  });

  test('a video MP4 is offered for a PASS and withheld for a FAIL: regression', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('P', 'video'), scenario('R', 'video')),
      runs: (id, side) => {
        if (id === 'P') return side === 'before' ? { outcome: 'fail' } : {};
        return side === 'after' ? { outcome: 'fail' } : {};
      },
    });
    await runQaRun(argvFor('fix'), fake.deps);
    const manifest = manifestOf(fake);
    const mp4Of = (id: string) =>
      manifest.scenarios
        .find((entry) => entry.id === id)
        ?.files.find((file) => file.path.endsWith('.mp4'));
    assert.deepEqual(mp4Of('P'), {
      path: `${OUT}/combined/P.mp4`,
      place: 'combined',
      uploadEligible: true,
    });
    assert.deepEqual(mp4Of('R'), {
      path: `${OUT}/combined/R.mp4`,
      place: 'combined',
      uploadEligible: false,
    });
  });

  test('a Storyboard is offered for a PASS and withheld for a FAIL: regression', async () => {
    const fake = fakeRun({
      exports: filesOf(
        scenario('P', 'screenshot'),
        scenario('R', 'screenshot'),
      ),
      runs: (id, side) => {
        if (id === 'P') return side === 'before' ? { outcome: 'fail' } : {};
        return side === 'after' ? { outcome: 'fail' } : {};
      },
    });
    await runQaRun(argvFor('fix'), fake.deps);
    const manifest = manifestOf(fake);
    const storyboardOf = (id: string) =>
      manifest.scenarios
        .find((entry) => entry.id === id)
        ?.files.find((file) => file.place === 'combined');
    assert.deepEqual(storyboardOf('P'), {
      path: `${OUT}/combined/P.png`,
      place: 'combined',
      uploadEligible: true,
    });
    assert.deepEqual(storyboardOf('R'), {
      path: `${OUT}/combined/R.png`,
      place: 'combined',
      uploadEligible: false,
    });
  });

  test('an MP4 that cannot be made exits 1, lists no MP4, records the first line of the reason, and removes the MP4', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('P', 'video')),
      runs: reproduced,
      annotate: () => {
        throw new Error('Invalid data found\nmore detail');
      },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);

    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(entry.problems, [
      'the MP4 could not be made: Invalid data found',
    ]);
    assert.equal(
      entry.files.some(({ path }) => path.endsWith('.mp4')),
      false,
      'no MP4 is listed',
    );
    assert.ok(fake.removed.includes(`${OUT}/combined/P.mp4`));
    assert.match(
      fake.err.join('\n'),
      /qa:run: P: the MP4 could not be made: Invalid data found/,
    );
    assert.equal(fake.renders.length, 1, 'the Storyboard is still rendered');
    assert.ok(
      entry.files.some(({ path }) => path === storyboardPng('P')),
      'and listed',
    );
  });

  test('a feature video that ran After only makes its MP4 from the After side alone', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'video')),
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('run S')),
      ['run S after'],
    );
    assert.deepEqual(
      fake.annotations.map(({ sides }) => sides.map(({ side }) => side)),
      [['after']],
    );
    assert.equal(fake.annotations[0].sides[0].video, `${OUT}/after/S.webm`);
  });
});

describe('preflight: Chromium and ffmpeg are checked before the stack starts', () => {
  test('exits 2 with the reason when Chromium cannot be launched, before any stack call', async () => {
    const reason =
      'Chromium is not installed; run the Playwright install first';
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'none')),
      chromium: reason,
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 2);
    assert.deepEqual(fake.log, []);
    assert.deepEqual(fake.err, [`qa:run: ${reason}`]);
  });

  test('a screenshot-only run starts without ffmpeg, since its Storyboard is rendered in Chromium', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      ffmpeg: true,
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 0);
    assert.equal(fake.log[0], startLine('feature'));
    assert.equal(fake.err.includes(`qa:run: ${FFMPEG_MISSING_MESSAGE}`), false);
  });

  test('runs normally without ffmpeg when only transcript and none scenarios exist', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('T', 'transcript'), scenario('N', 'none')),
      ffmpeg: true,
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 0);
    assert.equal(fake.log[0], startLine('feature'));
  });
});

describe('bad input is refused before any stack call', () => {
  test('exits 2 when there are no scenario scripts', async () => {
    const fake = fakeRun({ exports: {} });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 2);
    assert.deepEqual(fake.log, []);
    assert.match(fake.err.join('\n'), /no scenario scripts/);
  });

  test('exits 2 and names the file when a scenario script cannot be loaded', async () => {
    const file = `${SCENARIOS}/S.ts`;
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'none')),
      loadFails: [file],
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 2);
    assert.deepEqual(fake.log, []);
    assert.match(
      fake.err.join('\n'),
      new RegExp(`${file} could not be loaded`),
    );
  });

  test('exits 2 and names the file when a scenario script exports a malformed scenario', async () => {
    const file = `${SCENARIOS}/S.ts`;
    const fake = fakeRun({
      exports: {
        [file]: { id: 'S', capture: 'clip', run: async () => undefined },
      },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 2);
    assert.deepEqual(fake.log, []);
    assert.match(
      fake.err.join('\n'),
      new RegExp(`${file}: capture must be one of`),
    );
  });
});

describe('a screen side with no step, or sides with unequal steps: the Storyboard is refused and no combined file is made', () => {
  const NO_STEP = (side: Side) =>
    `${side}: no step() was called, so no Storyboard was made`;
  const noStep = (): Partial<Scripted> => ({ steps: 0 });

  const REFUSED: {
    name: string;
    capture: Capture;
    changeKind: 'fix' | 'feature';
    runs: (id: string, side: Side) => Partial<Scripted> | undefined;
    zeroSides: Side[];
  }[] = [
    {
      name: 'a video fix where both sides take no step',
      capture: 'video',
      changeKind: 'fix',
      runs: noStep,
      zeroSides: ['before', 'after'],
    },
    {
      name: 'a video fix where After cannot run with no step and Before takes one',
      capture: 'video',
      changeKind: 'fix',
      runs: (_id, side) =>
        side === 'after' ? { outcome: 'cannot-run', steps: 0 } : {},
      zeroSides: ['after'],
    },
    {
      name: 'a screenshot fix where both sides take no step',
      capture: 'screenshot',
      changeKind: 'fix',
      runs: noStep,
      zeroSides: ['before', 'after'],
    },
    {
      name: 'a video feature, After only, with no step',
      capture: 'video',
      changeKind: 'feature',
      runs: noStep,
      zeroSides: ['after'],
    },
    {
      name: 'a screenshot feature, After only, with no step',
      capture: 'screenshot',
      changeKind: 'feature',
      runs: noStep,
      zeroSides: ['after'],
    },
    {
      name: 'a video fix where Before takes no step and After takes one',
      capture: 'video',
      changeKind: 'fix',
      runs: (_id, side) => (side === 'before' ? noStep() : {}),
      zeroSides: ['before'],
    },
  ];

  for (const c of REFUSED) {
    test(`${c.name} exits 1, names each side with no step, and makes no MP4 or render call`, async () => {
      const fake = fakeRun({
        exports: filesOf(scenario('X', c.capture)),
        runs: c.runs,
      });
      const exit = await runQaRun(argvFor(c.changeKind), fake.deps);
      assert.equal(exit, 1);
      const entry = manifestOf(fake).scenarios[0];
      assert.deepEqual(entry.problems, c.zeroSides.map(NO_STEP));
      assert.deepEqual(
        fake.log.filter((line) => /^(annotate|render) /.test(line)),
        [],
      );
      assert.equal(
        entry.files.some(({ place }) => place === 'combined'),
        false,
      );
    });
  }

  for (const capture of ['video', 'screenshot'] as const) {
    test(`a ${capture} fix whose Before and After take different step counts exits 1, names both counts, and makes no MP4 or render call`, async () => {
      const fake = fakeRun({
        exports: filesOf(scenario('X', capture)),
        runs: (id, side) => ({
          ...reproduced(id, side),
          steps: side === 'before' ? 1 : 2,
        }),
      });
      const exit = await runQaRun(argvFor('fix'), fake.deps);
      assert.equal(exit, 1);
      const entry = manifestOf(fake).scenarios[0];
      assert.deepEqual(entry.problems, [
        'Before took 1 step(s) and After took 2; steps are matched by index, so no Storyboard was made',
      ]);
      assert.deepEqual(
        fake.log.filter((line) => /^(annotate|render) /.test(line)),
        [],
      );
      assert.equal(
        entry.files.some(({ place }) => place === 'combined'),
        false,
      );
    });
  }

  test('a fix screenshot whose Storyboard render rejects exits 1, records the reason, lists no combined file, and removes its PNG', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      render: () => {
        throw new Error('Chromium crashed\nsecond line of the stack');
      },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(entry.problems, [
      'the Storyboard could not be rendered: Chromium crashed',
    ]);
    assert.equal(
      entry.files.some(({ place }) => place === 'combined'),
      false,
    );
    assert.ok(fake.removed.includes(`${OUT}/combined/S.png`));
  });
});

describe('the Storyboard of a screen scenario that ran on both sides', () => {
  test('a fix screenshot renders once to <out>/combined/<id>.png, from the kept steps, with the right arguments', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      runs: reproduced,
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    assert.equal(fake.renders.length, 1);
    const [render] = fake.renders;
    assert.equal(render.pngPath, storyboardPng('S'));
    assert.equal(render.stillRoot, OUT);

    const { storyboard } = render;
    assert.equal(storyboard.band.result, 'PASS');
    assert.deepEqual(storyboard.band.commits, {
      before: MERGE_BASE,
      after: HEAD,
    });
    assert.deepEqual(
      storyboard.sides.map((card) => [card.side, card.mark]),
      [
        ['before', 'as-expected'],
        ['after', 'as-expected'],
      ],
    );
    assert.deepEqual(
      storyboard.rows.map((row) => [
        row.cells.before?.still,
        row.cells.after?.still,
      ]),
      [['steps/S/before/01.png', 'steps/S/after/01.png']],
    );

    const png = manifestOf(fake).scenarios[0].files.find(
      ({ path }) => path === storyboardPng('S'),
    );
    assert.deepEqual(png, {
      path: storyboardPng('S'),
      place: 'combined',
      uploadEligible: true,
    });
    assert.ok(fake.disk.has(storyboardPng('S')), 'the PNG exists');
  });

  test('a Storyboard graded FAIL: regression is still listed, and is not offered for upload', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      runs: (_id, side) =>
        side === 'before'
          ? { outcome: 'pass', observed: 'the label is still there' }
          : { outcome: 'fail', message: 'the label is gone' },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.equal(fake.renders[0].storyboard.band.result, 'FAIL: regression');
    const png = manifestOf(fake).scenarios[0].files.find(
      ({ path }) => path === storyboardPng('S'),
    );
    assert.deepEqual(png, {
      path: storyboardPng('S'),
      place: 'combined',
      uploadEligible: false,
    });
  });

  test('the step stills move out of the work directory, and the step records are written and listed locally', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      runs: reproduced,
    });
    await runQaRun(argvFor('fix'), fake.deps);

    for (const side of ['before', 'after'] as const) {
      assert.ok(
        fake.ops.includes(
          `move ${OUT}/.work/${side}/S/01.png ${OUT}/steps/S/${side}/01.png`,
        ),
        `${side} still moved out of its work directory`,
      );
    }

    const text = fake.files.get(`${OUT}/steps/S.json`);
    assert.ok(text !== undefined, 'the step records were written');
    const records = JSON.parse(text) as {
      title: string;
      expected: { before: string; after: string };
      commits: { before: string; after: string };
      sides: Record<
        Side,
        {
          outcome: string;
          message?: string;
          observed?: string;
          steps: { still: string }[];
        }
      >;
    };
    assert.equal(records.title, 'S scenario');
    assert.deepEqual(records.expected, {
      before: 'the defect shows',
      after: 'the fix shows',
    });
    assert.deepEqual(records.commits, { before: MERGE_BASE, after: HEAD });
    assert.equal(records.sides.before.outcome, 'fail');
    assert.equal(records.sides.before.message, 'the defect shows here');
    assert.equal(records.sides.before.observed, undefined);
    assert.deepEqual(
      records.sides.before.steps.map(({ still }) => still),
      ['steps/S/before/01.png'],
    );
    assert.equal(records.sides.after.outcome, 'pass');
    assert.equal(records.sides.after.observed, 'the fix shows here');
    assert.deepEqual(
      records.sides.after.steps.map(({ still }) => still),
      ['steps/S/after/01.png'],
    );

    const listed = manifestOf(fake).scenarios[0].files.find(
      ({ path }) => path === `${OUT}/steps/S.json`,
    );
    assert.deepEqual(listed, {
      path: `${OUT}/steps/S.json`,
      place: 'local',
      uploadEligible: false,
    });
  });

  test('a fix video renders the Storyboard and makes the MP4, and both are listed', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: reproduced,
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(
      fake.renders.map(({ pngPath }) => pngPath),
      [storyboardPng('V')],
    );
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('annotate ')),
      [`annotate ${OUT}/combined/V.mp4`],
    );
    assert.deepEqual(
      manifestOf(fake)
        .scenarios[0].files.filter(({ place }) => place === 'combined')
        .map(({ path }) => path),
      [storyboardPng('V'), `${OUT}/combined/V.mp4`],
    );
  });

  test('a merge-base re-run of Before clears the earlier Before steps before its new stills move in', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('B', 'screenshot')),
      runs: (_id, side) =>
        side === 'after' ? { outcome: 'fail', message: 'broken' } : {},
    });
    await runQaRun(argvFor('feature'), fake.deps);
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('run B')),
      ['run B after', 'run B before'],
    );

    const cleared = fake.ops.indexOf(`remove ${OUT}/steps/B/before`);
    const moved = fake.ops.indexOf(
      `move ${OUT}/.work/before/B/01.png ${OUT}/steps/B/before/01.png`,
    );
    assert.ok(cleared >= 0, 'the Before steps directory is cleared');
    assert.ok(moved > cleared, 'the new Before still moves in after the clear');
  });

  test('a transcript writes no step records and renders no Storyboard', async () => {
    const fake = fakeRun({ exports: filesOf(scenario('X', 'transcript')) });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 0);
    assert.equal(fake.renders.length, 0);
    assert.equal(fake.files.has(`${OUT}/steps/X.json`), false);
    assert.equal(
      fake.ops.some((op) => op.includes('/steps/')),
      false,
    );
  });
});

describe('a Storyboard that is not drawn, or fails to draw', () => {
  test('a fix video whose Storyboard render rejects gets no MP4 call and no combined file, and its PNG is removed', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: reproduced,
      render: () => {
        throw new Error('Chromium crashed\nsecond line of the stack');
      },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);

    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(entry.problems, [
      'the Storyboard could not be rendered: Chromium crashed',
    ]);
    assert.equal(
      fake.log.some((line) => line.startsWith('annotate ')),
      false,
      'the MP4 is not made',
    );
    assert.equal(
      entry.files.some(({ place }) => place === 'combined'),
      false,
      'no combined file is listed',
    );
    assert.ok(fake.removed.includes(`${OUT}/combined/V.png`));
  });
});

describe('the Storyboard columns: one for a side run alone or alike sides, two for a re-run on the merge-base', () => {
  test('a feature run After only is drawn as one After column, with no expected.before needed', async () => {
    const solo = {
      id: 'F',
      capture: 'screenshot',
      title: 'F scenario',
      expected: { after: 'the fix shows' },
      run: async () => undefined,
    } satisfies Scenario;
    const fake = fakeRun({
      exports: filesOf(solo),
      runs: () => ({ observed: 'the fix shows here' }),
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('run F')),
      ['run F after'],
    );
    assert.equal(fake.renders.length, 1, 'the Storyboard is rendered');
    const { storyboard } = fake.renders[0];
    assert.deepEqual(storyboard.columns, ['after']);
    assert.deepEqual(
      storyboard.sides.map((card) => [card.side, card.mark]),
      [['after', 'as-expected']],
    );
    assert.equal(storyboard.band.alike, undefined);
    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(entry.problems, []);
    assert.deepEqual(
      entry.files.find(({ path }) => path === storyboardPng('F')),
      { path: storyboardPng('F'), place: 'combined', uploadEligible: true },
    );
  });

  test('identical expected results that both sides observed are drawn as one After column with the alike band text', async () => {
    const guard = {
      id: 'G',
      capture: 'screenshot',
      title: 'G scenario',
      expected: { before: 'the same label', after: 'the same label' },
      run: async () => undefined,
    } satisfies Scenario;
    const fake = fakeRun({
      exports: filesOf(guard),
      runs: () => ({ observed: 'the same label' }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);
    assert.equal(manifestOf(fake).scenarios[0].result, 'Not proven');

    assert.equal(fake.renders.length, 1, 'the Storyboard is rendered');
    const { storyboard } = fake.renders[0];
    assert.equal(storyboard.band.result, 'Not proven');
    assert.equal(storyboard.band.alike, ALIKE_TEXT);
    assert.deepEqual(storyboard.columns, ['after']);
    assert.deepEqual(
      storyboard.rows.map((row) => row.cells.before?.still),
      ['steps/G/before/01.png'],
      'the Before cell stays in the row as evidence',
    );
    assert.deepEqual(
      manifestOf(fake).scenarios[0].files.find(
        ({ path }) => path === storyboardPng('G'),
      ),
      { path: storyboardPng('G'), place: 'combined', uploadEligible: true },
    );
  });

  test('a feature with no expected.before, After failing and re-run on Before, is drawn as two columns and keeps its step records', async () => {
    // Pre-existing: Before also fails, so the headline is not a regression.
    const plain = {
      id: 'P',
      capture: 'screenshot',
      title: 'P scenario',
      expected: { after: 'the fix shows' },
      run: async () => undefined,
    } satisfies Scenario;
    const fake = fakeRun({
      exports: filesOf(plain),
      runs: (_id, side) =>
        side === 'after'
          ? { outcome: 'fail', message: 'still broken' }
          : { outcome: 'fail', message: 'the defect is still there' },
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 0, 'FAIL: pre-existing does not fail the headline');

    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('run P')),
      ['run P after', 'run P before'],
    );
    const manifest = manifestOf(fake);
    assert.equal(manifest.scenarios[0].result, 'FAIL: pre-existing');
    assert.equal(
      manifest.headline,
      'QA passed, not proven or pre-existing items listed',
    );
    assert.deepEqual(manifest.scenarios[0].problems, []);

    // Before was never told what to expect, so its card says so and its column
    // stands beside After's.
    assert.equal(fake.renders.length, 1, 'the Storyboard is rendered');
    const { storyboard } = fake.renders[0];
    assert.deepEqual(storyboard.columns, ['before', 'after']);
    assert.deepEqual(
      storyboard.sides.map((card) => [card.side, card.expected]),
      [
        ['before', NOT_DECLARED],
        ['after', 'the fix shows'],
      ],
    );
    assert.equal(storyboard.band.alike, undefined);
    assert.deepEqual(
      manifest.scenarios[0].files.find(
        ({ path }) => path === storyboardPng('P'),
      ),
      { path: storyboardPng('P'), place: 'combined', uploadEligible: true },
    );
    assert.ok(
      manifest.scenarios[0].files.some(
        ({ path, place }) =>
          path === `${OUT}/steps/P.json` && place === 'local',
      ),
      'the step records are listed locally',
    );
  });
});

describe('a Request Transcript', () => {
  const LOGIN: RecordedCall = {
    request: {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: {
        email: 'qa-primary@example.test',
        password: 'SECRET-VALUE',
      },
    },
    response: { status: 200, body: { message: 'ok' } },
  };

  test('is written redacted under transcripts/, lists in run.json, and is never offered for upload', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('X', 'transcript')),
      runs: () => ({ calls: [LOGIN] }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    const transcript = fake.files.get(`${OUT}/transcripts/X.md`);
    assert.ok(transcript !== undefined, 'the transcript was written');
    assert.match(transcript, /"password": "\[withheld\]"/);
    assert.doesNotMatch(transcript, /SECRET-VALUE/);
    assert.match(transcript, /\*\*Before\*\*/);
    assert.match(transcript, /\*\*After\*\*/);

    const manifest = manifestOf(fake);
    assert.deepEqual(manifest.scenarios[0].files, [
      {
        path: `${OUT}/transcripts/X.md`,
        place: 'transcript',
        uploadEligible: false,
      },
    ]);
    for (const text of [...fake.files.values(), ...fake.out, ...fake.err]) {
      assert.doesNotMatch(text, /SECRET-VALUE/);
    }
  });

  test('a refused transcript writes no transcript, keeps the calls locally, and exits 1 without echoing a value', async () => {
    const UNKNOWN: RecordedCall = {
      request: { method: 'GET', path: '/api/v1/items' },
      response: { status: 200, body: { unknownFieldXyz: 'V-VALUE' } },
    };
    const fake = fakeRun({
      exports: filesOf(scenario('X', 'transcript')),
      runs: () => ({ calls: [UNKNOWN] }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);

    assert.equal(fake.files.has(`${OUT}/transcripts/X.md`), false);
    const localCalls = `${OUT}/local/X.calls.json`;
    assert.ok(fake.files.has(localCalls), 'the calls were kept locally');

    const manifest = manifestOf(fake);
    assert.deepEqual(
      manifest.scenarios[0].files.find(({ path }) => path === localCalls),
      {
        path: localCalls,
        place: 'local',
        uploadEligible: false,
      },
    );
    assert.match(fake.err.join('\n'), /the Request Transcript was refused at/);
    const printed = [...fake.out, ...fake.err].join('\n');
    assert.doesNotMatch(printed, /V-VALUE/);
    assert.doesNotMatch(printed, /unknownFieldXyz/);
  });
});

describe("the run's printed output", () => {
  test('a successful run prints the headline, the run.json path, and the command that stops the stack', async () => {
    const fake = fakeRun({ exports: filesOf(scenario('N', 'none')) });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 0);
    assert.ok(fake.out.includes('qa:run: QA passed'));
    assert.ok(fake.out.includes(`qa:run: wrote ${RUN_JSON}`));
    const printed = fake.out.join('\n');
    assert.match(printed, /still up/);
    assert.match(printed, /yarn qa:stack:stop/);
  });
});

/** A tab's recording as the runner keeps it: under `local/`, by side and tab number only (#1554). */
const tabLocal = (id: string, side: Side, n: number): string =>
  `${OUT}/local/${id}-${side}-tab${n}.webm`;

/** A tab's recording as the browser wrote it, in the side's work directory. */
const tabWork = (id: string, side: Side, device: string, tab: string): string =>
  `${OUT}/.work/${side}/${id}/${device}-${tab}.webm`;

describe('a tab other than the default is recorded locally and never offered', () => {
  test('every other tab is listed local and never offered, even when the MP4 of a passing video is offered', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: (id, side) => ({
        ...reproduced(id, side),
        tabVideos: [
          {
            device: 'B',
            tab: 'B1',
            path: tabWork(id, side, 'B', 'B1'),
            openedAtMs: 1200,
          },
          {
            device: 'B',
            tab: 'B2',
            path: tabWork(id, side, 'B', 'B2'),
            openedAtMs: 1400,
          },
        ],
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    const [entry] = manifestOf(fake).scenarios;
    assert.equal(entry?.result, 'PASS');
    assert.deepEqual(
      entry?.files.find((file) => file.path.endsWith('.mp4')),
      {
        path: `${OUT}/combined/V.mp4`,
        place: 'combined',
        uploadEligible: true,
      },
    );
    const tabFiles = entry?.files.filter((file) => file.path.includes('-tab'));
    const expected = [
      tabLocal('V', 'before', 1),
      tabLocal('V', 'before', 2),
      tabLocal('V', 'after', 1),
      tabLocal('V', 'after', 2),
    ];
    assert.deepEqual(
      tabFiles?.map((file) => file.path).sort(),
      sorted(expected),
    );
    for (const file of tabFiles ?? []) {
      assert.equal(file.place, 'local');
      assert.equal(file.uploadEligible, false);
    }
    const onDisk = kept(fake);
    for (const path of expected) assert.ok(onDisk.includes(path), path);
    assert.equal(
      onDisk.some((path) => path.includes('/.work/')),
      false,
      'each tab recording moved out of the work directory',
    );
  });

  test('a tab with no recording is a problem: exits 1, names the tab, and keeps no file for it', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('N', 'none')),
      runs: () => ({
        tabVideos: [
          {
            device: 'B',
            tab: 'B1',
            path: tabWork('N', 'after', 'B', 'B1'),
            openedAtMs: 1200,
          },
          { device: 'B', tab: 'B2', path: null, openedAtMs: 1400 },
        ],
      }),
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 1);

    const [entry] = manifestOf(fake).scenarios;
    assert.deepEqual(entry?.problems, [
      'after: no video was recorded for tab 2',
    ]);
    assert.match(
      fake.err.join('\n'),
      /qa:run: N: after: no video was recorded for tab 2/,
    );
    assert.deepEqual(
      entry?.files.filter((file) => file.path.includes('-tab')),
      [
        {
          path: tabLocal('N', 'after', 1),
          place: 'local',
          uploadEligible: false,
        },
      ],
      'the tab with a recording is still kept, and the missing one is not',
    );
    assert.ok(kept(fake).includes(tabLocal('N', 'after', 1)));
  });

  test('a run with no other tab keeps only what its line asks for, plus its step records, and makes the MP4 from the same two recordings', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: reproduced,
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    const [entry] = manifestOf(fake).scenarios;
    assert.deepEqual(
      entry?.files
        .filter((file) => file.place === 'local')
        .map((file) => file.path),
      [`${OUT}/steps/V.json`],
    );
    assert.deepEqual(
      fake.annotations.map(({ sides }) => sides.map(({ video }) => video)),
      [[`${OUT}/before/V.webm`, `${OUT}/after/V.webm`]],
    );
  });

  test('an MP4 follows the tab its scenario names: that tab is the side recording, and the default tab is kept locally', async () => {
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab: 'B1' }),
      runs: (id, side) => ({
        ...reproduced(id, side),
        tabVideos: [
          {
            device: 'B',
            tab: 'B1',
            path: tabWork(id, side, 'B', 'B1'),
            openedAtMs: 1200,
          },
        ],
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    assert.equal(fake.annotations.length, 1);
    const [plan] = fake.annotations;
    assert.equal(plan.output, `${OUT}/combined/V.mp4`);
    assert.deepEqual(
      plan.sides.map(({ side, video, device, tab, label, openedAtMs }) => [
        side,
        video,
        device,
        tab,
        label,
        openedAtMs,
      ]),
      [
        [
          'before',
          `${OUT}/before/V.webm`,
          'B',
          'B1',
          'Device B · tab B1',
          1200,
        ],
        ['after', `${OUT}/after/V.webm`, 'B', 'B1', 'Device B · tab B1', 1200],
      ],
    );

    const files = manifestOf(fake).scenarios[0].files;
    assert.deepEqual(
      files.find(({ path }) => path === `${OUT}/local/V-before.webm`),
      {
        path: `${OUT}/local/V-before.webm`,
        place: 'local',
        uploadEligible: false,
      },
    );
    assert.deepEqual(
      files.find(({ path }) => path === `${OUT}/local/V-after.webm`),
      {
        path: `${OUT}/local/V-after.webm`,
        place: 'local',
        uploadEligible: false,
      },
    );
  });

  test('an MP4 tab that was not opened on one side is a problem: no MP4 is made, the problem names the tab, and the Storyboard is still listed', async () => {
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab: 'B1' }),
      runs: (id, side) => ({
        ...reproduced(id, side),
        ...(side === 'after'
          ? {
              tabVideos: [
                {
                  device: 'B',
                  tab: 'B1',
                  path: tabWork(id, side, 'B', 'B1'),
                  openedAtMs: 1200,
                },
              ],
            }
          : {}),
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.annotations, [], 'no MP4 is made');

    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(entry.problems, [
      'before: no tab named "B1" was opened, so no MP4 was made',
    ]);
    assert.ok(
      entry.files.some(
        ({ path, place }) =>
          path === storyboardPng('V') && place === 'combined',
      ),
      'the Storyboard is still listed',
    );
    assert.equal(
      entry.files.some(({ path }) => path.endsWith('.mp4')),
      false,
    );
  });

  test('a tab open on two devices is ambiguous: the problem names both devices, and no MP4 is made', async () => {
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab: 'B1' }),
      runs: (id, side) => ({
        ...reproduced(id, side),
        tabVideos: [
          {
            device: 'B',
            tab: 'B1',
            path: tabWork(id, side, 'B', 'B1'),
            openedAtMs: 1200,
          },
          {
            device: 'C',
            tab: 'B1',
            path: tabWork(id, side, 'C', 'B1'),
            openedAtMs: 1300,
          },
        ],
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.annotations, [], 'no MP4 is made');
    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(entry.problems, [
      'before: tab "B1" is open on devices B, C, so the tab the MP4 follows is ambiguous and no MP4 was made',
      'after: tab "B1" is open on devices B, C, so the tab the MP4 follows is ambiguous and no MP4 was made',
    ]);
    assert.ok(
      entry.files.some(
        ({ path, place }) =>
          path === storyboardPng('V') && place === 'combined',
      ),
      'the Storyboard is still listed',
    );
  });

  test('an MP4 tab whose recording is missing on one side is a problem: no MP4 is made, and the Storyboard is still listed', async () => {
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab: 'B1' }),
      runs: (id, side) => ({
        ...reproduced(id, side),
        tabVideos: [
          {
            device: 'B',
            tab: 'B1',
            path: side === 'after' ? null : tabWork(id, side, 'B', 'B1'),
            openedAtMs: 1200,
          },
        ],
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.annotations, [], 'no MP4 is made');

    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(entry.problems, [
      'after: no video was recorded for device B, tab B1, so no MP4 was made',
    ]);
    assert.ok(
      entry.files.some(
        ({ path, place }) =>
          path === storyboardPng('V') && place === 'combined',
      ),
      'the Storyboard is still listed',
    );
  });

  test("a default tab with no recording on either side is a problem on each side, and the MP4 still follows B1's recording", async () => {
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab: 'B1' }),
      runs: (id, side) => ({
        ...reproduced(id, side),
        video: false,
        tabVideos: [
          {
            device: 'B',
            tab: 'B1',
            path: tabWork(id, side, 'B', 'B1'),
            openedAtMs: 1200,
          },
        ],
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);

    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(entry.problems, [
      'before: no video was recorded',
      'after: no video was recorded',
    ]);
    assert.deepEqual(
      fake.annotations.map(({ sides }) => sides.map(({ video }) => video)),
      [[`${OUT}/before/V.webm`, `${OUT}/after/V.webm`]],
    );
    assert.ok(
      entry.files.some(
        ({ path, place }) =>
          path === `${OUT}/combined/V.mp4` && place === 'combined',
      ),
      'the MP4 is listed',
    );
  });

  test('neither side opens the MP4 tab: each side names the missing tab, no MP4 is made, and the Storyboard is still listed', async () => {
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab: 'B1' }),
      runs: reproduced,
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.annotations, [], 'no MP4 is made');

    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(entry.problems, [
      'before: no tab named "B1" was opened, so no MP4 was made',
      'after: no tab named "B1" was opened, so no MP4 was made',
    ]);
    assert.ok(
      entry.files.some(
        ({ path, place }) =>
          path === storyboardPng('V') && place === 'combined',
      ),
      'the Storyboard is still listed',
    );
  });
});

describe('a Storyboard that holds a denied value, or a Bearer or JWT, is refused', () => {
  /** A value the browser reports as denied, such as a QA Account password. */
  const DENIED = 'hunter2-fake';
  const BEARER = 'Bearer qa-tok';
  // A JWT shape built at runtime: a readable header prefix, two dotted segments.
  const JWT = ['eyJ'.concat('a'.repeat(8)), 'b'.repeat(8), 'c2ln'].join('.');

  interface StepRecordsFile {
    refused?: string[];
    sides: Record<string, { steps: { caption: string }[] }>;
  }

  function problemsOf(fake: ReturnType<typeof fakeRun>, id: string): string[] {
    const entry = manifestOf(fake).scenarios.find((s) => s.id === id);
    assert.ok(entry !== undefined, `${id} is in run.json`);
    return entry.problems;
  }

  test('a caption holding a denied value refuses a screenshot: no PNG, the step records hold [withheld] and name the field, and a harmless message stays verbatim in run.json', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      runs: (_id, side) =>
        side === 'before'
          ? {
              outcome: 'fail',
              message: 'the defect shows here',
              denied: [DENIED],
              captions: [`typed ${DENIED}`],
            }
          : { observed: 'the fix shows here', denied: [DENIED] },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.renders, [], 'no Storyboard is rendered');

    const recordsText = fake.files.get(`${OUT}/steps/S.json`);
    assert.ok(recordsText !== undefined, 'the step records were written');
    const records = JSON.parse(recordsText) as StepRecordsFile;
    assert.deepEqual(records.refused, ['S before step 1 caption']);
    assert.equal(records.sides.before?.steps[0].caption, '[withheld]');

    const [entry] = manifestOf(fake).scenarios;
    // The message holds no known value, so the run-wide rule (#1554) keeps it.
    assert.equal(entry.runs.before?.message, 'the defect shows here');
    assert.equal(
      fake.files.has(`${OUT}/local/S-before.message.txt`),
      false,
      'a harmless message is kept in no message file',
    );
    assert.deepEqual(entry.problems, [
      'the Storyboard was refused: a secret or credential is in S before step 1 caption',
    ]);
    assert.equal(
      entry.files.some(({ place }) => place === 'combined'),
      false,
      'no combined file is listed',
    );
    for (const text of everyOutput(fake)) {
      assert.equal(text.includes(DENIED), false, 'the value is in no output');
    }
  });

  test('a video whose after observed holds a denied value gets no PNG and no MP4', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: (_id, side) =>
        side === 'before'
          ? {
              outcome: 'fail',
              message: 'the defect shows here',
              denied: [DENIED],
            }
          : { observed: `the fix shows ${DENIED}`, denied: [DENIED] },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.renders, [], 'no Storyboard is rendered');
    assert.equal(
      fake.log.some((line) => line.startsWith('annotate ')),
      false,
      'the MP4 is not made',
    );
    assert.equal(
      manifestOf(fake).scenarios[0].files.some(
        ({ place }) => place === 'combined',
      ),
      false,
      'no combined file is listed',
    );
    assert.deepEqual(problemsOf(fake, 'V'), [
      'the Storyboard was refused: a secret or credential is in V after observed',
    ]);
    for (const text of everyOutput(fake)) {
      assert.equal(text.includes(DENIED), false, 'the value is in no output');
    }
  });

  test('a video caption holding a denied value refuses the Storyboard and the MP4: no PNG, no MP4 call, and nothing under combined/ is listed', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: (_id, side) =>
        side === 'before'
          ? {
              outcome: 'fail',
              message: 'the defect shows here',
              denied: [DENIED],
              captions: [`typed ${DENIED}`],
            }
          : { observed: 'the fix shows here', denied: [DENIED] },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.renders, [], 'no Storyboard is rendered');
    assert.deepEqual(fake.annotations, [], 'no MP4 is made');
    assert.deepEqual(problemsOf(fake, 'V'), [
      'the Storyboard was refused: a secret or credential is in V before step 1 caption',
    ]);
    assert.equal(
      manifestOf(fake).scenarios[0].files.some(({ path }) =>
        path.includes('/combined/'),
      ),
      false,
      'nothing under combined/ is listed',
    );
    for (const text of everyOutput(fake)) {
      assert.equal(text.includes(DENIED), false, 'the value is in no output');
    }
  });

  test("a video's MP4 tab label holding a denied value refuses the Storyboard and the MP4: no PNG, no MP4 call, each side's label is named, and nothing under combined/ is listed", async () => {
    // The denied value is in the tab's name, so it is in the label the MP4 shows.
    const tab = `B1-${DENIED}`;
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab }),
      runs: (id, side) => ({
        ...reproduced(id, side),
        denied: [DENIED],
        tabVideos: [
          {
            device: 'B',
            tab,
            path: tabWork(id, side, 'B', tab),
            openedAtMs: 1200,
          },
        ],
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.renders, [], 'no Storyboard is rendered');
    assert.deepEqual(fake.annotations, [], 'no MP4 is made');
    assert.deepEqual(problemsOf(fake, 'V'), [
      'the Storyboard was refused: a secret or credential is in V video before label; V video after label',
    ]);
    assert.equal(
      manifestOf(fake).scenarios[0].files.some(({ path }) =>
        path.includes('/combined/'),
      ),
      false,
      'nothing under combined/ is listed',
    );
    for (const text of everyOutput(fake)) {
      assert.equal(text.includes(DENIED), false, 'the value is in no output');
    }
  });

  test('the same video with a clean tab name makes its MP4, labelled with that tab', async () => {
    const tab = 'B1-clean';
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab }),
      runs: (id, side) => ({
        ...reproduced(id, side),
        tabVideos: [
          {
            device: 'B',
            tab,
            path: tabWork(id, side, 'B', tab),
            openedAtMs: 1200,
          },
        ],
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(
      fake.annotations.map(({ sides }) => sides.map(({ label }) => label)),
      [[`Device B · tab ${tab}`, `Device B · tab ${tab}`]],
    );
  });

  test('a failure message holding a denied value is withheld from run.json, kept owner-only under local/, and kept out of every other output', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      runs: (_id, side) =>
        side === 'before'
          ? { observed: 'the label is there', denied: [DENIED] }
          : {
              outcome: 'fail',
              message: `the label is gone after ${DENIED}`,
              denied: [DENIED],
            },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.renders, []);

    const recordsText = fake.files.get(`${OUT}/steps/S.json`);
    assert.ok(recordsText !== undefined, 'the step records were written');
    assert.deepEqual((JSON.parse(recordsText) as StepRecordsFile).refused, [
      'S after message',
    ]);
    const [entry] = manifestOf(fake).scenarios;
    const messageFile = `${OUT}/local/S-after.message.txt`;
    assert.equal(
      entry.runs.after?.message,
      '[withheld: it holds a secret or credential; the message is in local/S-after.message.txt]',
    );
    assert.equal(
      fake.files.get(messageFile),
      `the label is gone after ${DENIED}\n`,
      'the raw message is kept owner-only',
    );
    assert.deepEqual(
      entry.files.find(({ path }) => path === messageFile),
      { path: messageFile, place: 'local', uploadEligible: false },
    );
    for (const text of everyOutput(fake, [messageFile])) {
      assert.equal(text.includes(DENIED), false, 'the value is in no output');
    }
  });

  test('a clean scenario beside a refused one still renders, keeps its unrefused message, and the denied value reaches no output', async () => {
    const fake = fakeRun({
      exports: filesOf(
        scenario('P', 'screenshot'),
        scenario('R', 'screenshot'),
      ),
      runs: (id, side) => {
        const base = reproduced(id, side);
        return id === 'R' && side === 'after'
          ? { ...base, denied: [DENIED], captions: [`typed ${DENIED}`] }
          : { ...base, denied: [DENIED] };
      },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);

    assert.deepEqual(
      fake.renders.map(({ pngPath }) => pngPath),
      [storyboardPng('P')],
      'only the clean scenario renders',
    );
    const manifest = manifestOf(fake);
    const passing = manifest.scenarios.find((s) => s.id === 'P');
    assert.equal(passing?.runs.before?.message, 'the defect shows here');
    assert.deepEqual(problemsOf(fake, 'P'), []);
    assert.deepEqual(problemsOf(fake, 'R'), [
      'the Storyboard was refused: a secret or credential is in R after step 1 caption',
    ]);
    for (const text of everyOutput(fake)) {
      assert.equal(text.includes(DENIED), false, 'the value is in no output');
    }
  });

  test('a Bearer or a JWT refuses the Storyboard with no denied value supplied, and neither value is written', async () => {
    const fake = fakeRun({
      exports: filesOf(
        scenario('B', 'screenshot'),
        scenario('J', 'screenshot'),
      ),
      runs: (id, side) => {
        if (side === 'before') {
          return { outcome: 'fail', message: 'the defect shows here' };
        }
        return id === 'B'
          ? { observed: 'the fix shows here', captions: [`sent ${BEARER}`] }
          : { observed: `the fix sent ${JWT}` };
      },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.renders, []);
    assert.deepEqual(problemsOf(fake, 'B'), [
      'the Storyboard was refused: a secret or credential is in B after step 1 caption',
    ]);
    assert.deepEqual(problemsOf(fake, 'J'), [
      'the Storyboard was refused: a secret or credential is in J after observed',
    ]);
    for (const text of everyOutput(fake)) {
      assert.equal(text.includes(BEARER), false, 'the Bearer is in no output');
      assert.equal(text.includes(JWT), false, 'the JWT is in no output');
    }
  });
});

describe('the step records a video scenario saves for its re-render (PRD #1550)', () => {
  /** A value the browser reports as denied, held only in the run's memory. */
  const SECRET = 'hunter2-fake';
  const WITHHELD = '[withheld]';

  /** The step records `qa:run` wrote for scenario `id`. */
  function savedRecords(
    fake: ReturnType<typeof fakeRun>,
    id: string,
  ): Record<string, unknown> {
    const text = fake.files.get(`${OUT}/steps/${id}.json`);
    assert.ok(text !== undefined, 'the step records were written');
    return JSON.parse(text) as Record<string, unknown>;
  }

  /**
   * Re-renders scenario `id` of the run `fake` made, with `runCombine` over
   * copies of its disk and files. Each renderer's arguments are recorded.
   */
  async function reRenderFrom(fake: ReturnType<typeof fakeRun>, id: string) {
    const disk = new Set(fake.disk);
    const texts = new Map(fake.files);
    const renders: {
      storyboard: Storyboard;
      stillRoot: string;
      pngPath: string;
    }[] = [];
    const annotations: AnnotatedVideoPlan[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCombine(['--run', OUT, '--scenario', id], {
      run: () => ({ status: 0, stderr: '' }),
      exists: (path) => disk.has(path) || texts.has(path),
      makeDir: () => undefined,
      removePath(path) {
        disk.delete(path);
        texts.delete(path);
      },
      readFile(path) {
        const text = texts.get(path);
        assert.ok(text !== undefined, `${path} was saved by qa:run`);
        return text;
      },
      movePath(from, to) {
        disk.delete(from);
        disk.add(to);
      },
      async renderStoryboard(storyboard, stillRoot, pngPath) {
        renders.push({ storyboard, stillRoot, pngPath });
        disk.add(pngPath);
      },
      async annotateVideo(plan) {
        annotations.push(plan);
        disk.add(plan.output);
      },
      chromiumMissing: () => null,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    return { code, renders, annotations, disk, out, err };
  }

  test("a video scenario saves a video block with each side's tab facts and no recording path", async () => {
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab: 'B1' }),
      runs: (id, side) => ({
        ...reproduced(id, side),
        tabVideos: [
          {
            device: 'B',
            tab: 'B1',
            path: tabWork(id, side, 'B', 'B1'),
            openedAtMs: 1200,
          },
        ],
      }),
    });
    assert.equal(await runQaRun(argvFor('fix'), fake.deps), 0);
    const records = savedRecords(fake, 'V');
    assert.deepEqual(records.video, {
      tab: 'B1',
      sides: {
        before: {
          device: 'B',
          tab: 'B1',
          label: 'Device B · tab B1',
          openedAtMs: 1200,
        },
        after: {
          device: 'B',
          tab: 'B1',
          label: 'Device B · tab B1',
          openedAtMs: 1200,
        },
      },
    });
    assert.equal(records.refused, undefined, 'nothing is refused');
  });

  test("a video on its default tab saves that tab's facts, and a screen scenario saves no video block", async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video'), scenario('S', 'screenshot')),
      runs: reproduced,
    });
    assert.equal(await runQaRun(argvFor('fix'), fake.deps), 0);
    const defaultTab = {
      device: DEFAULT_TAB,
      tab: DEFAULT_TAB,
      label: 'Device A',
      openedAtMs: 0,
    };
    assert.deepEqual(savedRecords(fake, 'V').video, {
      tab: DEFAULT_TAB,
      sides: { before: defaultTab, after: defaultTab },
    });
    assert.equal(
      'video' in savedRecords(fake, 'S'),
      false,
      'a screen scenario saves no video block',
    );
  });

  test("a clock start the browser run reports lands on each side's video block, for a tab other than the default, and the re-render plan carries it", async () => {
    const start = Date.UTC(2026, 0, 2, 3, 4, 5);
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab: 'B1' }),
      runs: (id, side) => ({
        ...reproduced(id, side),
        startedAtMs: side === 'before' ? start : start + 1000,
        tabVideos: [
          {
            device: 'B',
            tab: 'B1',
            path: tabWork(id, side, 'B', 'B1'),
            openedAtMs: 1200,
          },
        ],
      }),
    });
    assert.equal(await runQaRun(argvFor('fix'), fake.deps), 0);
    const block = savedRecords(fake, 'V').video as {
      sides: Record<string, { openedAtMs: number; startedAtMs?: number }>;
    };
    assert.equal(block.sides.before?.startedAtMs, start);
    assert.equal(block.sides.after?.startedAtMs, start + 1000);
    assert.equal(
      block.sides.before?.openedAtMs,
      1200,
      'the tab facts are kept',
    );

    const re = await reRenderFrom(fake, 'V');
    assert.equal(re.code, 0, re.err.join('\n'));
    assert.deepEqual(
      re.annotations[0]?.sides.map(({ startedAtMs }) => startedAtMs),
      [start, start + 1000],
    );
  });

  test("a tab label holding a denied value withholds the block's device, tab and label and the top-level tab, and names each label", async () => {
    const tab = `B1-${SECRET}`;
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab }),
      runs: (id, side) => ({
        ...reproduced(id, side),
        denied: [SECRET],
        tabVideos: [
          {
            device: 'B',
            tab,
            path: tabWork(id, side, 'B', tab),
            openedAtMs: 1200,
          },
        ],
      }),
    });
    assert.equal(await runQaRun(argvFor('fix'), fake.deps), 1);
    const records = savedRecords(fake, 'V');
    assert.deepEqual(records.refused, [
      'V video before label',
      'V video after label',
    ]);
    const withheld = {
      device: WITHHELD,
      tab: WITHHELD,
      label: WITHHELD,
      openedAtMs: 1200,
    };
    assert.deepEqual(records.video, {
      tab: WITHHELD,
      sides: { before: withheld, after: withheld },
    });
    const everything = [
      ...fake.files.keys(),
      ...fake.files.values(),
      ...fake.out,
      ...fake.err,
    ];
    for (const text of everything) {
      assert.equal(text.includes(SECRET), false, 'the value is in no output');
    }
  });

  test('a video re-render from the saved records hands the renderers the Storyboard and MP4 plan qa:run made', async () => {
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab: 'B1' }),
      runs: (id, side) => ({
        ...reproduced(id, side),
        stepAtMs: [1500],
        tabVideos: [
          {
            device: 'B',
            tab: 'B1',
            path: tabWork(id, side, 'B', 'B1'),
            openedAtMs: 1200,
          },
        ],
      }),
    });
    assert.equal(await runQaRun(argvFor('fix'), fake.deps), 0);
    const re = await reRenderFrom(fake, 'V');
    assert.deepEqual(re.err, []);
    assert.equal(re.code, 0);
    assert.deepEqual(
      re.renders.map(({ storyboard }) => storyboard),
      fake.renders.map(({ storyboard }) => storyboard),
      'the same Storyboard',
    );
    assert.deepEqual(
      re.annotations.map(({ band, sides }) => ({ band, sides })),
      fake.annotations.map(({ band, sides }) => ({ band, sides })),
      'the same band and sides',
    );
    assert.deepEqual(
      re.renders.map(({ stillRoot, pngPath }) => [stillRoot, pngPath]),
      [[OUT, `${OUT}/combined/.recombine-V.png`]],
    );
    assert.equal(re.annotations[0].output, `${OUT}/combined/.recombine-V.mp4`);
    assert.equal(re.disk.has(storyboardPng('V')), true);
    assert.equal(re.disk.has(`${OUT}/combined/V.mp4`), true);
  });

  test('a screenshot re-render from the saved records hands the renderer the Storyboard qa:run drew', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      runs: reproduced,
    });
    assert.equal(await runQaRun(argvFor('fix'), fake.deps), 0);
    const re = await reRenderFrom(fake, 'S');
    assert.equal(re.code, 0);
    assert.deepEqual(
      re.renders.map(({ storyboard }) => storyboard),
      fake.renders.map(({ storyboard }) => storyboard),
    );
    assert.deepEqual(re.annotations, []);
    assert.equal(re.disk.has(storyboardPng('S')), true);
  });
});

describe('run.json and transcripts hold no known secret (#1554)', () => {
  // Fixture values only, each kept at 15 characters or fewer.
  /** An account password a scenario registers as denied. */
  const PASSWORD = 'hunter2-fake';
  /** A value a scenario passes to `secret()`. */
  const VALUE = 'fixture-val-1';
  /** A value only one scenario registers, to show the set is the whole run's. */
  const SHARED = 'shared-fixt-01';
  // A JWT shape built at runtime: a readable header prefix, two dotted segments.
  const JWT = ['eyJ'.concat('a'.repeat(8)), 'b'.repeat(8), 'c2ln'].join('.');
  const WITHHELD_PROBLEM = '[withheld: it holds a secret or credential]';

  const messageFile = (id: string, side: Side): string =>
    `${OUT}/local/${id}-${side}.message.txt`;

  /**
   * A withheld message: run.json names its owner-only file in place of the
   * text, the raw message is in that file alone, and the file is local.
   */
  function assertMessageWithheld(
    fake: ReturnType<typeof fakeRun>,
    id: string,
    side: Side,
    raw: string,
  ): void {
    const entry = manifestOf(fake).scenarios.find((s) => s.id === id);
    assert.ok(entry !== undefined, `${id} is in run.json`);
    assert.equal(
      entry.runs[side]?.message,
      `[withheld: it holds a secret or credential; the message is in local/${id}-${side}.message.txt]`,
    );
    assert.equal(fake.files.get(messageFile(id, side)), `${raw}\n`);
    assert.deepEqual(
      entry.files.find(({ path }) => path === messageFile(id, side)),
      { path: messageFile(id, side), place: 'local', uploadEligible: false },
    );
  }

  test('a transcript failure message holding the account password is withheld from run.json, and its raw text is kept owner-only', async () => {
    const message = `login refused for ${PASSWORD}`;
    const fake = fakeRun({
      exports: filesOf(scenario('X', 'transcript')),
      runs: (id, side) =>
        side === 'before'
          ? { outcome: 'fail', message, denied: [PASSWORD] }
          : { ...reproduced(id, side), denied: [PASSWORD] },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    assertMessageWithheld(fake, 'X', 'before', message);
    for (const text of everyOutput(fake, [messageFile('X', 'before')])) {
      assert.equal(
        text.includes(PASSWORD),
        false,
        'the password is in no output',
      );
    }
  });

  test('a none scenario whose failure message holds a value passed to secret() is withheld the same way', async () => {
    const message = `could not type ${VALUE}`;
    const fake = fakeRun({
      exports: filesOf(scenario('N', 'none')),
      runs: (id, side) =>
        side === 'before'
          ? { outcome: 'fail', message, denied: [VALUE] }
          : { ...reproduced(id, side), denied: [VALUE] },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    assertMessageWithheld(fake, 'N', 'before', message);
    for (const text of everyOutput(fake, [messageFile('N', 'before')])) {
      assert.equal(text.includes(VALUE), false, 'the value is in no output');
    }
  });

  test('a failure message holding a JWT is withheld by the detector even with no denied value supplied', async () => {
    const message = `the fix sent ${JWT}`;
    const fake = fakeRun({
      exports: filesOf(scenario('N', 'none')),
      runs: (id, side) =>
        side === 'before' ? { outcome: 'fail', message } : reproduced(id, side),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    assertMessageWithheld(fake, 'N', 'before', message);
    for (const text of everyOutput(fake, [messageFile('N', 'before')])) {
      assert.equal(text.includes(JWT), false, 'the JWT is in no output');
    }
  });

  test('a failure message holding a JWT in a transcript scenario is withheld the same way', async () => {
    const message = `the fix sent ${JWT}`;
    const fake = fakeRun({
      exports: filesOf(scenario('X', 'transcript')),
      runs: (id, side) =>
        side === 'before' ? { outcome: 'fail', message } : reproduced(id, side),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    assertMessageWithheld(fake, 'X', 'before', message);
    for (const text of everyOutput(fake, [messageFile('X', 'before')])) {
      assert.equal(text.includes(JWT), false, 'the JWT is in no output');
    }
  });

  test('a harmless failure message on a none scenario is kept verbatim in run.json, and no message file is written', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('N', 'none')),
      runs: reproduced,
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    const [entry] = manifestOf(fake).scenarios;
    assert.equal(entry.runs.before?.message, 'the defect shows here');
    assert.equal(
      [...fake.files.keys()].some((path) => path.endsWith('.message.txt')),
      false,
      'no message file is written',
    );
    assert.equal(
      entry.files.some(({ path }) => path.endsWith('.message.txt')),
      false,
      'no message file is listed',
    );
  });

  test('a message is withheld when its value is one only another scenario registered: the set is the whole run', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('X', 'none'), scenario('Y', 'none')),
      runs: (id, side) => {
        if (id === 'Y') {
          return side === 'before'
            ? {
                outcome: 'fail',
                message: 'the defect shows here',
                denied: [SHARED],
              }
            : reproduced(id, side);
        }
        return side === 'before'
          ? { outcome: 'fail', message: `still shows ${SHARED}` }
          : reproduced(id, side);
      },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    assertMessageWithheld(fake, 'X', 'before', `still shows ${SHARED}`);
    const y = manifestOf(fake).scenarios.find((s) => s.id === 'Y');
    assert.equal(y?.runs.before?.message, 'the defect shows here');
    for (const text of everyOutput(fake, [messageFile('X', 'before')])) {
      assert.equal(
        text.includes(SHARED),
        false,
        'the shared value is in no output',
      );
    }
  });

  test('a problem holding a known value is replaced by the problem marker in run.json and on stderr', async () => {
    // The MP4 tab's name is in its "no tab was opened" problem on each side.
    const tab = `B1-${VALUE}`;
    const fake = fakeRun({
      exports: filesOf({ ...scenario('V', 'video'), tab }),
      runs: (id, side) => ({ ...reproduced(id, side), denied: [VALUE] }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);

    const [entry] = manifestOf(fake).scenarios;
    assert.deepEqual(entry.problems, [WITHHELD_PROBLEM, WITHHELD_PROBLEM]);
    assert.ok(
      fake.err.includes(`qa:run: V: ${WITHHELD_PROBLEM}`),
      'stderr names the withheld problem',
    );
    // Every output: run.json, the printed lines and the local step records
    // (steps/V.json), which hold the declared tab as `[withheld]` (#1554).
    for (const text of everyOutput(fake)) {
      assert.equal(text.includes(VALUE), false, 'the value is in no output');
    }
  });

  test('a Request Transcript holding a known value under a safe key withholds it: the transcript never shows the value', async () => {
    const calls: RecordedCall[] = [
      {
        request: {
          method: 'POST',
          path: '/api/v1/items',
          body: { name: PASSWORD },
        },
        response: { status: 200, body: { message: `saved ${VALUE}` } },
      },
    ];
    const fake = fakeRun({
      exports: filesOf(scenario('X', 'transcript')),
      runs: (id, side) =>
        side === 'before'
          ? { ...reproduced(id, side), calls, denied: [PASSWORD, VALUE] }
          : { observed: 'the fix shows here', calls: [] },
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    const transcript = fake.files.get(`${OUT}/transcripts/X.md`);
    assert.ok(transcript !== undefined, 'the transcript was written');
    assert.match(transcript, /"name": "\[withheld\]"/);
    assert.match(transcript, /"message": "\[withheld\]"/);
    for (const text of everyOutput(fake)) {
      assert.equal(
        text.includes(PASSWORD),
        false,
        'the password is in no output',
      );
      assert.equal(text.includes(VALUE), false, 'the value is in no output');
    }
  });

  test('a refused Request Transcript holding a known value writes no transcript, keeps the raw calls owner-only, and names no value', async () => {
    const UNKNOWN: RecordedCall = {
      request: { method: 'GET', path: '/api/v1/items' },
      response: { status: 200, body: { unknownFieldXyz: VALUE } },
    };
    // The same transcript holds the value under an allow-listed key, so the
    // known-secret path runs beside the refusal, not on its own.
    const ALLOWED: RecordedCall = {
      request: { method: 'POST', path: '/api/v1/items', body: { name: VALUE } },
      response: { status: 200, body: { message: 'ok' } },
    };
    const fake = fakeRun({
      exports: filesOf(scenario('X', 'transcript')),
      runs: () => ({ calls: [UNKNOWN, ALLOWED], denied: [VALUE] }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);

    assert.equal(fake.files.has(`${OUT}/transcripts/X.md`), false);
    const callsFile = `${OUT}/local/X.calls.json`;
    assert.ok(fake.files.has(callsFile), 'the calls were kept locally');
    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(
      entry.files.find(({ path }) => path === callsFile),
      { path: callsFile, place: 'local', uploadEligible: false },
    );
    assert.ok(
      entry.problems.some((problem) =>
        problem.startsWith('the Request Transcript was refused at:'),
      ),
      'the refusal is reported',
    );
    for (const text of everyOutput(fake, [callsFile])) {
      assert.equal(text.includes(VALUE), false, 'the value is in no output');
    }
  });

  test('a non-default tab whose device name holds a known value is kept as local/<id>-<side>-tab<n>.webm, and no path, move or line names the device', async () => {
    const DEVICE = `B-${VALUE}`;
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: (id, side) => ({
        ...reproduced(id, side),
        denied: [VALUE],
        tabVideos: [
          {
            device: DEVICE,
            tab: 'B2',
            path: `${OUT}/.work/${side}/${id}/tab-1.webm`,
            openedAtMs: 1400,
          },
        ],
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(
      entry.files
        .filter(({ path }) => path.includes('-tab'))
        .map(({ path }) => path)
        .sort(),
      [tabLocal('V', 'after', 1), tabLocal('V', 'before', 1)].sort(),
    );
    assert.equal(
      fake.ops.some((op) => op.includes(VALUE)),
      false,
      'no move or removal names the value',
    );
    for (const text of everyOutput(fake)) {
      assert.equal(text.includes(VALUE), false, 'the value is in no output');
    }
  });
});

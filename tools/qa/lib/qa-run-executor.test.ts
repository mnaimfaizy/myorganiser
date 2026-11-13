// Contracts for `runQaRun` (ADR 0147 decisions 1-5 and 7, and 8's start
// refusal), run with a hand-written RunDeps: an in-memory disk, a call log of
// every stack, switch, combine and scenario call in order, and scripted runs.
// No browser, stack, docker or ffmpeg starts here, and the modules that would
// reach one are never imported. The pure rules are in qa-run.test.ts.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { FFMPEG_MISSING_MESSAGE } from './qa-combine-executor.ts';
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
  tabVideos?: { device: string; tab: string; path: string | null }[];
  /** The values the browser reports as denied for the Storyboard; absent when none. */
  denied?: string[];
  /** Each step's caption by call order; a step past the list keeps `step N`. */
  captions?: string[];
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
  combine: (argv: readonly string[]) => { status: number; files: string[] };
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
    combine: () => ({ status: 0, files: [] }),
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
    combine(argv) {
      log.push(`combine ${argv.join(' ')}`);
      return plan.combine(argv);
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
            atMs: 0,
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
  return { deps, log, disk, files, out, err, removed, ops, renders };
}

/** A scenario script; a screen capture also declares its title and expected results. */
const scenario = (id: string, capture: Capture): Scenario => {
  const script: Scenario = { id, capture, run: async () => undefined };
  if (!SCREEN_CAPTURE[capture]) return script;
  return {
    ...script,
    title: `${id} scenario`,
    expected: { before: 'the defect shows', after: 'the fix shows' },
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
  test('a fix video that passes on both sides keeps each side and combines exactly those two files', async () => {
    const fake = fakeRun({ exports: filesOf(scenario('V', 'video')) });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(
      kept(fake),
      sorted([
        RUN_JSON,
        `${OUT}/before/V.webm`,
        `${OUT}/after/V.webm`,
        storyboardPng('V'),
        ...stepFiles('V', 'before', 'after'),
      ]),
    );
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('combine ')),
      [
        `combine --before ${OUT}/before/V.webm --after ${OUT}/after/V.webm --out ${OUT}/combined/V`,
      ],
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
        ...stepFiles('V', 'before', 'after'),
      ]),
    );
    assert.equal(
      kept(fake).some((path) => path.includes('/local/')),
      false,
    );
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
  const combinedAs = (argv: readonly string[]) => ({
    status: 0,
    files: [`${argv[argv.length - 1]}.png`],
  });

  test('a fix screenshot pair is not combined with ffmpeg; its Storyboard is rendered from both sides', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'screenshot')),
      combine: combinedAs,
    });
    await runQaRun(argvFor('fix'), fake.deps);
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('combine ')),
      [],
    );
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('render ')),
      [`render ${OUT}/combined/S.png`],
    );
  });

  test('a combined video file is offered for a PASS and withheld for a FAIL: regression', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('P', 'video'), scenario('R', 'video')),
      runs: (id, side) => {
        if (id === 'P') return side === 'before' ? { outcome: 'fail' } : {};
        return side === 'after' ? { outcome: 'fail' } : {};
      },
      combine: combinedAs,
    });
    await runQaRun(argvFor('fix'), fake.deps);
    const manifest = manifestOf(fake);
    const combinedOf = (id: string) =>
      manifest.scenarios
        .find((entry) => entry.id === id)
        ?.files.find((file) => file.place === 'combined');
    assert.deepEqual(combinedOf('P'), {
      path: `${OUT}/combined/P.png`,
      place: 'combined',
      uploadEligible: true,
    });
    assert.deepEqual(combinedOf('R'), {
      path: `${OUT}/combined/R.png`,
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

  test('a failed combine exits 1 and records the problem in run.json', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('P', 'video')),
      runs: (_id, side) => (side === 'before' ? { outcome: 'fail' } : {}),
      combine: () => ({ status: 1, files: [] }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    const problems = manifestOf(fake).scenarios[0].problems;
    assert.deepEqual(problems, ['combining failed (qa:combine exit 1)']);
    assert.match(fake.err.join('\n'), /combining failed \(qa:combine exit 1\)/);
  });

  test('a feature video that ran After only is not combined', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('S', 'video')),
      combine: combinedAs,
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('combine ')),
      [],
    );
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
        [file]: { id: 'S', capture: 'gif', run: async () => undefined },
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
    test(`${c.name} exits 1, names each side with no step, and makes no combine or render call`, async () => {
      const fake = fakeRun({
        exports: filesOf(scenario('X', c.capture)),
        runs: c.runs,
      });
      const exit = await runQaRun(argvFor(c.changeKind), fake.deps);
      assert.equal(exit, 1);
      const entry = manifestOf(fake).scenarios[0];
      assert.deepEqual(entry.problems, c.zeroSides.map(NO_STEP));
      assert.deepEqual(
        fake.log.filter((line) => /^(combine|render) /.test(line)),
        [],
      );
      assert.equal(
        entry.files.some(({ place }) => place === 'combined'),
        false,
      );
    });
  }

  for (const capture of ['video', 'screenshot'] as const) {
    test(`a ${capture} fix whose Before and After take different step counts exits 1, names both counts, and makes no combine or render call`, async () => {
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
        fake.log.filter((line) => /^(combine|render) /.test(line)),
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

  test('a fix video renders the Storyboard and also runs the qa:combine call, and both are listed', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: reproduced,
      combine: () => ({
        status: 0,
        files: [`${OUT}/combined/V.mp4`, `${OUT}/combined/V.gif`],
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);
    assert.deepEqual(
      fake.renders.map(({ pngPath }) => pngPath),
      [storyboardPng('V')],
    );
    assert.deepEqual(
      fake.log.filter((line) => line.startsWith('combine ')),
      [
        `combine --before ${OUT}/before/V.webm --after ${OUT}/after/V.webm --out ${OUT}/combined/V`,
      ],
    );
    assert.deepEqual(
      manifestOf(fake)
        .scenarios[0].files.filter(({ place }) => place === 'combined')
        .map(({ path }) => path),
      [storyboardPng('V'), `${OUT}/combined/V.mp4`, `${OUT}/combined/V.gif`],
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
  test('a fix video whose Storyboard render rejects gets no qa:combine call and no combined file, and its PNG is removed', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: reproduced,
      render: () => {
        throw new Error('Chromium crashed\nsecond line of the stack');
      },
      combine: () => ({
        status: 0,
        files: [`${OUT}/combined/V.mp4`, `${OUT}/combined/V.gif`],
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);

    const entry = manifestOf(fake).scenarios[0];
    assert.deepEqual(entry.problems, [
      'the Storyboard could not be rendered: Chromium crashed',
    ]);
    assert.equal(
      fake.log.some((line) => line.startsWith('combine ')),
      false,
      'qa:combine is not called',
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

/** A tab's recording as the runner keeps it: under `local/`, numbered per run. */
const tabLocal = (
  id: string,
  side: Side,
  n: number,
  device: string,
  tab: string,
): string => `${OUT}/local/${id}-${side}-tab${n}-${device}-${tab}.webm`;

/** A tab's recording as the browser wrote it, in the side's work directory. */
const tabWork = (id: string, side: Side, device: string, tab: string): string =>
  `${OUT}/.work/${side}/${id}/${device}-${tab}.webm`;

describe('a tab other than the default is recorded locally and never offered', () => {
  const combinedWebm = (argv: readonly string[]) => ({
    status: 0,
    files: [`${argv[argv.length - 1]}.webm`],
  });

  test('every other tab is listed local and never offered, even when the combined file of a passing video is offered', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: (id, side) => ({
        ...reproduced(id, side),
        tabVideos: [
          { device: 'B', tab: 'B1', path: tabWork(id, side, 'B', 'B1') },
          { device: 'B', tab: 'B2', path: tabWork(id, side, 'B', 'B2') },
        ],
      }),
      combine: combinedWebm,
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 0);

    const [entry] = manifestOf(fake).scenarios;
    assert.equal(entry?.result, 'PASS');
    assert.deepEqual(
      entry?.files.find(
        (file) => file.place === 'combined' && file.path.endsWith('.webm'),
      ),
      {
        path: `${OUT}/combined/V.webm`,
        place: 'combined',
        uploadEligible: true,
      },
    );
    const tabFiles = entry?.files.filter((file) => file.path.includes('-tab'));
    const expected = [
      tabLocal('V', 'before', 1, 'B', 'B1'),
      tabLocal('V', 'before', 2, 'B', 'B2'),
      tabLocal('V', 'after', 1, 'B', 'B1'),
      tabLocal('V', 'after', 2, 'B', 'B2'),
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
          { device: 'B', tab: 'B1', path: tabWork('N', 'after', 'B', 'B1') },
          { device: 'B', tab: 'B2', path: null },
        ],
      }),
    });
    const exit = await runQaRun(argvFor('feature'), fake.deps);
    assert.equal(exit, 1);

    const [entry] = manifestOf(fake).scenarios;
    assert.deepEqual(entry?.problems, [
      'after: no video was recorded for device B, tab B2',
    ]);
    assert.match(
      fake.err.join('\n'),
      /qa:run: N: after: no video was recorded for device B, tab B2/,
    );
    assert.deepEqual(
      entry?.files.filter((file) => file.path.includes('-tab')),
      [
        {
          path: tabLocal('N', 'after', 1, 'B', 'B1'),
          place: 'local',
          uploadEligible: false,
        },
      ],
      'the tab with a recording is still kept, and the missing one is not',
    );
    assert.ok(kept(fake).includes(tabLocal('N', 'after', 1, 'B', 'B1')));
  });

  test('a run with no other tab keeps only what its line asks for, plus its step records, and combines the same two files', async () => {
    const fake = fakeRun({
      exports: filesOf(scenario('V', 'video')),
      runs: reproduced,
      combine: combinedWebm,
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
      fake.log.filter((line) => line.startsWith('combine ')),
      [
        `combine --before ${OUT}/before/V.webm --after ${OUT}/after/V.webm --out ${OUT}/combined/V`,
      ],
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

  /** Every text the run writes or prints, which a denied value must not reach. */
  function everyOutput(fake: ReturnType<typeof fakeRun>): string[] {
    return [...fake.files.values(), ...fake.out, ...fake.err];
  }

  function problemsOf(fake: ReturnType<typeof fakeRun>, id: string): string[] {
    const entry = manifestOf(fake).scenarios.find((s) => s.id === id);
    assert.ok(entry !== undefined, `${id} is in run.json`);
    return entry.problems;
  }

  test('a caption holding a denied value refuses a screenshot: no PNG, the step records hold [withheld] and name the field, and run.json withholds the message', async () => {
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
    assert.equal(entry.runs.before?.message, '[withheld]');
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

  test('a video whose after observed holds a denied value gets no PNG and no qa:combine call', async () => {
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
      combine: () => ({
        status: 0,
        files: [`${OUT}/combined/V.mp4`, `${OUT}/combined/V.gif`],
      }),
    });
    const exit = await runQaRun(argvFor('fix'), fake.deps);
    assert.equal(exit, 1);
    assert.deepEqual(fake.renders, [], 'no Storyboard is rendered');
    assert.equal(
      fake.log.some((line) => line.startsWith('combine ')),
      false,
      'qa:combine is not called',
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

  test('a failure message holding a denied value is named, withheld from run.json, and kept out of every output', async () => {
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
    assert.equal(entry.runs.after?.message, '[withheld]');
    for (const text of everyOutput(fake)) {
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

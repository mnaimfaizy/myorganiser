/**
 * Shared fixture builders for the PR CI duration Contract Suites (PRD #1387,
 * issue #1393). This is a helper module, not a suite: the suites beside it
 * import these builders so every one of them measures the same fixture
 * shapes, instead of two copies that drift apart.
 *
 * Every timestamp is an offset in seconds from one fixed instant, so a
 * fixture reads as the durations it describes.
 */
import {
  summarizeCiDuration,
  type CiDurationGather,
  type GatheredJob,
  type GatheredRun,
  type GatheredStep,
} from './ci-duration.ts';

// Frozen: every fixture run that uses one of these shares the reference, so
// a test that mutated one would quietly change the sample of every other.
export const ROOTS = Object.freeze(['apps/web', 'libs/a', 'libs/b']);
export const CHANGED_SINGLE = Object.freeze(['libs/a/src/index.ts']);
export const CHANGED_OTHER = Object.freeze([
  'libs/a/src/index.ts',
  'libs/b/src/index.ts',
]);

const T0 = Date.parse('2026-10-01T00:00:00Z');

/** Seconds after the fixed instant, as an Actions timestamp. */
export const at = (seconds: number): string =>
  new Date(T0 + seconds * 1000).toISOString();

/**
 * One job. `null` for either bound leaves that timestamp absent: a start with
 * no completion is a job still running, which is how an unmeasurable wait is
 * built. `conclusion` defaults to `success`; pass another to build a job that
 * was cancelled or failed.
 */
export const job = (
  name: string,
  start: number | null,
  end: number | null,
  steps: GatheredStep[] = [],
  conclusion: string | null = 'success',
): GatheredJob => ({
  name,
  startedAt: start === null ? null : at(start),
  completedAt: end === null ? null : at(end),
  conclusion,
  steps,
});

export const step = (
  name: string,
  start: number,
  end: number,
): GatheredStep => ({
  name,
  startedAt: at(start),
  completedAt: at(end),
  conclusion: 'success',
});

/**
 * A pull request run on a branch `main` had not moved past, touching one
 * project. `conclusion` is the run's own result: pass `'cancelled'` for a run
 * superseded by a push, or `null` for one still in progress.
 */
export const prRun = (overrides: Partial<GatheredRun> = {}): GatheredRun => ({
  runId: 1,
  headBranch: 'feat/x',
  headSha: 'a'.repeat(40),
  createdAt: at(0),
  conclusion: 'success',
  event: 'pull_request',
  changedFiles: CHANGED_SINGLE,
  filesTruncated: false,
  behindBy: 0,
  jobs: [job('Lint', 0, 120)],
  ...overrides,
});

export const repeat = <T>(count: number, make: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, index) => make(index));

export const gather = (
  runs: GatheredRun[],
  evidence: Record<string, string> = {},
): CiDurationGather => ({
  window: { since: '2026-10-12', until: '2026-10-26' },
  workflow: 'ci.yml',
  projectRoots: ROOTS,
  evidence,
  runs,
});

/** The whole measurement, over a fixture gather. */
export const measure = (
  runs: GatheredRun[],
  evidence?: Record<string, string>,
) => summarizeCiDuration(gather(runs, evidence));

/** A fast Single-Library run: one job, two minutes, fresh, Test not last. */
export const fastRun = (): GatheredRun =>
  prRun({ jobs: [job('Lint', 0, 120)] });

/**
 * A run that trips all five signals on its own once there is enough data:
 * Single-Library, twenty minutes, stale, Test last with a 900s cacheable step,
 * and an E2E lane of ten minutes.
 */
export const hotRun = (): GatheredRun =>
  prRun({
    behindBy: 5,
    jobs: [
      job('Test', 0, 1200, [step('Test affected projects', 0, 900)]),
      job('E2E Report', 0, 600),
    ],
  });

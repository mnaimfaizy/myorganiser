/**
 * How long a pull request waits for CI, and the five signals that say the
 * answer is drifting (PRD #1387, issue #1393).
 *
 * The target is one number: a **Single-Library Pull Request** — one whose
 * every changed file sits under a single Nx project's root — finishes every
 * check its author waits on in five minutes at the median. This module is
 * the arithmetic behind that sentence, and nothing else: every input arrives
 * as a `CiDurationGather`, which `tools/scripts/ci/measure-ci-duration.ts`
 * reads from the Actions API and git. Keeping the two apart is what lets a
 * gather be saved to a file and re-measured, and what lets the Contract
 * Suite assert percentiles and signals over fixtures rather than over
 * whatever the last fortnight of `main` happened to look like.
 *
 * **Durations come from job and step timestamps**, which is the method the
 * baseline used (issue #1374), not from a run's own `createdAt`: a run spends
 * time queued before any job starts, and the author is waiting on the checks
 * rather than on the queue. A run's duration is therefore the span from the
 * earliest job start to the latest job completion, and a lane's duration is
 * the same span over that lane's jobs. A job with no timestamps at all —
 * skipped, or never reached — is not in the span, because it cost nobody
 * anything.
 *
 * **Percentiles are linearly interpolated** (the R-7 / `numpy` default): p50
 * over an even sample is the mean of the two middle values rather than
 * whichever side the implementation happened to round to. The baseline was
 * computed that way, so reproducing its figures means computing it that way
 * here.
 *
 * **What population each figure is over** is a decision, not an accident:
 *
 * - `all`, `singleLibrary` and `other` run durations are over every pull
 *   request run in the window, split by classification. Both sides are
 *   reported because a PR that touches a root file is outside the target and
 *   must not be able to hide inside it, in either direction.
 * - the cacheable-step, E2E-lane and last-finisher figures are over
 *   **Single-Library** runs only. Each of them feeds a signal about why the
 *   target is missed, and the target is about that population.
 * - the stale-branch share is over every readable pull request run, because
 *   how far a branch has fallen behind `main` has nothing to do with how
 *   many projects it touches.
 *
 * **Not enough data is an answer.** Under `MIN_SINGLE_LIBRARY_RUNS` runs in
 * the window, the verdict is `not-enough-data` and no signal is evaluated: a
 * quiet week would otherwise read as either a triumph or an alarm on a
 * sample of three.
 *
 * Run the tests with: node --test tools/scripts/lib/ci-duration.test.ts
 */

/** The target itself: a Single-Library Pull Request's median wait. */
export const TARGET_P50_SECONDS = 5 * 60;

/** Where the cacheable Nx steps stop looking like a cache hit. */
export const CACHEABLE_STEP_P50_SECONDS = 60;

/** Share of runs whose branch had fallen behind `main` before they started. */
export const STALE_BRANCH_SHARE = 0.1;

/** The blocking E2E lane's own median (ADR 0050). */
export const E2E_LANE_P50_SECONDS = 5 * 60;

/** Below this many Single-Library runs, the window measured nothing. */
export const MIN_SINGLE_LIBRARY_RUNS = 10;

/** Share of runs above which one job is "the median last finisher". */
export const LAST_FINISHER_MEDIAN_SHARE = 0.5;

/** The default window, in days. */
export const DEFAULT_WINDOW_DAYS = 14;

/** The workflow whose runs are the pull request's CI. */
export const CI_WORKFLOW = 'ci.yml';

/** The job every author waits on last, when the job layout is the problem. */
export const TEST_JOB_NAME = 'Test';

/**
 * The blocking E2E lane's jobs, by name: `E2E Chromium (shard 1/3)`,
 * `E2E Report`, `E2E live logout`. Anchored and word-bounded so a future
 * `E2E`-prefixed job joins the lane and a job merely mentioning E2E does
 * not.
 */
export const E2E_LANE_JOB = /^E2E(?:\s|$)/;

/**
 * The CI steps that run a cacheable Nx target, by their exact step name in
 * `.github/workflows/ci.yml`.
 *
 * The Actions API reports a step's name and its timestamps, never the command
 * it ran, so the only way to ask "how long did the cacheable work take" is to
 * name the steps. That makes this list drift-prone, which is why the Contract
 * Suite asserts it in **both** directions against `ci.yml`: a name here must
 * be a step there that reaches `nx`, and a step there that reaches `nx` must
 * be named here. A step reaches `nx` either directly or through a
 * `yarn <script>` alias that `package.json` resolves to one — `Build
 * Storybook` runs `yarn build-storybook`, which is `nx build-storybook
 * web-ui`, and the one-direction check that only read `run:` text for a
 * literal `nx` could never have seen it.
 */
export const CACHEABLE_NX_STEPS = [
  'Lint affected projects',
  'Lint every project',
  'Test affected projects',
  'Test every project',
  'Build frontend for E2E',
  'Run E2E shard',
  'Build backend',
  'Build frontend',
  'Build backend for live logout',
  'Run live logout spec',
  'Run live account deletion spec',
  'Build mobile web target',
  'Build Storybook',
] as const;

/**
 * The ci.yml steps that reach `nx` and are deliberately **not** cacheable-step
 * work, each with the reason.
 *
 * The pair of lists is the whole decision: `CACHEABLE_NX_STEPS` is what the
 * `cacheable-steps-p50` signal measures, and this is what reaching `nx` is
 * not enough to earn. Both halves live here rather than one here and one in
 * the suite, because "is this step's wall clock a cache-hit wait" is a fact
 * the measurement depends on, and a reader of the signal should see the
 * answer for every step, not only the yes.
 *
 * Each of these runs an Nx command whose cost is not a cached build: two
 * read the project graph, one generates a client, one is Prettier over the
 * whole tree, and two regenerate an artifact in order to diff it. Measuring
 * them as cache hits would dilute the p50 the caching decision (#1382) is
 * read off.
 *
 * The Contract Suite asserts the two lists **partition** ci.yml's
 * `nx`-reaching steps: a new one fails until somebody classifies it, and an
 * entry here that no longer reaches `nx`, or that is also cacheable, fails
 * as stale.
 */
export const NOT_CACHEABLE_NX_STEPS = [
  // `nx show projects --affected`: the project graph, not a build.
  'Compute affected projects',
  // `nx graph --file`: the project graph again, for the gates that read it.
  'Build the Nx project graph',
  // `nx run backend:generate-types`: codegen the build then depends on.
  'Generate Prisma client',
  // Prettier over the whole tree, which caches nothing per project.
  'Check formatting',
  // Regenerates the spec and client in order to diff them: the work is the
  // regeneration, and a cache hit would defeat the drift check.
  'Check OpenAPI spec and generated client are in sync',
  // Regenerates the token outputs in order to diff them, same as above.
  'Check design token outputs are in sync',
] as const;

/** One step of one job, as the Actions API jobs endpoint returns it. */
export interface GatheredStep {
  name: string;
  startedAt?: string | null;
  completedAt?: string | null;
  conclusion?: string | null;
}

/** One job of one run, as the Actions API jobs endpoint returns it. */
export interface GatheredJob {
  name: string;
  startedAt?: string | null;
  completedAt?: string | null;
  conclusion?: string | null;
  steps?: readonly GatheredStep[];
}

/**
 * One pull request run of CI, with everything the measurement needs about
 * the branch it ran on.
 *
 * `changedFiles` and `behindBy` are reads that can fail — a deleted branch,
 * a compare the API truncated — and a failed read is `null` rather than a
 * guess, so it lands in the unclassified or unreadable count and is
 * reported there.
 */
export interface GatheredRun {
  runId: number;
  headBranch: string;
  headSha: string;
  /** When the run was created, which is what dates it in the window. */
  createdAt: string;
  conclusion?: string | null;
  event?: string;
  /** Files changed against the merge base, or null when unreadable. */
  changedFiles?: readonly string[] | null;
  /** True when the compare returned more files than it would list. */
  filesTruncated?: boolean;
  /**
   * Commits on `main` that the head did not have when the run started, or
   * null when the comparison could not be made.
   */
  behindBy?: number | null;
  jobs?: readonly GatheredJob[];
}

/** Everything the pure measurement needs, and nothing it cannot be given. */
export interface CiDurationGather {
  window: { since: string; until: string };
  workflow: string;
  /** Every Nx project root, repo-relative and without a trailing slash. */
  projectRoots: readonly string[];
  /** What could not be read, named rather than assumed. */
  evidence: Record<string, string>;
  runs: readonly GatheredRun[];
}

/** The five signals, in the order the report prints them. */
export const SIGNAL_IDS = [
  'single-library-p50',
  'cacheable-steps-p50',
  'stale-branch-share',
  'e2e-lane-p50',
  'test-last-finisher',
] as const;

export type SignalId = (typeof SIGNAL_IDS)[number];

/** What one signal is, and which recorded decision answers it. */
export interface SignalDefinition {
  /** What has happened, as the report's heading for it. */
  title: string;
  /** The threshold, in the words the report uses. */
  threshold: string;
  /** The issue holding the decision to reopen. */
  decision: number;
  /** That issue's title, so the report names it rather than only linking. */
  decisionTitle: string;
}

/**
 * One table, pinned to `SignalId`, so a sixth signal is a compile error here
 * rather than a signal the report silently never prints (ADR 0053).
 *
 * The first signal is the target itself and has no single decision behind it,
 * so it names the PRD that set the target. The other four each name the
 * closed ticket of [Wayfinder #1373] that recorded the choice now in doubt.
 */
export const SIGNALS = {
  'single-library-p50': {
    title: 'A Single-Library Pull Request waits longer than five minutes',
    threshold: `Single-Library p50 > ${TARGET_P50_SECONDS / 60} min`,
    decision: 1387,
    decisionTitle: 'the five-minute target itself (PRD)',
  },
  'cacheable-steps-p50': {
    title: 'The cacheable Nx steps are not behaving like cache hits',
    threshold: `cacheable Nx step p50 > ${CACHEABLE_STEP_P50_SECONDS}s`,
    decision: 1382,
    decisionTitle: 'Choose how Nx results are shared across CI runs',
  },
  'stale-branch-share': {
    title: 'Too many runs start from a branch that is behind `main`',
    threshold: `stale-branch runs > ${STALE_BRANCH_SHARE * 100}%`,
    decision: 1376,
    decisionTitle: 'Choose how a PR stays mergeable when main moves',
  },
  'e2e-lane-p50': {
    title: 'The E2E lane alone is over five minutes',
    threshold: `E2E lane p50 > ${E2E_LANE_P50_SECONDS / 60} min`,
    decision: 1381,
    decisionTitle: 'Choose the E2E lane shape on a PR',
  },
  'test-last-finisher': {
    title: 'Test is the job every other check waits for',
    threshold: `${TEST_JOB_NAME} finishes last in more than ${LAST_FINISHER_MEDIAN_SHARE * 100}% of runs`,
    decision: 1385,
    decisionTitle: 'Choose the PR job layout',
  },
} as const satisfies Record<SignalId, SignalDefinition>;

/** A signal that tripped, with the figure that tripped it. */
export interface TrippedSignal extends SignalDefinition {
  id: SignalId;
  /** The measured figure, already formatted for a reader. */
  measured: string;
}

/**
 * `p`th percentile of `values` by linear interpolation between the two
 * neighbouring order statistics (R-7). `null` for an empty sample, because
 * a percentile of nothing is not zero.
 */
export function percentile(
  values: readonly number[],
  p: number,
): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (rank - lower) * (sorted[upper] - sorted[lower]);
}

/** A pair of percentiles over one sample, which is how every figure reports. */
export interface Percentiles {
  p50: number | null;
  p90: number | null;
  /** How many values the pair was computed over. */
  count: number;
}

export function percentiles(values: readonly number[]): Percentiles {
  return {
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    count: values.filter((value) => Number.isFinite(value)).length,
  };
}

/**
 * Seconds between two Actions timestamps, or `null` when either is missing,
 * unparseable, or the pair runs backwards. A negative span is a read that
 * failed, never a duration.
 */
export function durationSeconds(
  startedAt?: string | null,
  completedAt?: string | null,
): number | null {
  if (!startedAt || !completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return (end - start) / 1000;
}

/**
 * Whether a job or step did not run, by its own `conclusion`.
 *
 * Read rather than inferred from the timestamps, because the Actions API
 * does not promise a skipped job or step has none: it reports it `completed`
 * with conclusion `skipped`, and a start equal to its completion is a
 * duration of zero rather than an absent read. Zero is the wrong answer in
 * both places it would land — a skipped step would enter the cacheable-step
 * sample as a cache hit that took no time, and a skipped lane would enter
 * the E2E-lane sample as a lane nobody waited for, each pulling its p50
 * toward zero and keeping its signal from tripping. `ci.yml` makes both
 * routine on the runs this measurement reads: `Lint every project` and
 * `Test every project` are skipped on every pull request, and the whole E2E
 * lane is skipped on a pull request that does not affect `web-e2e`.
 *
 * A job or step that never reached a conclusion at all is not skipped — it
 * is still running, which the timestamp read already reports as unmeasurable.
 */
export function isSkipped(conclusion?: string | null): boolean {
  return conclusion === 'skipped';
}

/**
 * Wall-clock seconds a set of jobs occupied: earliest start to latest
 * completion. This, not the sum of the jobs, is what the author waited —
 * the jobs run in parallel. A skipped job is not in the span, because it
 * cost nobody anything.
 */
export function spanSeconds(
  jobs: readonly GatheredJob[] | null | undefined,
): number | null {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const job of jobs ?? []) {
    if (isSkipped(job.conclusion)) continue;
    const start = job.startedAt ? Date.parse(job.startedAt) : Number.NaN;
    const end = job.completedAt ? Date.parse(job.completedAt) : Number.NaN;
    if (Number.isFinite(start)) starts.push(start);
    if (Number.isFinite(end)) ends.push(end);
  }
  if (starts.length === 0 || ends.length === 0) return null;
  const span = Math.max(...ends) - Math.min(...starts);
  return span < 0 ? null : span / 1000;
}

/** Every check the author waited on, as one wall-clock duration. */
export function runSeconds(run: GatheredRun): number | null {
  return spanSeconds(run.jobs);
}

/** True for a job of the blocking E2E lane. */
export function isE2eLaneJob(name: string): boolean {
  return E2E_LANE_JOB.test(name);
}

/** The E2E lane's own wall clock within one run. */
export function e2eLaneSeconds(run: GatheredRun): number | null {
  return spanSeconds((run.jobs ?? []).filter((job) => isE2eLaneJob(job.name)));
}

/**
 * The project root a changed file sits under, or `null` when no project
 * claims it — a root file such as `package.json`, or a path under a
 * directory that is not a project.
 *
 * The longest matching root wins, because project roots nest:
 * `libs/web/pages/tasks` is a project and `libs/web/pages` is not, so a file
 * in the former belongs to the former.
 */
export function projectOfFile(
  file: string,
  roots: readonly string[],
): string | null {
  let best: string | null = null;
  for (const root of roots) {
    // A project rooted at the repository root would claim every file and
    // make every pull request Single-Library. There is no such project, and
    // if one appears it must not silently redefine the term.
    if (!root || root === '.') continue;
    if (file === root || file.startsWith(`${root}/`)) {
      if (best === null || root.length > best.length) best = root;
    }
  }
  return best;
}

/**
 * The conclusions of a run that represent a wait somebody actually had.
 *
 * `cancelled` is the one that matters: `ci.yml` cancels a pull request's run
 * in flight on the next push, so a branch pushed four times leaves three
 * runs whose span ends at the cancellation rather than at a result. Counting
 * those as waits reads the p50 the five-minute target is judged on well
 * below any wait an author had. A run still in progress (`null`) is the same
 * defect with the clock still running. `timed_out` is kept: the author waited
 * the whole timeout, which is the longest wait of all.
 */
export const MEASURABLE_CONCLUSIONS = [
  'success',
  'failure',
  'timed_out',
] as const;

/** Whether this run's span is a wait somebody had, rather than a truncation. */
export function isMeasurableRun(run: GatheredRun): boolean {
  return (MEASURABLE_CONCLUSIONS as readonly string[]).includes(
    run.conclusion ?? '',
  );
}

/** What a run's changed files make it. */
export type RunClass = 'single-library' | 'other' | 'unclassified';

/**
 * Classifies one run.
 *
 * `single-library` needs every changed file under one project root. A file
 * no project claims, or files under two roots, makes it `other` — reported,
 * and outside the target. Files that could not be read at all, or a compare
 * the API truncated while everything read so far pointed at one project,
 * makes it `unclassified`: the window says nothing about that run rather
 * than counting it as the answer that would flatter the measurement.
 */
export function classifyRun(
  run: GatheredRun,
  roots: readonly string[],
): RunClass {
  const files = run.changedFiles;
  if (files === null || files === undefined) return 'unclassified';
  if (files.length === 0) return 'other';
  const projects = new Set<string>();
  for (const file of files) {
    const project = projectOfFile(file, roots);
    if (project === null) return 'other';
    projects.add(project);
  }
  if (projects.size > 1) return 'other';
  return run.filesTruncated ? 'unclassified' : 'single-library';
}

/**
 * Whether the run started from a branch `main` had already moved past, or
 * `null` when the comparison could not be made.
 */
export function isStaleBranchRun(run: GatheredRun): boolean | null {
  const behind = run.behindBy;
  if (behind === null || behind === undefined || !Number.isFinite(behind)) {
    return null;
  }
  return behind > 0;
}

/**
 * Durations of the cacheable Nx steps of one run, in seconds. A step the run
 * skipped is not one of them, and neither is any step of a skipped job.
 */
export function cacheableStepSeconds(run: GatheredRun): number[] {
  const cacheable = new Set<string>(CACHEABLE_NX_STEPS);
  const seconds: number[] = [];
  for (const job of run.jobs ?? []) {
    if (isSkipped(job.conclusion)) continue;
    for (const step of job.steps ?? []) {
      if (!cacheable.has(step.name)) continue;
      if (isSkipped(step.conclusion)) continue;
      const duration = durationSeconds(step.startedAt, step.completedAt);
      if (duration !== null) seconds.push(duration);
    }
  }
  return seconds;
}

/**
 * The job that finished last in one run, or `null` when no job of it has a
 * completion time. A tie is broken by name so the answer is stable rather
 * than dependent on the order the API listed the jobs.
 *
 * A skipped job cannot be the last finisher: it is reported `completed` with
 * a timestamp like any other, so without this it could be named the job every
 * other check waited for while having run nothing — and the share of runs one
 * job finishes last is what the `test-last-finisher` signal reads.
 */
export function lastFinisher(run: GatheredRun): string | null {
  let bestName: string | null = null;
  let bestEnd = Number.NEGATIVE_INFINITY;
  for (const job of run.jobs ?? []) {
    if (isSkipped(job.conclusion)) continue;
    const end = job.completedAt ? Date.parse(job.completedAt) : Number.NaN;
    if (!Number.isFinite(end)) continue;
    if (
      end > bestEnd ||
      (end === bestEnd && bestName !== null && job.name < bestName)
    ) {
      bestEnd = end;
      bestName = job.name;
    }
  }
  return bestName;
}

/** How often one job was the last to finish. */
export interface LastFinisherShare {
  name: string;
  runs: number;
  share: number;
}

/**
 * The share of runs each job finished last, most frequent first; ties by
 * name, so the table reads the same twice.
 */
export function lastFinisherShares(
  runs: readonly GatheredRun[],
): LastFinisherShare[] {
  const counts = new Map<string, number>();
  let measured = 0;
  for (const run of runs) {
    const name = lastFinisher(run);
    if (name === null) continue;
    measured += 1;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({
      name,
      runs: count,
      share: measured === 0 ? 0 : count / measured,
    }))
    .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));
}

/** The stale-branch share, and what it was readable over. */
export interface StaleBranchShare {
  /** Stale runs over readable runs, or null when none was readable. */
  share: number | null;
  stale: number;
  readable: number;
  unreadable: number;
}

export function staleBranchShare(
  runs: readonly GatheredRun[],
): StaleBranchShare {
  let stale = 0;
  let readable = 0;
  let unreadable = 0;
  for (const run of runs) {
    const verdict = isStaleBranchRun(run);
    if (verdict === null) {
      unreadable += 1;
      continue;
    }
    readable += 1;
    if (verdict) stale += 1;
  }
  return {
    share: readable === 0 ? null : stale / readable,
    stale,
    readable,
    unreadable,
  };
}

/** What the window as a whole says. */
export type CiDurationVerdict =
  | 'not-enough-data'
  | 'within-target'
  | 'over-target';

/** The whole measurement, as `summarizeCiDuration` returns it. */
export type CiDurationSummary = ReturnType<typeof summarizeCiDuration>;

/**
 * The measurement. Pure: everything it knows arrives in `gather`.
 */
export function summarizeCiDuration(gather: CiDurationGather) {
  const { window, workflow, projectRoots, evidence, runs } = gather;

  // Cancelled and still-running runs are dropped before anything is counted,
  // so no figure here is an average over truncated waits. They are reported
  // as `sample.unfinished` rather than silently discarded.
  const measured = runs.filter(isMeasurableRun);
  const unfinished = runs.length - measured.length;

  const classified = measured.map((run) => ({
    run,
    runClass: classifyRun(run, projectRoots),
  }));
  const singleLibrary = classified
    .filter((entry) => entry.runClass === 'single-library')
    .map((entry) => entry.run);
  const other = classified
    .filter((entry) => entry.runClass === 'other')
    .map((entry) => entry.run);
  const unclassified = classified.filter(
    (entry) => entry.runClass === 'unclassified',
  ).length;

  const durations = (sample: readonly GatheredRun[]) =>
    percentiles(
      sample
        .map(runSeconds)
        .filter((seconds): seconds is number => seconds !== null),
    );

  const all = durations(measured);
  const singleLibraryDurations = durations(singleLibrary);
  const otherDurations = durations(other);

  const cacheableSteps = percentiles(
    singleLibrary.flatMap(cacheableStepSeconds),
  );
  const e2eLane = percentiles(
    singleLibrary
      .map(e2eLaneSeconds)
      .filter((seconds): seconds is number => seconds !== null),
  );
  const stale = staleBranchShare(measured);
  const finishers = lastFinisherShares(singleLibrary);
  const testShare =
    finishers.find((entry) => entry.name === TEST_JOB_NAME)?.share ?? 0;

  // The cutoff counts Single-Library runs **whose wait could be measured**,
  // not Single-Library runs. Ten runs that were classified but whose jobs
  // carry no completion time give a null p50; every signal guard is written
  // `p50 !== null && p50 > threshold`, so none of them trips, and a cutoff
  // counting the classification alone would then call that window
  // `within-target` and let the watch record a recovery on a window that
  // measured nothing.
  const enoughData = singleLibraryDurations.count >= MIN_SINGLE_LIBRARY_RUNS;

  const signals: TrippedSignal[] = [];
  const trip = (id: SignalId, measured: string) =>
    signals.push({ id, ...SIGNALS[id], measured });

  // No signal is evaluated without enough data: every one of them is a
  // percentile or a share, and a share of four runs is an anecdote.
  if (enoughData) {
    if (
      singleLibraryDurations.p50 !== null &&
      singleLibraryDurations.p50 > TARGET_P50_SECONDS
    ) {
      trip('single-library-p50', formatSeconds(singleLibraryDurations.p50));
    }
    if (
      cacheableSteps.p50 !== null &&
      cacheableSteps.p50 > CACHEABLE_STEP_P50_SECONDS
    ) {
      trip('cacheable-steps-p50', formatSeconds(cacheableSteps.p50));
    }
    if (stale.share !== null && stale.share > STALE_BRANCH_SHARE) {
      trip(
        'stale-branch-share',
        `${formatShare(stale.share)} of ${stale.readable} readable run(s)`,
      );
    }
    if (e2eLane.p50 !== null && e2eLane.p50 > E2E_LANE_P50_SECONDS) {
      trip('e2e-lane-p50', formatSeconds(e2eLane.p50));
    }
    if (testShare > LAST_FINISHER_MEDIAN_SHARE) {
      trip(
        'test-last-finisher',
        `${formatShare(testShare)} of Single-Library runs`,
      );
    }
  }

  const verdict: CiDurationVerdict = !enoughData
    ? 'not-enough-data'
    : signals.length > 0
      ? 'over-target'
      : 'within-target';

  return {
    window,
    workflow,
    evidence,
    sample: {
      runs: runs.length,
      measured: measured.length,
      unfinished,
      singleLibrary: singleLibrary.length,
      other: other.length,
      unclassified,
    },
    durations: {
      all,
      singleLibrary: singleLibraryDurations,
      other: otherDurations,
    },
    cacheableSteps,
    e2eLane,
    staleBranch: stale,
    lastFinishers: finishers,
    testLastFinisherShare: testShare,
    thresholds: {
      targetP50Seconds: TARGET_P50_SECONDS,
      cacheableStepP50Seconds: CACHEABLE_STEP_P50_SECONDS,
      staleBranchShare: STALE_BRANCH_SHARE,
      e2eLaneP50Seconds: E2E_LANE_P50_SECONDS,
      minSingleLibraryRuns: MIN_SINGLE_LIBRARY_RUNS,
      lastFinisherMedianShare: LAST_FINISHER_MEDIAN_SHARE,
    },
    enoughData,
    signals,
    verdict,
  };
}

/** `m:ss` for a duration a reader compares against a five-minute target. */
export function formatSeconds(seconds: number | null): string {
  if (seconds === null) return 'not measurable';
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}m ${String(whole % 60).padStart(2, '0')}s`;
}

/** A share as a percentage with one decimal, or `not measurable`. */
export function formatShare(share: number | null): string {
  return share === null ? 'not measurable' : `${(100 * share).toFixed(1)}%`;
}

/**
 * One tripped signal, as the single line both this report and the watch
 * issue print it. Exported because the issue is where a person reads it: two
 * copies of this sentence drift, and the issue would then print one wording
 * above an embedded measurement printing the other.
 */
export function signalLine(signal: TrippedSignal): string {
  return (
    `- **${signal.title}** — ${signal.threshold}, measured ${signal.measured}. ` +
    `Reopen #${signal.decision} (${signal.decisionTitle}).`
  );
}

/** Why a window measured nothing, in the one sentence that says it. */
export function notEnoughDataSentence(summary: CiDurationSummary): string {
  return (
    `Not enough data: ${summary.durations.singleLibrary.count} Single-Library run(s) with a ` +
    `measurable wait over ${summary.window.since} → ${summary.window.until}, fewer than the ` +
    `${MIN_SINGLE_LIBRARY_RUNS} this measurement needs. No signal was evaluated.`
  );
}

/**
 * The Single-Library figure against the target, as both reports open on it.
 */
export function targetSentence(summary: CiDurationSummary): string {
  return (
    `Single-Library Pull Request p50: ${formatSeconds(summary.durations.singleLibrary.p50)} ` +
    `(p90 ${formatSeconds(summary.durations.singleLibrary.p90)}) over ` +
    `${summary.durations.singleLibrary.count} measurable run(s), against a ` +
    `${formatSeconds(summary.thresholds.targetP50Seconds)} target.`
  );
}

const percentilesRow = (label: string, pair: Percentiles): string =>
  `| ${label} | ${formatSeconds(pair.p50)} | ${formatSeconds(pair.p90)} | ${pair.count} |`;

/**
 * The report, as Markdown. The same text goes to stdout, to `--out`, and
 * into the watch issue, so a reader comparing the issue with a local run is
 * comparing the same sentences.
 */
export function renderCiDurationMeasurement(
  summary: CiDurationSummary,
): string {
  const lines: string[] = [
    '# PR CI duration',
    '',
    `Window: ${summary.window.since} → ${summary.window.until} (\`${summary.workflow}\`, \`pull_request\` runs).`,
    '',
    `Sample: ${summary.sample.runs} run(s), ${summary.sample.measured} of them finished — ` +
      `${summary.sample.singleLibrary} Single-Library, ${summary.sample.other} other, ` +
      `${summary.sample.unclassified} unclassified. ` +
      `${summary.sample.unfinished} cancelled or still running, which no figure here counts.`,
    '',
    '## Wait per run',
    '',
    '| Population | p50 | p90 | runs |',
    '| --- | --- | --- | --- |',
    percentilesRow(
      'Single-Library Pull Requests',
      summary.durations.singleLibrary,
    ),
    percentilesRow('Other pull requests', summary.durations.other),
    percentilesRow('All pull requests', summary.durations.all),
    '',
    '## The signals',
    '',
    '| Signal | Threshold | Measured | Tripped |',
    '| --- | --- | --- | --- |',
  ];

  const measuredBySignal: Record<SignalId, string> = {
    'single-library-p50': formatSeconds(summary.durations.singleLibrary.p50),
    'cacheable-steps-p50': formatSeconds(summary.cacheableSteps.p50),
    'stale-branch-share': formatShare(summary.staleBranch.share),
    'e2e-lane-p50': formatSeconds(summary.e2eLane.p50),
    // A share over no readable run is not 0%, it is unknown.
    'test-last-finisher':
      summary.lastFinishers.length === 0
        ? formatShare(null)
        : formatShare(summary.testLastFinisherShare),
  };
  const tripped = new Set(summary.signals.map((signal) => signal.id));
  for (const id of SIGNAL_IDS) {
    const mark = !summary.enoughData ? '—' : tripped.has(id) ? 'yes' : 'no';
    lines.push(
      `| ${SIGNALS[id].title} | ${SIGNALS[id].threshold} | ${measuredBySignal[id]} | ${mark} |`,
    );
  }

  lines.push(
    '',
    '## Who finishes last',
    '',
    'Over Single-Library runs, which is the population the target is about.',
    '',
  );
  if (summary.lastFinishers.length === 0) {
    lines.push('No Single-Library run had a readable job completion time.');
  } else {
    lines.push('| Check | Finished last in | Share |', '| --- | --- | --- |');
    for (const entry of summary.lastFinishers) {
      lines.push(
        `| ${entry.name} | ${entry.runs} run(s) | ${formatShare(entry.share)} |`,
      );
    }
  }

  lines.push(
    '',
    '## Stale branches',
    '',
    `${summary.staleBranch.stale} of ${summary.staleBranch.readable} readable run(s) started from a branch ` +
      `\`main\` had already moved past — ${formatShare(summary.staleBranch.share)}. ` +
      `${summary.staleBranch.unreadable} run(s) could not be compared.`,
    '',
    '## Verdict',
    '',
  );

  if (summary.verdict === 'not-enough-data') {
    lines.push(notEnoughDataSentence(summary));
  } else if (summary.verdict === 'within-target') {
    lines.push('Within the target: no signal tripped.');
  } else {
    lines.push(
      `${summary.signals.length} signal(s) tripped. Each names the decision to reopen:`,
      '',
      ...summary.signals.map(signalLine),
    );
  }

  lines.push('', '## What could not be read', '');
  const entries = Object.entries(summary.evidence);
  if (entries.length === 0) {
    lines.push('Nothing was reported as unreadable.');
  } else {
    for (const [what, note] of entries) lines.push(`- ${what}: ${note}`);
  }

  return `${lines.join('\n')}\n`;
}

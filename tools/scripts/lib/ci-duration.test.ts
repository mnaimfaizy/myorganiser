/**
 * Contract Suite for the pure PR CI duration measurement (PRD #1387, issue
 * #1393). Every figure, population and signal is asserted over fixture
 * gathers built in ci-duration-fixtures.ts, never over live Actions history.
 *
 * The percentile rows are the ones most likely to regress silently: the
 * baseline was computed with R-7 interpolation, and a nearest-rank rewrite
 * passes most of the other rows. The population rows are the ones a reviewer
 * is most likely to break by "tidying" a filter, so each population is pinned
 * against a fixture where the wrong sample would move the answer.
 *
 * Run with: node --test tools/scripts/lib/ci-duration.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CACHEABLE_NX_STEPS,
  CACHEABLE_STEP_P50_SECONDS,
  E2E_LANE_JOB,
  E2E_LANE_P50_SECONDS,
  LAST_FINISHER_MEDIAN_SHARE,
  MEASURABLE_CONCLUSIONS,
  MIN_SINGLE_LIBRARY_RUNS,
  NOT_CACHEABLE_NX_STEPS,
  SIGNAL_IDS,
  SIGNALS,
  STALE_BRANCH_SHARE,
  TARGET_P50_SECONDS,
  TEST_JOB_NAME,
  cacheableStepSeconds,
  classifyRun,
  durationSeconds,
  e2eLaneSeconds,
  formatSeconds,
  formatShare,
  isE2eLaneJob,
  isMeasurableRun,
  isStaleBranchRun,
  lastFinisher,
  lastFinisherShares,
  percentile,
  percentiles,
  projectOfFile,
  renderCiDurationMeasurement,
  runSeconds,
  staleBranchShare,
  type GatheredRun,
} from './ci-duration.ts';
import {
  CHANGED_OTHER,
  ROOTS,
  at,
  fastRun,
  hotRun,
  job,
  measure,
  prRun,
  repeat,
  step,
} from './ci-duration-fixtures.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const CI = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

// ------------------------------------------------------ percentile (R-7)

describe('percentile and percentiles (R-7 linear interpolation)', () => {
  test('a percentile of nothing is null, not zero', () => {
    assert.equal(percentile([], 50), null);
  });

  test('an odd sample has its middle value as the median', () => {
    assert.equal(percentile([1, 2, 3], 50), 2);
  });

  test('an even sample interpolates between the two middle values', () => {
    // Nearest-rank would answer 2 or 3 here; the baseline's method is 2.5.
    assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  });

  test('p90 of two values lies 90% of the way between them', () => {
    assert.equal(percentile([10, 20], 90), 19);
  });

  test('a single value is every percentile of its sample', () => {
    assert.equal(percentile([7], 50), 7);
    assert.equal(percentile([7], 90), 7);
  });

  test('unsorted input gives the sorted answer, and the caller array is not reordered', () => {
    const shuffled = [4, 1, 3, 2];
    // Sorted: 1 2 3 4. p50 ranks 1.5, so 2.5. p90 ranks 2.7, so 3 + 0.7 = 3.7.
    assert.equal(percentile(shuffled, 50), 2.5);
    // 0.7 is not exact in binary, so the p90 is compared within a tolerance.
    assert.ok(Math.abs((percentile(shuffled, 90) ?? Number.NaN) - 3.7) < 1e-9);
    assert.deepEqual(shuffled, [4, 1, 3, 2]);
  });

  test('percentiles reports p50, p90 and the finite sample size', () => {
    assert.deepEqual(percentiles([1, Number.NaN, 3]), {
      p50: 2,
      p90: 2.8,
      count: 2,
    });
    assert.deepEqual(percentiles([]), { p50: null, p90: null, count: 0 });
  });
});

// ------------------------------------------- durations, spans and run wait

describe('durations and spans', () => {
  test('durationSeconds is the seconds between two stamps', () => {
    assert.equal(
      durationSeconds('2026-10-01T00:00:00Z', '2026-10-01T00:01:30Z'),
      90,
    );
  });

  test('a missing, unparseable or backwards pair is null, never a negative duration', () => {
    assert.equal(durationSeconds(undefined, at(90)), null);
    assert.equal(durationSeconds(at(0), null), null);
    assert.equal(durationSeconds('nope', at(90)), null);
    assert.equal(durationSeconds(at(90), at(0)), null);
  });

  test('a run that spans overlapping jobs is earliest start to latest finish, not their sum', () => {
    // Job durations 240s and 420s. Their sum is 660s; the wall clock is 540s.
    const overlapping = prRun({
      jobs: [job('Lint', 0, 240), job('Test', 120, 540)],
    });
    assert.equal(runSeconds(overlapping), 540);
  });

  test('a job with no timestamps, a skipped job, is not in the span', () => {
    const withSkipped = prRun({
      jobs: [
        job('Lint', 0, 240),
        job('Test', 120, 540),
        job('Deploy', null, null),
      ],
    });
    assert.equal(runSeconds(withSkipped), 540);
  });

  test('a run whose every job has no timestamps has no duration', () => {
    const allSkipped = prRun({
      jobs: [job('Deploy', null, null), job('Release', null, null)],
    });
    assert.equal(runSeconds(allSkipped), null);
  });
});

// ------------------------------------- project roots and classification

describe('project roots and Single-Library classification', () => {
  test('the longest matching root wins because roots nest', () => {
    assert.equal(
      projectOfFile('libs/web/pages/tasks/src/x.ts', [
        'libs/web/pages',
        'libs/web/pages/tasks',
      ]),
      'libs/web/pages/tasks',
    );
  });

  test('a root file such as package.json is claimed by no project', () => {
    assert.equal(projectOfFile('package.json', ROOTS), null);
  });

  test('a root matches on a path boundary, not a string prefix', () => {
    assert.equal(
      projectOfFile('libs/web/pagesX/a.ts', ['libs/web/pages']),
      null,
    );
  });

  test('a root of empty string or dot claims nothing', () => {
    assert.equal(projectOfFile('README.md', ['', '.']), null);
    assert.equal(projectOfFile('libs/a/x.ts', ['', '.']), null);
  });

  test('every changed file under one root is a Single-Library run', () => {
    assert.equal(
      classifyRun(
        prRun({ changedFiles: ['libs/a/x.ts', 'libs/a/y/z.ts'] }),
        ROOTS,
      ),
      'single-library',
    );
  });

  test('files under two roots make a run other', () => {
    assert.equal(
      classifyRun(prRun({ changedFiles: CHANGED_OTHER }), ROOTS),
      'other',
    );
  });

  test('a root file makes a run other even when the rest is one project', () => {
    assert.equal(
      classifyRun(
        prRun({ changedFiles: ['libs/a/x.ts', 'package.json'] }),
        ROOTS,
      ),
      'other',
    );
  });

  test('a run that changed no files is other, not Single-Library', () => {
    assert.equal(classifyRun(prRun({ changedFiles: [] }), ROOTS), 'other');
  });

  test('a run whose changed files are unreadable is unclassified', () => {
    assert.equal(
      classifyRun(prRun({ changedFiles: null }), ROOTS),
      'unclassified',
    );
    const absent: GatheredRun = {
      runId: 9,
      headBranch: 'feat/x',
      headSha: 'b'.repeat(40),
      createdAt: at(0),
    };
    assert.equal(classifyRun(absent, ROOTS), 'unclassified');
  });

  test('a truncated compare that read one project is unclassified, not Single-Library', () => {
    assert.equal(
      classifyRun(
        prRun({ changedFiles: ['libs/a/x.ts'], filesTruncated: true }),
        ROOTS,
      ),
      'unclassified',
    );
  });

  test('a truncated compare whose read files already span two projects is other', () => {
    assert.equal(
      classifyRun(
        prRun({ changedFiles: CHANGED_OTHER, filesTruncated: true }),
        ROOTS,
      ),
      'other',
    );
  });
});

// ------------------------------------------------------------ stale branch

describe('stale branches', () => {
  test('a run is stale only when main had moved past its branch', () => {
    assert.equal(isStaleBranchRun(prRun({ behindBy: 0 })), false);
    assert.equal(isStaleBranchRun(prRun({ behindBy: 3 })), true);
    assert.equal(isStaleBranchRun(prRun({ behindBy: null })), null);
    const absent: GatheredRun = {
      runId: 9,
      headBranch: 'feat/x',
      headSha: 'b'.repeat(40),
      createdAt: at(0),
    };
    assert.equal(isStaleBranchRun(absent), null);
  });

  test('an unreadable run is out of the denominator, not counted as fresh', () => {
    const share = staleBranchShare([
      prRun({ behindBy: 1 }),
      prRun({ behindBy: 2 }),
      prRun({ behindBy: 0 }),
      prRun({ behindBy: null }),
    ]);
    assert.deepEqual(share, {
      share: 2 / 3,
      stale: 2,
      readable: 3,
      unreadable: 1,
    });
  });
});

// --------------------------------------------------------- cacheable steps

describe('cacheable Nx steps', () => {
  test('only the named cacheable Nx steps are measured', () => {
    const run = prRun({
      jobs: [
        job('Lint', 0, 120, [
          step('Install dependencies', 0, 90),
          step('Lint affected projects', 0, 30),
        ]),
      ],
    });
    assert.deepEqual(cacheableStepSeconds(run), [30]);
  });

  test('a cacheable step with a missing timestamp is skipped, not counted as zero', () => {
    const run = prRun({
      jobs: [
        job('Build', 0, 120, [
          { name: 'Build backend', startedAt: null, completedAt: at(50) },
        ]),
      ],
    });
    assert.deepEqual(cacheableStepSeconds(run), []);
  });

  test('cacheable steps from every job of one run land in one list', () => {
    const run = prRun({
      jobs: [
        job('Lint', 0, 60, [step('Lint affected projects', 0, 30)]),
        job('Test', 0, 120, [step('Test affected projects', 0, 90)]),
      ],
    });
    assert.deepEqual(
      cacheableStepSeconds(run).sort((a, b) => a - b),
      [30, 90],
    );
  });
});

// ------------------------------------------- E2E lane and last finisher

describe('E2E lane and last finisher', () => {
  test('the E2E lane is the E2E-prefixed jobs and not a job that merely mentions E2E', () => {
    for (const name of [
      'E2E Report',
      'E2E Chromium (shard 1/3)',
      'E2E live logout',
    ]) {
      assert.equal(isE2eLaneJob(name), true, name);
    }
    for (const name of ['Test', 'Lint', 'Build Frontend', 'Pre-E2E smoke']) {
      assert.equal(isE2eLaneJob(name), false, name);
    }
  });

  test('the lane span ignores a long Test job in the same run', () => {
    const run = prRun({
      jobs: [
        job('E2E Chromium (shard 1/3)', 0, 200),
        job('E2E Report', 200, 260),
        job('Test', 0, 1200),
      ],
    });
    assert.equal(e2eLaneSeconds(run), 260);
  });

  test('the last finisher is the job that completed latest', () => {
    const run = prRun({ jobs: [job('Lint', 0, 100), job('Test', 0, 300)] });
    assert.equal(lastFinisher(run), 'Test');
  });

  test('a tie for last is broken by name, whatever order the jobs arrive in', () => {
    const testFirst = prRun({
      jobs: [job('Test', 0, 300), job('Build Frontend', 0, 300)],
    });
    const buildFirst = prRun({
      jobs: [job('Build Frontend', 0, 300), job('Test', 0, 300)],
    });
    assert.equal(lastFinisher(testFirst), 'Build Frontend');
    assert.equal(lastFinisher(buildFirst), 'Build Frontend');
  });

  test('a run with no job completion time has no last finisher', () => {
    assert.equal(lastFinisher(prRun({ jobs: [job('Lint', 0, null)] })), null);
    assert.equal(lastFinisher(prRun({ jobs: [] })), null);
  });

  test('last-finisher shares sort most frequent first, ties by name, over readable runs only', () => {
    const shares = lastFinisherShares([
      prRun({ jobs: [job('Lint', 0, 100), job('Test', 0, 300)] }),
      prRun({ jobs: [job('Lint', 0, 100), job('Test', 0, 300)] }),
      prRun({ jobs: [job('Build Frontend', 0, 100), job('Lint', 0, 300)] }),
      prRun({ jobs: [job('Build Frontend', 0, 300), job('Lint', 0, 100)] }),
      prRun({ jobs: [job('Lint', 0, null)] }),
    ]);
    assert.deepEqual(shares, [
      { name: 'Test', runs: 2, share: 0.5 },
      { name: 'Build Frontend', runs: 1, share: 0.25 },
      { name: 'Lint', runs: 1, share: 0.25 },
    ]);
  });
});

// --------------------------------------------- the five signals' boundaries

describe('the five signals, each at its boundary', () => {
  test('the thresholds are the literal values the PRD and the decisions name', () => {
    assert.equal(TARGET_P50_SECONDS, 300);
    assert.equal(CACHEABLE_STEP_P50_SECONDS, 60);
    assert.equal(STALE_BRANCH_SHARE, 0.1);
    assert.equal(E2E_LANE_P50_SECONDS, 300);
    assert.equal(MIN_SINGLE_LIBRARY_RUNS, 10);
    assert.equal(LAST_FINISHER_MEDIAN_SHARE, 0.5);
  });

  test('Single-Library p50 at the target does not trip; one second over does', () => {
    const atTarget = measure(
      repeat(10, () => prRun({ jobs: [job('Lint', 0, TARGET_P50_SECONDS)] })),
    );
    assert.equal(atTarget.durations.singleLibrary.p50, TARGET_P50_SECONDS);
    assert.deepEqual(atTarget.signals, []);

    const over = measure(
      repeat(10, () =>
        prRun({ jobs: [job('Lint', 0, TARGET_P50_SECONDS + 1)] }),
      ),
    );
    assert.deepEqual(
      over.signals.map((signal) => signal.id),
      ['single-library-p50'],
    );
  });

  test('the target signal names decision 1387', () => {
    const over = measure(
      repeat(10, () =>
        prRun({ jobs: [job('Lint', 0, TARGET_P50_SECONDS + 1)] }),
      ),
    );
    assert.equal(
      over.signals.find((signal) => signal.id === 'single-library-p50')
        ?.decision,
      1387,
    );
  });

  test('cacheable step p50 at the line does not trip; over it does, naming 1382', () => {
    const cacheable = (seconds: number) =>
      measure(
        repeat(10, () =>
          prRun({
            jobs: [
              job('Lint', 0, seconds, [
                step('Lint affected projects', 0, seconds),
              ]),
            ],
          }),
        ),
      );
    assert.equal(cacheable(CACHEABLE_STEP_P50_SECONDS).cacheableSteps.p50, 60);
    assert.deepEqual(cacheable(CACHEABLE_STEP_P50_SECONDS).signals, []);

    const over = cacheable(CACHEABLE_STEP_P50_SECONDS + 1);
    const tripped = over.signals.find(
      (signal) => signal.id === 'cacheable-steps-p50',
    );
    assert.ok(tripped, 'cacheable-steps-p50 should trip');
    assert.equal(tripped.decision, 1382);
  });

  test('stale share at the line does not trip; over it does, naming 1376', () => {
    const stale = (count: number) =>
      measure(
        repeat(10, (index) =>
          prRun({
            behindBy: index < count ? 1 : 0,
            jobs: [job('Lint', 0, 120)],
          }),
        ),
      );
    // One stale run in ten is exactly the line.
    assert.equal(stale(1).staleBranch.share, STALE_BRANCH_SHARE);
    assert.deepEqual(stale(1).signals, []);

    const over = stale(2);
    const tripped = over.signals.find(
      (signal) => signal.id === 'stale-branch-share',
    );
    assert.ok(tripped, 'stale-branch-share should trip');
    assert.equal(tripped.decision, 1376);
  });

  test('E2E lane p50 at the target does not trip; over it does, naming 1381', () => {
    const lane = (seconds: number) =>
      measure(
        repeat(10, () => prRun({ jobs: [job('E2E Report', 0, seconds)] })),
      );
    assert.equal(lane(E2E_LANE_P50_SECONDS).e2eLane.p50, E2E_LANE_P50_SECONDS);
    assert.deepEqual(lane(E2E_LANE_P50_SECONDS).signals, []);

    const over = lane(E2E_LANE_P50_SECONDS + 1);
    const tripped = over.signals.find((signal) => signal.id === 'e2e-lane-p50');
    assert.ok(tripped, 'e2e-lane-p50 should trip');
    assert.equal(tripped.decision, 1381);
  });

  test('Test as last finisher at exactly half the runs does not trip; over half does, naming 1385', () => {
    const finishing = (testLast: number) =>
      measure(
        repeat(10, (index) =>
          prRun({
            jobs:
              index < testLast
                ? [job('Lint', 0, 60), job('Test', 0, 120)]
                : [job('Lint', 0, 120), job('Test', 0, 60)],
          }),
        ),
      );
    assert.equal(
      finishing(5).testLastFinisherShare,
      LAST_FINISHER_MEDIAN_SHARE,
    );
    assert.deepEqual(finishing(5).signals, []);

    const over = finishing(6);
    const tripped = over.signals.find(
      (signal) => signal.id === 'test-last-finisher',
    );
    assert.ok(tripped, 'test-last-finisher should trip');
    assert.equal(tripped.decision, 1385);
  });

  test('SIGNALS has one complete, distinct entry per signal id, so a sixth cannot be added silently', () => {
    assert.deepEqual(Object.keys(SIGNALS).sort(), [...SIGNAL_IDS].sort());
    const decisions = SIGNAL_IDS.map((id) => SIGNALS[id].decision);
    assert.equal(new Set(decisions).size, SIGNAL_IDS.length);
    for (const id of SIGNAL_IDS) {
      const entry = SIGNALS[id];
      assert.ok(Number.isInteger(entry.decision) && entry.decision > 0, id);
      assert.notEqual(entry.title.trim(), '', `${id} title`);
      assert.notEqual(entry.threshold.trim(), '', `${id} threshold`);
      assert.notEqual(entry.decisionTitle.trim(), '', `${id} decisionTitle`);
    }
  });
});

// ------------------------------------------- only measurable runs are counted

describe('only runs with a measurable conclusion are counted', () => {
  test('success, failure and timed_out are measurable; cancelled, in progress, absent and skipped are not', () => {
    for (const conclusion of ['success', 'failure', 'timed_out']) {
      assert.equal(isMeasurableRun(prRun({ conclusion })), true, conclusion);
    }
    for (const conclusion of [
      'cancelled',
      null,
      'skipped',
      'startup_failure',
    ]) {
      assert.equal(
        isMeasurableRun(prRun({ conclusion })),
        false,
        String(conclusion),
      );
    }
    assert.equal(
      isMeasurableRun(prRun({ conclusion: undefined })),
      false,
      'absent',
    );
  });

  test('the measurable set is the literal three conclusions, so changing it is a visible change here', () => {
    assert.deepEqual(
      [...MEASURABLE_CONCLUSIONS],
      ['success', 'failure', 'timed_out'],
    );
  });

  test('cancelled runs are in no duration sample: ten short cancelled runs leave the p50 at the two long successful ones', () => {
    const summary = measure([
      ...repeat(10, () =>
        prRun({ conclusion: 'cancelled', jobs: [job('Lint', 0, 60)] }),
      ),
      ...repeat(2, () => prRun({ jobs: [job('Lint', 0, 1200)] })),
    ]);
    assert.equal(summary.sample.runs, 12);
    assert.equal(summary.sample.measured, 2);
    assert.equal(summary.sample.unfinished, 10);
    assert.equal(summary.sample.singleLibrary, 2);
    assert.equal(summary.durations.singleLibrary.count, 2);
    // Unfiltered, the sixty-second runs would be the majority and the p50
    // would be 60. Pinning 1200 is what proves they are out of the sample.
    assert.equal(summary.durations.singleLibrary.p50, 1200);
    assert.equal(summary.durations.all.p50, 1200);
  });

  test('a cancelled run is out of the stale-branch denominator', () => {
    const summary = measure([
      prRun({ conclusion: 'cancelled', behindBy: 5 }),
      prRun({ behindBy: 0 }),
      prRun({ behindBy: 0 }),
    ]);
    assert.deepEqual(summary.staleBranch, {
      share: 0,
      stale: 0,
      readable: 2,
      unreadable: 0,
    });
  });
});

// --------------------------------------------------------- the ten-run cutoff

describe('the ten-run cutoff', () => {
  test('nine Single-Library runs suppress every signal, not just the target one', () => {
    const summary = measure(repeat(MIN_SINGLE_LIBRARY_RUNS - 1, hotRun));
    assert.equal(summary.verdict, 'not-enough-data');
    assert.equal(summary.enoughData, false);
    assert.deepEqual(summary.signals, []);
  });

  test('ten Single-Library runs make the window measurable and the target signal can trip', () => {
    const summary = measure(repeat(MIN_SINGLE_LIBRARY_RUNS, hotRun));
    assert.equal(summary.verdict, 'over-target');
    assert.ok(
      summary.signals.some((signal) => signal.id === 'single-library-p50'),
    );
    // The same fixture trips every signal once there is enough data, which is
    // what makes the nine-run case above a suppression and not a quiet fixture.
    assert.deepEqual(
      summary.signals.map((signal) => signal.id).sort(),
      [...SIGNAL_IDS].sort(),
    );
  });

  test('ten fast, fresh runs that never finish Test last are within target with no signal', () => {
    const summary = measure(repeat(MIN_SINGLE_LIBRARY_RUNS, fastRun));
    assert.equal(summary.verdict, 'within-target');
    assert.deepEqual(summary.signals, []);
  });

  test('enoughData counts Single-Library runs and ignores other and unclassified ones', () => {
    const otherRuns = repeat(20, () => prRun({ changedFiles: CHANGED_OTHER }));
    const unclassifiedRuns = repeat(20, () => prRun({ changedFiles: null }));

    const sparse = measure([
      ...repeat(MIN_SINGLE_LIBRARY_RUNS - 1, fastRun),
      ...otherRuns,
      ...unclassifiedRuns,
    ]);
    assert.equal(sparse.sample.other, 20);
    assert.equal(sparse.sample.unclassified, 20);
    assert.equal(sparse.enoughData, false);
    assert.equal(sparse.verdict, 'not-enough-data');

    const enough = measure([
      ...repeat(MIN_SINGLE_LIBRARY_RUNS, fastRun),
      ...otherRuns,
    ]);
    assert.equal(enough.enoughData, true);
  });

  test('ten Single-Library runs whose jobs were started but never completed do not meet the cutoff', () => {
    const summary = measure(
      repeat(MIN_SINGLE_LIBRARY_RUNS, () =>
        prRun({ jobs: [job('Lint', 0, null), job('Test', 0, null)] }),
      ),
    );
    assert.equal(summary.sample.singleLibrary, MIN_SINGLE_LIBRARY_RUNS);
    assert.equal(summary.durations.singleLibrary.count, 0);
    assert.equal(summary.enoughData, false);
    assert.equal(summary.verdict, 'not-enough-data');
    assert.deepEqual(summary.signals, []);
  });

  test('twelve Single-Library runs of which only nine are measurable do not meet the cutoff', () => {
    const summary = measure([
      ...repeat(9, fastRun),
      ...repeat(3, () => prRun({ jobs: [job('Lint', 0, null)] })),
    ]);
    assert.equal(summary.sample.singleLibrary, 12);
    assert.equal(summary.durations.singleLibrary.count, 9);
    assert.equal(summary.enoughData, false);
    assert.equal(summary.verdict, 'not-enough-data');
  });
});

// --------------------------------------------------- populations stay separate

describe('populations stay separate', () => {
  test('Single-Library and all-PR p50 are computed over different samples', () => {
    const summary = measure([
      ...repeat(10, fastRun),
      ...repeat(20, () =>
        prRun({ changedFiles: CHANGED_OTHER, jobs: [job('Lint', 0, 1200)] }),
      ),
    ]);
    assert.equal(summary.durations.singleLibrary.p50, 120);
    assert.equal(summary.durations.singleLibrary.count, 10);
    assert.equal(summary.durations.other.p50, 1200);
    assert.equal(summary.durations.other.count, 20);
    assert.equal(summary.durations.all.p50, 1200);
    assert.equal(summary.durations.all.count, 30);
    assert.ok(summary.durations.singleLibrary.p50 < summary.durations.all.p50);
  });

  test('cacheable, E2E-lane and last-finisher figures ignore other runs', () => {
    const otherSlow = prRun({
      changedFiles: CHANGED_OTHER,
      jobs: [
        job('E2E Report', 0, 900),
        job('Test', 0, 1000, [step('Test affected projects', 0, 600)]),
      ],
    });
    const summary = measure([
      ...repeat(MIN_SINGLE_LIBRARY_RUNS, fastRun),
      otherSlow,
    ]);
    assert.equal(summary.cacheableSteps.count, 0);
    assert.equal(summary.cacheableSteps.p50, null);
    assert.equal(summary.e2eLane.count, 0);
    assert.equal(summary.e2eLane.p50, null);
    assert.deepEqual(summary.lastFinishers, [
      { name: 'Lint', runs: MIN_SINGLE_LIBRARY_RUNS, share: 1 },
    ]);
    assert.equal(summary.testLastFinisherShare, 0);
  });

  test('the stale-branch share is over every readable run, Single-Library or not', () => {
    const summary = measure([
      ...repeat(MIN_SINGLE_LIBRARY_RUNS, fastRun),
      prRun({ changedFiles: CHANGED_OTHER, behindBy: 2 }),
    ]);
    assert.deepEqual(summary.staleBranch, {
      share: 1 / 11,
      stale: 1,
      readable: 11,
      unreadable: 0,
    });
  });
});

// ------------------------------------------------------------ the report

describe('the rendered report', () => {
  test('a tripped summary names each tripped signal, its decision and its title', () => {
    const summary = measure(repeat(MIN_SINGLE_LIBRARY_RUNS, hotRun));
    const text = renderCiDurationMeasurement(summary);
    assert.equal(summary.signals.length, SIGNAL_IDS.length);
    for (const signal of summary.signals) {
      assert.match(text, new RegExp(`#${signal.decision}\\b`), signal.id);
      assert.ok(text.includes(signal.title), signal.id);
    }
  });

  test('a sparse window says so and prints a dash, not yes or no, in the Tripped column', () => {
    const text = renderCiDurationMeasurement(
      measure(repeat(MIN_SINGLE_LIBRARY_RUNS - 1, hotRun)),
    );
    assert.match(text, /Not enough data/);
    for (const id of SIGNAL_IDS) {
      const row = text
        .split('\n')
        .find((line) => line.includes(SIGNALS[id].title));
      assert.ok(row, `no row for ${id}`);
      assert.ok(
        row.endsWith('| — |'),
        `${id} row should end with a dash: ${row}`,
      );
    }
    assert.doesNotMatch(text, /\| (yes|no) \|/);
  });

  test('every evidence key is printed, so what could not be read is never dropped', () => {
    const evidence = {
      'CI runs (`gh run list`)': '3 listed, 3 in the window',
      'job listing':
        '1 run(s) had more than 100 jobs; only the first page was read',
      'Nx project roots': '3 read from `project.json` files at this checkout',
    };
    const text = renderCiDurationMeasurement(measure([fastRun()], evidence));
    for (const [what, note] of Object.entries(evidence)) {
      assert.ok(text.includes(`- ${what}: ${note}`), what);
    }
  });

  test('a Single-Library window with no readable completion time says so', () => {
    const text = renderCiDurationMeasurement(
      measure(
        repeat(MIN_SINGLE_LIBRARY_RUNS, () =>
          prRun({ jobs: [job('Lint', 0, null)] }),
        ),
      ),
    );
    assert.ok(
      text.includes(
        'No Single-Library run had a readable job completion time.',
      ),
    );
  });

  test('a window with nothing unreadable says so in the evidence block', () => {
    const text = renderCiDurationMeasurement(measure([fastRun()]));
    assert.ok(text.includes('Nothing was reported as unreadable.'));
  });

  test('the sample line is the whole sentence built from the summary, naming the cancelled count', () => {
    const summary = measure([
      ...repeat(10, () => prRun({ conclusion: 'cancelled' })),
      ...repeat(2, fastRun),
    ]);
    assert.equal(summary.sample.unfinished, 10);
    const { runs, measured, singleLibrary, other, unclassified, unfinished } =
      summary.sample;
    const expected =
      `Sample: ${runs} run(s), ${measured} of them finished — ` +
      `${singleLibrary} Single-Library, ${other} other, ` +
      `${unclassified} unclassified. ` +
      `${unfinished} cancelled or still running, which no figure here counts.`;
    const text = renderCiDurationMeasurement(summary);
    assert.ok(text.split('\n').includes(expected), expected);
  });

  test('formatting is `not measurable` for an unknown figure and m:ss for a duration', () => {
    assert.equal(formatSeconds(null), 'not measurable');
    assert.equal(formatShare(null), 'not measurable');
    assert.equal(formatSeconds(330), '5m 30s');
  });
});

// ------------------------------------------------- ci.yml anti-drift facts

const jobsSection = CI.slice(CI.search(/^jobs:\s*$/m));

/** Every job of ci.yml with the `name:` it is given, as written. */
const jobNames = (): { id: string; name: string }[] => {
  const headers = [...jobsSection.matchAll(/^ {2}([a-z0-9][a-z0-9-]*):\s*$/gm)];
  const named = [
    ...jobsSection.matchAll(
      /^ {2}([a-z0-9][a-z0-9-]*):[ \t]*\r?\n {4}name: (.+)$/gm,
    ),
  ].map((match) => ({ id: match[1], name: match[2].trim() }));
  assert.equal(
    named.length,
    headers.length,
    'every job header in ci.yml should be followed by its name:',
  );
  return named;
};

/**
 * Every step block named `name` in ci.yml. The slicer's stepNamed returns the
 * first only, and the drift this guards is a second occurrence that runs
 * something other than Nx.
 */
const stepBlocksNamed = (name: string): string[] => {
  const lines = CI.split('\n');
  const blocks: string[] = [];
  lines.forEach((line, index) => {
    if (line.trimEnd() !== `      - name: ${name}`) return;
    const body = [line];
    for (const next of lines.slice(index + 1)) {
      if (
        /^ {6}- name: /.test(next) ||
        /^ {2}\S/.test(next) ||
        /^\S/.test(next)
      ) {
        break;
      }
      body.push(next);
    }
    blocks.push(body.join('\n'));
  });
  return blocks;
};

const PACKAGE_SCRIPTS: Record<string, string> = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
).scripts;

/**
 * A command token that is `nx` itself: after whitespace or a shell separator,
 * and before whitespace or the end of the line. `docs:nx-targets:check` and
 * `NX_GRAPH_FILE` are not one.
 */
const NX_COMMAND = /(?:^|[\s;&|(`'"])nx(?=\s|$)/m;

/** The `run:` text of one step block: the command, and nothing else in the step. */
const runOf = (block: string): string => {
  const lines = block.split('\n');
  const at = lines.findIndex((line) => /^ {8}run: /.test(line));
  if (at === -1) return '';
  const body = [lines[at]];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== '' && /^ {0,7}\S/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
};

/**
 * Whether a step's command reaches nx: directly, or through a `yarn <script>`
 * (or `corepack yarn <script>`) alias whose package.json command reaches nx.
 */
const reachesNx = (run: string): boolean =>
  NX_COMMAND.test(run) ||
  [...run.matchAll(/\byarn ([a-z0-9:_-]+)/g)].some(
    ([, script]) =>
      Object.prototype.hasOwnProperty.call(PACKAGE_SCRIPTS, script) &&
      NX_COMMAND.test(PACKAGE_SCRIPTS[script]),
  );

/** Every step of ci.yml, by its name, with the block it is written as. */
const allStepBlocks = (): { name: string; block: string }[] => {
  const lines = CI.split('\n');
  const steps: { name: string; block: string }[] = [];
  lines.forEach((line, index) => {
    const named = /^ {6}- name: (.+)$/.exec(line);
    if (!named) return;
    const body = [line];
    for (const next of lines.slice(index + 1)) {
      if (
        /^ {6}- name: /.test(next) ||
        /^ {2}\S/.test(next) ||
        /^\S/.test(next)
      ) {
        break;
      }
      body.push(next);
    }
    steps.push({ name: named[1].trim(), block: body.join('\n') });
  });
  return steps;
};

describe('ci.yml facts the constants depend on', () => {
  test('every cacheable Nx step name is a CI step, and every occurrence of it reaches nx directly or through a yarn alias', () => {
    for (const name of CACHEABLE_NX_STEPS) {
      const blocks = stepBlocksNamed(name);
      assert.ok(blocks.length > 0, `no CI step named "${name}" in ci.yml`);
      for (const block of blocks) {
        assert.ok(
          reachesNx(runOf(block)),
          `CI step "${name}" no longer reaches nx, directly or through a yarn alias; CACHEABLE_NX_STEPS would measure nothing`,
        );
      }
    }
  });

  test('every ci.yml step that reaches nx is named in CACHEABLE_NX_STEPS or NOT_CACHEABLE_NX_STEPS, so the list cannot fall behind ci.yml', () => {
    const cacheable = new Set<string>(CACHEABLE_NX_STEPS);
    const exempt = new Set<string>(NOT_CACHEABLE_NX_STEPS);
    for (const step of allStepBlocks()) {
      if (!reachesNx(runOf(step.block))) continue;
      assert.ok(
        cacheable.has(step.name) || exempt.has(step.name),
        `CI step "${step.name}" reaches nx but is in neither CACHEABLE_NX_STEPS nor NOT_CACHEABLE_NX_STEPS: decide whether its wall clock is a cache-hit wait`,
      );
    }
  });

  test('the cacheable and not-cacheable lists are disjoint and the exemption list is not empty', () => {
    assert.ok(
      NOT_CACHEABLE_NX_STEPS.length > 0,
      'NOT_CACHEABLE_NX_STEPS is empty',
    );
    const cacheable = new Set<string>(CACHEABLE_NX_STEPS);
    for (const name of NOT_CACHEABLE_NX_STEPS) {
      assert.ok(!cacheable.has(name), `"${name}" is in both lists`);
    }
  });

  test('every occurrence of every NOT_CACHEABLE_NX_STEPS entry reaches nx, and no entry is also cacheable, so an exemption cannot go stale', () => {
    for (const name of NOT_CACHEABLE_NX_STEPS) {
      const blocks = stepBlocksNamed(name);
      assert.ok(
        blocks.length > 0,
        `"${name}" is exempted, but ci.yml has no step of that name`,
      );
      for (const block of blocks) {
        assert.ok(
          reachesNx(runOf(block)),
          `"${name}" is exempted, but one of its occurrences in ci.yml no longer reaches nx`,
        );
      }
      assert.ok(
        !(CACHEABLE_NX_STEPS as readonly string[]).includes(name),
        `"${name}" is both cacheable and exempt`,
      );
    }
  });

  test('TEST_JOB_NAME is the name of a job in ci.yml', () => {
    assert.ok(
      jobNames().some((entry) => entry.name === TEST_JOB_NAME),
      `no job named ${TEST_JOB_NAME}`,
    );
  });

  test('E2E_LANE_JOB selects exactly the E2E lane jobs of ci.yml and at least one', () => {
    const lane = jobNames()
      .filter((entry) => isE2eLaneJob(entry.name))
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(lane, [
      'E2E Chromium (shard ${{ matrix.shard }}/3)',
      'E2E Report',
      'E2E live logout',
    ]);
    assert.equal(E2E_LANE_JOB.test('E2E live logout'), true);
  });
});

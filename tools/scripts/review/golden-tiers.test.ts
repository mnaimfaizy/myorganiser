import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { sep } from 'node:path';
import test from 'node:test';

import {
  ALL_TIERS,
  CASE_TIERS,
  GOLDEN_SET_PATH,
  REPLAY_INPUT_PATHS,
  SCHEDULED_FRONTIER_REPETITIONS,
  caseIdsInTier,
  isFirstWeekOfMonth,
  replayMatrix,
  scheduledTier,
} from './golden-tiers.ts';

const set = {
  cases: [
    { id: 'a-guard', tier: 'guard' },
    { id: 'b-frontier', tier: 'frontier' },
    { id: 'c-frontier', tier: 'frontier' },
  ],
};

test('a tier selects its own cases, in the set order', () => {
  assert.deepEqual(caseIdsInTier(set, 'guard'), ['a-guard']);
  assert.deepEqual(caseIdsInTier(set, 'frontier'), [
    'b-frontier',
    'c-frontier',
  ]);
});

// The bug this module was extracted for: the replay workflow passed the
// literal "all" and the scorer's own filter rejected it, so the two
// implementations disagreed about the one input the workflow actually sends
// on a brief change. Both spellings mean every case.
test('"all" and no tier both mean every case', () => {
  const every = ['a-guard', 'b-frontier', 'c-frontier'];
  assert.deepEqual(caseIdsInTier(set, ALL_TIERS), every);
  assert.deepEqual(caseIdsInTier(set, undefined), every);
});

test('an unknown tier is refused by name', () => {
  assert.throws(() => caseIdsInTier(set, 'occasional'), /occasional/);
  assert.throws(() => caseIdsInTier(set, 'occasional'), /guard, frontier, all/);
});

// golden.ts validates the committed set against the same vocabulary this
// module filters by. They were two hand-typed arrays until the reviewer pointed
// out that the change claiming one filter had left two copies of what it
// filters over: a third tier added to one list only would let the filter accept
// a case the validator rejects.
test('the validator and the filter share one tier vocabulary', async () => {
  const { GOLDEN_CASE_TIERS, REVIEW_GOLDEN_SET_PATH } =
    await import('./golden.ts');
  assert.deepEqual(GOLDEN_CASE_TIERS, CASE_TIERS);
  // Same location, spelled for the platform on one side and for the workflow
  // on the other.
  assert.deepEqual(
    REVIEW_GOLDEN_SET_PATH.split(sep),
    GOLDEN_SET_PATH.split('/'),
  );
});

test('every tier the committed set uses is one this module knows', () => {
  const committed = JSON.parse(readFileSync(GOLDEN_SET_PATH, 'utf8'));
  for (const c of committed.cases)
    assert.ok(CASE_TIERS.includes(c.tier), `${c.id} has tier ${c.tier}`);
});

// The workflow's `cases` job installs no dependencies. If this script ever
// reaches a third-party import, the replay dies at ERR_MODULE_NOT_FOUND
// before a single case runs — which is exactly how it died once.
test('the script runs with no dependencies installed', () => {
  const out = execFileSync(
    process.execPath,
    ['tools/scripts/review/golden-tiers.ts', '--tier', 'all'],
    { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } },
  );
  const ids = JSON.parse(out);
  const committed = JSON.parse(readFileSync(GOLDEN_SET_PATH, 'utf8'));
  assert.deepEqual(
    ids,
    committed.cases.map((c: { id: string }) => c.id),
  );
});

test('the CLI and the workflow agree on every tier', () => {
  const run = (args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, args, { encoding: 'utf8' }).trim(),
    );
  for (const tier of [...CASE_TIERS, ALL_TIERS]) {
    assert.deepEqual(
      run(['tools/scripts/review/golden-tiers.ts', '--tier', tier]),
      run([
        'tools/scripts/review/score-golden-case.ts',
        '--list',
        '--tier',
        tier,
      ]),
      `the two callers disagree for tier ${tier}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The scheduled cadence (ADR 0109)
// ---------------------------------------------------------------------------

test('a week with no reviewer input change replays nothing', () => {
  assert.equal(
    scheduledTier({
      changedInWeek: false,
      changedInMonth: false,
      firstWeekOfMonth: false,
    }),
    null,
  );
  // The first week of the month is no exception: a guard re-confirms a
  // reviewer that has not moved, which is the spend ADR 0109 removes.
  assert.equal(
    scheduledTier({
      changedInWeek: false,
      changedInMonth: false,
      firstWeekOfMonth: true,
    }),
    null,
  );
});

test('a changed week replays the frontier, and the first week of a changed month replays all', () => {
  assert.equal(
    scheduledTier({
      changedInWeek: true,
      changedInMonth: true,
      firstWeekOfMonth: false,
    }),
    'frontier',
  );
  assert.equal(
    scheduledTier({
      changedInWeek: true,
      changedInMonth: true,
      firstWeekOfMonth: true,
    }),
    ALL_TIERS,
  );
  // A change three weeks ago still earns the monthly guard run, though the
  // week itself was quiet.
  assert.equal(
    scheduledTier({
      changedInWeek: false,
      changedInMonth: true,
      firstWeekOfMonth: true,
    }),
    ALL_TIERS,
  );
});

// Exactly the paths that produce a review. Dropping one lets a reviewer change
// go a month without a scheduled measurement; adding one buys a replay for a
// change that does not move the reviewer. `.claude`, the Copilot hooks and
// the upstream-brief Skill are out by #925's decision: the permission clash
// that once cost a replay its turns is review:allowlist:check's (ADR 0099),
// and `.claude` moves most weeks, which would make the gate always true.
test('the scheduled replay watches exactly the reviewer inputs', () => {
  assert.deepEqual(REPLAY_INPUT_PATHS, [
    '.agents/skills/code-review',
    'tools/scripts/review',
    '.github/actions/code-reviewer',
    '.github/workflows/code-review.yml',
    '.github/workflows/review-golden-replay.yml',
    'tools/config/review-golden-set.json',
    'tools/config/review-obligations.json',
    'tools/config/review-rules.json',
  ]);
});

test('the first week of the month is days one to seven', () => {
  assert.equal(isFirstWeekOfMonth(new Date('2026-10-05T03:00:00Z')), true);
  assert.equal(isFirstWeekOfMonth(new Date('2026-10-07T03:00:00Z')), true);
  assert.equal(isFirstWeekOfMonth(new Date('2026-10-08T03:00:00Z')), false);
});

// ---------------------------------------------------------------------------
// Standing by rate, and the scheduled repetitions (ADR 0116)
// ---------------------------------------------------------------------------

const tenRuns = (id: string, outcome: string) =>
  Array.from({ length: 10 }, () => ({ case: id, outcome }));

// The filter selects by where a case stands, not only by what the set
// declares: ten scored runs in the record move it, and the weekly replay
// follows without anyone editing the set.
test('a tier selects the cases standing in it, read from the record', () => {
  const records = [
    ...tenRuns('a-guard', 'missed'),
    ...tenRuns('b-frontier', 'caught'),
  ];
  assert.deepEqual(caseIdsInTier(set, 'guard', records), ['b-frontier']);
  assert.deepEqual(caseIdsInTier(set, 'frontier', records), [
    'a-guard',
    'c-frontier',
  ]);
  // Every case is still every case.
  assert.deepEqual(caseIdsInTier(set, ALL_TIERS, records), [
    'a-guard',
    'b-frontier',
    'c-frontier',
  ]);
});

test('under ten scored runs the declared tier selects', () => {
  const records = tenRuns('a-guard', 'missed').slice(0, 9);
  assert.deepEqual(caseIdsInTier(set, 'guard', records), ['a-guard']);
});

test('the scheduled replay runs each frontier case three times and each guard once', () => {
  assert.equal(SCHEDULED_FRONTIER_REPETITIONS, 3);
  assert.deepEqual(replayMatrix(set, ALL_TIERS, { event: 'schedule' }), [
    { case: 'a-guard', repetition: 1 },
    { case: 'b-frontier', repetition: 1 },
    { case: 'b-frontier', repetition: 2 },
    { case: 'b-frontier', repetition: 3 },
    { case: 'c-frontier', repetition: 1 },
    { case: 'c-frontier', repetition: 2 },
    { case: 'c-frontier', repetition: 3 },
  ]);
});

// ADR 0072 item 8: a label or a dispatch is one repetition, on any tier.
test('a label and a dispatch stay one repetition per case', () => {
  for (const event of ['pull_request', 'workflow_dispatch', undefined])
    assert.deepEqual(replayMatrix(set, 'frontier', { event }), [
      { case: 'b-frontier', repetition: 1 },
      { case: 'c-frontier', repetition: 1 },
    ]);
});

// The repetitions follow the standing, not the declaration: a case the
// record promoted is a guard and runs once.
test('a case promoted by the record is repeated as the guard it stands at', () => {
  const records = tenRuns('b-frontier', 'caught');
  assert.deepEqual(
    replayMatrix(set, ALL_TIERS, { records, event: 'schedule' }).filter(
      (m) => m.case === 'b-frontier',
    ),
    [{ case: 'b-frontier', repetition: 1 }],
  );
});

test('the matrix CLI prints what the workflow reads, with nothing installed', () => {
  const out = execFileSync(
    process.execPath,
    [
      'tools/scripts/review/golden-tiers.ts',
      '--matrix',
      '--tier',
      'all',
      '--event',
      'workflow_dispatch',
    ],
    { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } },
  );
  const committed = JSON.parse(readFileSync(GOLDEN_SET_PATH, 'utf8'));
  assert.deepEqual(
    JSON.parse(out),
    committed.cases.map((c: { id: string }) => ({
      case: c.id,
      repetition: 1,
    })),
  );
});

// A model bake-off is a dispatch over the cases it is about (ADR 0072 item 6),
// not over a whole tier: three cases on two models is six sessions, where the
// frontier tier would be eighteen (issue #1140). Still one repetition per
// dispatch, as item 8 requires.
test('a dispatch may name its cases, from any tier, one repetition each', () => {
  assert.deepEqual(
    replayMatrix(set, ALL_TIERS, {
      event: 'workflow_dispatch',
      cases: ['c-frontier', 'a-guard'],
    }),
    [
      { case: 'a-guard', repetition: 1 },
      { case: 'c-frontier', repetition: 1 },
    ],
  );
  // A mistyped id replays nothing it was asked for, so it is refused.
  assert.throws(
    () => replayMatrix(set, ALL_TIERS, { cases: ['c-frontier', 'nope'] }),
    /no golden case "nope"/,
  );
  // An empty list is no selection, not a request for nothing.
  assert.deepEqual(
    replayMatrix(set, 'frontier', { cases: [] }),
    replayMatrix(set, 'frontier'),
  );
});

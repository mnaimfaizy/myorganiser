import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEMOTE_AT,
  PROMOTE_AT,
  STANDING_WINDOW,
  caseStanding,
  caseStandings,
  renderStandingTable,
} from './golden-standing.ts';

// One record per character, oldest first: c = caught, m = missed, v = void,
// p = clean-pass, f = clean-fail.
const OUTCOME: Record<string, string> = {
  c: 'caught',
  m: 'missed',
  v: 'void',
  p: 'clean-pass',
  f: 'clean-fail',
};
const runs = (id: string, history: string) =>
  [...history].map((ch) => ({ case: id, outcome: OUTCOME[ch] }));

test('the thresholds are the ones ADR 0116 decides', () => {
  assert.equal(STANDING_WINDOW, 10);
  assert.equal(PROMOTE_AT, 8);
  assert.equal(DEMOTE_AT, 5);
});

test('eight catches of the last ten promote a frontier case', () => {
  const s = caseStanding(runs('a', 'ccccccccmm'), 'a', 'frontier');
  assert.equal(s.tier, 'guard');
  assert.equal(s.caught, 8);
  assert.equal(s.scoredRuns, 10);
  assert.equal(s.decided, true);
});

test('five catches of the last ten demote a guard', () => {
  const s = caseStanding(runs('a', 'cccccmmmmm'), 'a', 'guard');
  assert.equal(s.tier, 'frontier');
  assert.equal(s.caught, 5);
});

test('six or seven of ten leave a case where it was', () => {
  assert.equal(
    caseStanding(runs('a', 'ccccccmmmm'), 'a', 'guard').tier,
    'guard',
  );
  assert.equal(
    caseStanding(runs('a', 'cccccccmmm'), 'a', 'frontier').tier,
    'frontier',
  );
});

// The reason there are two thresholds and not one: a case that earned guard
// and then slips to seven of ten keeps it, where a single cut-off at eight
// would have demoted it on what one more catch reverses.
test('the band holds the tier the record earned, not the declared one', () => {
  // Ten runs at 8 of 10 promote; two more misses slide the window to 7, then 6.
  const s = caseStanding(runs('a', 'ccccccccmm' + 'cm'), 'a', 'frontier');
  assert.equal(s.caught, 7);
  assert.equal(s.tier, 'guard');
});

test('under ten scored runs nothing moves, whatever the rate', () => {
  const allMissed = caseStanding(runs('a', 'mmmmmmmmm'), 'a', 'guard');
  assert.equal(allMissed.tier, 'guard');
  assert.equal(allMissed.decided, false);
  assert.equal(allMissed.scoredRuns, 9);

  const allCaught = caseStanding(runs('a', 'ccccccccc'), 'a', 'frontier');
  assert.equal(allCaught.tier, 'frontier');
  assert.equal(allCaught.caught, 9);

  const none = caseStanding([], 'a', 'frontier');
  assert.equal(none.tier, 'frontier');
  assert.equal(none.windowRuns, 0);
});

// ADR 0101: a void measured nothing. Ten lines of which two are voids are
// eight scored runs, and eight scored runs decide nothing.
test('a void is not a scored run', () => {
  const s = caseStanding(runs('a', 'ccccvccccv'), 'a', 'frontier');
  assert.equal(s.scoredRuns, 8);
  assert.equal(s.tier, 'frontier');
});

test('only the last ten scored runs count', () => {
  // Ten misses, then ten catches: the window holds the catches alone.
  const s = caseStanding(runs('a', 'mmmmmmmmmm' + 'cccccccccc'), 'a', 'guard');
  assert.equal(s.scoredRuns, 20);
  assert.equal(s.caught, 10);
  assert.equal(s.tier, 'guard');
});

test('a clean case stands on its clean-pass rate', () => {
  assert.equal(
    caseStanding(runs('a', 'ppppppppff'), 'a', 'frontier').tier,
    'guard',
  );
  assert.equal(
    caseStanding(runs('a', 'pppppfffff'), 'a', 'guard').tier,
    'frontier',
  );
});

test("another case's runs do not count", () => {
  const records = [...runs('a', 'cccccccccc'), ...runs('b', 'mmm')];
  assert.equal(caseStanding(records, 'b', 'guard').scoredRuns, 3);
  assert.equal(caseStanding(records, 'b', 'guard').tier, 'guard');
});

const set = {
  cases: [
    { id: 'a', tier: 'frontier' },
    { id: 'b', tier: 'frontier' },
    { id: 'g', tier: 'guard' },
  ],
};

test('standings come back in the set order, each from its own runs', () => {
  const records = [...runs('b', 'cccccccccc'), ...runs('g', 'mmmmmmmmmm')];
  assert.deepEqual(
    caseStandings(set, records).map((s) => [s.id, s.tier]),
    [
      ['a', 'frontier'],
      ['b', 'guard'],
      ['g', 'frontier'],
    ],
  );
});

// ADR 0072's 2026-09-17 amendment, kept under the rate rule: the weekly
// replay runs the frontier, so a set standing all-guard is not measured for
// a month. The promoted case with the fewest catches stays behind.
test('promotion by rate may not empty the frontier', () => {
  const records = [
    ...runs('a', 'cccccccccc'),
    ...runs('b', 'ccccccccmm'),
    ...runs('g', 'cccccccccc'),
  ];
  const standings = caseStandings(set, records);
  assert.deepEqual(
    standings.map((s) => [s.id, s.tier, s.heldAtFrontier]),
    [
      ['a', 'guard', false],
      ['b', 'frontier', true],
      ['g', 'guard', false],
    ],
  );
});

test('the table shows each case its rate and its scored runs', () => {
  const records = [...runs('a', 'ccm'), ...runs('g', 'cccccccccm')];
  const table = renderStandingTable(set, records);
  assert.match(
    table,
    /\| `a` \| `frontier` \| 3 \| 2 of 3 \| 67% \| `frontier` \| declared; under 10 scored runs/,
  );
  assert.match(
    table,
    /\| `b` \| `frontier` \| 0 \| 0 of 0 \| — \| `frontier` \|/,
  );
  assert.match(
    table,
    /\| `g` \| `guard` \| 10 \| 9 of 10 \| 90% \| `guard` \| 8 or more of ten \|/,
  );
});

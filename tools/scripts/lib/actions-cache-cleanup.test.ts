// Contract Suite for the pure selection module behind cache-cleanup.yml
// (slice #1391). The defect worth catching is a deletion that takes the newest
// entry of a Cache Family: on `main` that entry is the dependency cache and the
// Nx baseline every pull request restores from, so a selection that deletes it
// turns a warm cache cold. The other defects pinned here are the ones that widen
// a selection: merging two Nx targets into one family, matching a pull request's
// refs by prefix, pruning a ref other than `main`, and an order that depends on
// the API's listing order. Fixtures are verbatim-shaped entries of
// `GET /repos/{owner}/{repo}/actions/caches`, so the keys are the shapes CI writes.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAIN_REF,
  cacheFamily,
  formatBytes,
  formatCleanupSummary,
  newestOf,
  planCacheCleanup,
  pullRequestOf,
  pullRequestRefs,
  selectClosedPullRequestCaches,
  selectSupersededCaches,
  type ActionsCache,
} from '../lib/actions-cache-cleanup.ts';

const hex = (seed: number, length: number): string =>
  seed.toString(16).padStart(length, '0');
const sha = (seed: number): string => hex(seed, 40);
const digest = (seed: number): string => hex(seed, 64);
const day = (n: number): string =>
  `2026-10-${String(n).padStart(2, '0')}T12:00:00Z`;

const cache = (
  id: number,
  key: string,
  ref: string,
  created: string,
  size?: number,
): ActionsCache => ({
  id,
  key,
  ref,
  created_at: created,
  ...(size === undefined ? {} : { size_in_bytes: size }),
});

const DEPS = (seed: number): string => `Linux-node-22-deps-${digest(seed)}`;
const LINT = (seed: number): string => `Linux-nx-22-lint-${sha(seed)}`;
const TEST = (seed: number): string => `Linux-nx-22-test-${sha(seed)}`;

const idsOf = (caches: readonly { id: number }[]): number[] =>
  caches.map((c) => c.id).sort((a, b) => a - b);

// Pull request 7 (merge and head), pull request 70 and 9 as collision bait, and
// `main` holding a key identical to one of pull request 7's.
const PR_FIXTURE: ActionsCache[] = [
  cache(1, DEPS(1), 'refs/pull/7/merge', day(1)),
  cache(2, LINT(1), 'refs/pull/7/merge', day(2)),
  cache(3, TEST(1), 'refs/pull/7/head', day(3)),
  cache(4, LINT(1), 'refs/pull/70/merge', day(4)),
  cache(5, TEST(1), 'refs/pull/70/head', day(5)),
  cache(6, LINT(1), MAIN_REF, day(6)),
  cache(7, TEST(2), 'refs/pull/9/merge', day(7)),
];

// Several copies of each family on `main`, plus a pull request scope that the
// superseded rules must never touch.
const MAIN_FIXTURE: ActionsCache[] = [
  cache(10, DEPS(1), MAIN_REF, day(1)),
  cache(11, DEPS(2), MAIN_REF, day(2)),
  cache(12, DEPS(3), MAIN_REF, day(3)),
  cache(20, LINT(1), MAIN_REF, day(1)),
  cache(21, LINT(2), MAIN_REF, day(4)),
  cache(30, TEST(1), MAIN_REF, day(5)),
  cache(40, 'playwright-browsers-v1', MAIN_REF, day(1)),
  cache(41, 'playwright-browsers-v1', MAIN_REF, day(2)),
  cache(50, DEPS(1), 'refs/pull/9/merge', day(1)),
  cache(51, DEPS(2), 'refs/pull/9/merge', day(2)),
];

test('cacheFamily names the family of a dependency cache key', () => {
  assert.equal(cacheFamily(DEPS(1)), 'Linux-node-22-deps');
});

test('cacheFamily names the family of each Nx baseline key', () => {
  assert.equal(cacheFamily(LINT(1)), 'Linux-nx-22-lint');
  assert.equal(cacheFamily(TEST(1)), 'Linux-nx-22-test');
  assert.equal(cacheFamily(`Linux-nx-22-e2e-${sha(1)}`), 'Linux-nx-22-e2e');
});

test('cacheFamily keeps a hyphenated Nx target whole', () => {
  assert.equal(
    cacheFamily(`Linux-nx-22-e2e-firefox-${sha(1)}`),
    'Linux-nx-22-e2e-firefox',
  );
});

test('cacheFamily ignores the Node and Nx major versions', () => {
  assert.equal(
    cacheFamily(`Linux-node-24-deps-${digest(1)}`),
    'Linux-node-24-deps',
  );
  assert.equal(cacheFamily(`Linux-nx-23-test-${sha(1)}`), 'Linux-nx-23-test');
});

test('cacheFamily leaves keys of an unrecognised shape undefined', () => {
  assert.equal(cacheFamily('Linux-nx-22-lint'), undefined);
  assert.equal(cacheFamily('playwright-browsers-v1'), undefined);
  assert.equal(cacheFamily('Linux-nx-22-lint-main'), undefined);
  assert.equal(cacheFamily(`Linux-nx-22-lint-${hex(1, 39)}`), undefined);
});

test('cacheFamily keeps the lint and test baselines in different families', () => {
  assert.notEqual(cacheFamily(LINT(1)), cacheFamily(TEST(1)));
});

test('pullRequestOf reads the number from either pull request scope', () => {
  assert.equal(pullRequestOf('refs/pull/7/merge'), 7);
  assert.equal(pullRequestOf('refs/pull/7/head'), 7);
});

test('pullRequestOf is undefined for a ref that is not a pull request scope', () => {
  assert.equal(pullRequestOf(MAIN_REF), undefined);
  assert.equal(pullRequestOf('refs/pull/abc/merge'), undefined);
});

test('pullRequestRefs returns the merge and head refs of a pull request', () => {
  assert.deepEqual(pullRequestRefs(7), [
    'refs/pull/7/merge',
    'refs/pull/7/head',
  ]);
});

test('pullRequestRefs throws for a number that is not a pull request', () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => pullRequestRefs(bad), /not a pull request number/);
  }
});

test('selectClosedPullRequestCaches selects every entry on the merge and head refs', () => {
  assert.deepEqual(
    idsOf(selectClosedPullRequestCaches(PR_FIXTURE, 7)),
    [1, 2, 3],
  );
});

test('selectClosedPullRequestCaches does not match pull request 70 or 9 by prefix', () => {
  const selected = idsOf(selectClosedPullRequestCaches(PR_FIXTURE, 7));
  for (const id of [4, 5, 7]) assert.ok(!selected.includes(id), `id ${id}`);
});

test('selectClosedPullRequestCaches never selects main, even for an identical key', () => {
  const fixture = [
    cache(1, LINT(1), 'refs/pull/7/merge', day(1)),
    cache(2, LINT(1), MAIN_REF, day(2)),
  ];
  assert.deepEqual(idsOf(selectClosedPullRequestCaches(fixture, 7)), [1]);
});

test('selectClosedPullRequestCaches throws for an invalid pull request number', () => {
  assert.throws(
    () => selectClosedPullRequestCaches(PR_FIXTURE, 0),
    /not a pull request number/,
  );
});

test('selectSupersededCaches keeps the newest of each family and selects the older ones', () => {
  assert.deepEqual(
    idsOf(selectSupersededCaches(MAIN_FIXTURE, { ref: MAIN_REF })),
    [10, 11, 20],
  );
});

test('selectSupersededCaches selects nothing on any ref other than the one named', () => {
  const pullRequestOnly = MAIN_FIXTURE.filter((c) => c.id >= 50);
  assert.deepEqual(
    selectSupersededCaches(pullRequestOnly, { ref: MAIN_REF }),
    [],
  );
});

test('selectSupersededCaches selects nothing from a family with a single entry', () => {
  const single = [cache(30, TEST(1), MAIN_REF, day(5))];
  assert.deepEqual(selectSupersededCaches(single, { ref: MAIN_REF }), []);
});

test('selectSupersededCaches selects nothing for keys it does not recognise', () => {
  const unknown = MAIN_FIXTURE.filter((c) => c.id >= 40 && c.id < 50);
  assert.deepEqual(selectSupersededCaches(unknown, { ref: MAIN_REF }), []);
});

test('selectSupersededCaches protects a keepKeys key that is otherwise superseded', () => {
  const pair = [
    cache(10, DEPS(1), MAIN_REF, day(1)),
    cache(11, DEPS(2), MAIN_REF, day(2)),
  ];
  assert.deepEqual(
    idsOf(selectSupersededCaches(pair, { ref: MAIN_REF })),
    [10],
  );
  assert.deepEqual(
    selectSupersededCaches(pair, { ref: MAIN_REF, keepKeys: [DEPS(1)] }),
    [],
  );
});

test('selectSupersededCaches skips a family whose created_at cannot be parsed, whole', () => {
  const fixture = [
    cache(60, DEPS(1), MAIN_REF, 'not-a-date'),
    cache(61, DEPS(2), MAIN_REF, day(2)),
    cache(62, LINT(1), MAIN_REF, day(1)),
    cache(63, LINT(2), MAIN_REF, day(2)),
  ];
  assert.deepEqual(
    idsOf(selectSupersededCaches(fixture, { ref: MAIN_REF })),
    [62],
  );
});

test('selectSupersededCaches keeps the higher id when created_at ties', () => {
  const tied = [
    cache(70, LINT(1), MAIN_REF, day(1)),
    cache(71, LINT(2), MAIN_REF, day(1)),
  ];
  assert.deepEqual(
    idsOf(selectSupersededCaches(tied, { ref: MAIN_REF })),
    [70],
  );
});

test('selectSupersededCaches does not depend on the listing order', () => {
  const forward = idsOf(
    selectSupersededCaches(MAIN_FIXTURE, { ref: MAIN_REF }),
  );
  const reversed = [...MAIN_FIXTURE].reverse();
  const rotated = [...MAIN_FIXTURE.slice(4), ...MAIN_FIXTURE.slice(0, 4)];
  assert.deepEqual(
    idsOf(selectSupersededCaches(reversed, { ref: MAIN_REF })),
    forward,
  );
  assert.deepEqual(
    idsOf(selectSupersededCaches(rotated, { ref: MAIN_REF })),
    forward,
  );
});

test('newestOf throws for an empty group and breaks created_at ties by id', () => {
  assert.throws(() => newestOf([]), /no caches to choose from/);
  const tied = [
    cache(70, LINT(1), MAIN_REF, day(1)),
    cache(71, LINT(2), MAIN_REF, day(1)),
  ];
  assert.equal(newestOf(tied).id, 71);
});

test('planCacheCleanup throws when neither a closed pull request nor a ref is named', () => {
  assert.throws(() => planCacheCleanup(PR_FIXTURE, {}), /nothing to clean up/);
});

// Pull request 7's entries, plus one with no size, and main's copies.
const PLAN_FIXTURE: ActionsCache[] = [
  cache(1, DEPS(1), 'refs/pull/7/merge', day(1), 100),
  cache(2, LINT(1), 'refs/pull/7/merge', day(2), 200),
  cache(3, TEST(1), 'refs/pull/7/head', day(3), 300),
  cache(4, TEST(2), 'refs/pull/7/head', day(4)),
  cache(10, DEPS(1), MAIN_REF, day(1), 1000),
  cache(11, DEPS(2), MAIN_REF, day(2), 1000),
  cache(12, DEPS(3), MAIN_REF, day(3), 1000),
  cache(20, LINT(1), MAIN_REF, day(1), 500),
  cache(21, LINT(2), MAIN_REF, day(2), 500),
  cache(30, TEST(1), MAIN_REF, day(1)),
];

test('planCacheCleanup covers both scopes, once per entry', () => {
  const plan = planCacheCleanup(PLAN_FIXTURE, {
    closedPullRequest: 7,
    supersededOn: MAIN_REF,
  });
  const ids = plan.deletions.map((d) => d.cache.id);
  assert.deepEqual(
    idsOf(plan.deletions.map((d) => d.cache)),
    [1, 2, 3, 4, 10, 11, 20],
  );
  assert.equal(new Set(ids).size, ids.length);
});

test('planCacheCleanup gives each deletion a reason naming its pull request or its family and ref', () => {
  const plan = planCacheCleanup(PLAN_FIXTURE, {
    closedPullRequest: 7,
    supersededOn: MAIN_REF,
  });
  const reasonOf = (id: number): string | undefined =>
    plan.deletions.find((d) => d.cache.id === id)?.reason;
  assert.match(reasonOf(1) ?? '', /pull request #7/);
  assert.match(reasonOf(10) ?? '', /refs\/heads\/main/);
  assert.match(reasonOf(10) ?? '', /Linux-node-22-deps/);
});

test('planCacheCleanup sums size_in_bytes and counts a missing size as zero', () => {
  const closed = planCacheCleanup(PLAN_FIXTURE, { closedPullRequest: 7 });
  assert.equal(closed.freedBytes, 600);
  assert.deepEqual(idsOf(closed.deletions.map((d) => d.cache)), [1, 2, 3, 4]);
  const main = planCacheCleanup(PLAN_FIXTURE, { supersededOn: MAIN_REF });
  assert.equal(main.freedBytes, 2500);
});

test('planCacheCleanup keeps the newest entry of each recognised family on the pruned ref', () => {
  const plan = planCacheCleanup(PLAN_FIXTURE, { supersededOn: MAIN_REF });
  assert.deepEqual(idsOf(plan.kept), [12, 21, 30]);
});

test('planCacheCleanup never selects the newest entry of a family and leaves one per family', () => {
  const families: ActionsCache[] = [
    ...MAIN_FIXTURE.filter((c) => c.id < 40),
    // Higher id, older created_at: id order and date order disagree here.
    cache(13, DEPS(4), MAIN_REF, '2026-09-28T12:00:00Z'),
    cache(31, TEST(2), MAIN_REF, day(6)),
    cache(32, TEST(3), MAIN_REF, day(7)),
    cache(33, `Linux-nx-22-e2e-firefox-${sha(1)}`, MAIN_REF, day(1)),
    cache(34, `Linux-nx-22-e2e-firefox-${sha(2)}`, MAIN_REF, day(2)),
    cache(35, `Linux-nx-22-e2e-firefox-${sha(3)}`, MAIN_REF, day(3)),
    cache(36, `Linux-nx-22-e2e-firefox-${sha(4)}`, 'refs/pull/9/merge', day(9)),
  ];
  const plan = planCacheCleanup(families, { supersededOn: MAIN_REF });
  const deleted = new Set(plan.deletions.map((d) => d.cache.id));
  assert.ok(
    deleted.has(13),
    'id 13 is the oldest DEPS copy and must be selected',
  );
  assert.ok(
    !deleted.has(12),
    'id 12 is the DEPS copy newest by created_at and must survive',
  );

  // Derived here by sorting the fixture, not by calling newestOf.
  const onMain = families.filter((c) => c.ref === MAIN_REF);
  const familyNames = new Set(onMain.map((c) => cacheFamily(c.key) ?? ''));
  for (const family of familyNames) {
    const members = onMain
      .filter((c) => cacheFamily(c.key) === family)
      .sort(
        (a, b) =>
          Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id,
      );
    const newest = members[members.length - 1];
    assert.equal(
      deleted.has(newest.id),
      false,
      `the newest ${family} entry (id ${newest.id}) was selected for deletion`,
    );
    const survivors = members.filter((c) => !deleted.has(c.id));
    assert.deepEqual(
      survivors.map((c) => c.id),
      [newest.id],
      `${family} should keep exactly its newest entry on ${MAIN_REF}`,
    );
  }
});

test('formatBytes prints bytes below 1 KiB as B and larger sizes in KiB and MiB', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KiB');
  assert.equal(formatBytes(1536), '1.5 KiB');
  assert.equal(formatBytes(1048576), '1.0 MiB');
});

test('formatCleanupSummary says so when there is nothing to delete', () => {
  const plan = planCacheCleanup([], { supersededOn: MAIN_REF });
  assert.match(formatCleanupSummary(plan), /Nothing to delete\./);
});

test('formatCleanupSummary lists each deleted key, its ref and its reason', () => {
  const summary = formatCleanupSummary(
    planCacheCleanup(PLAN_FIXTURE, { supersededOn: MAIN_REF }),
  );
  assert.ok(summary.includes(`\`${DEPS(1)}\` (${MAIN_REF})`), summary);
  assert.ok(
    summary.includes(
      `superseded on ${MAIN_REF} by a newer Linux-node-22-deps entry`,
    ),
    summary,
  );
});

test('formatCleanupSummary says "Would delete" for a dry run and "Deleted" for a real run', () => {
  const plan = planCacheCleanup(PLAN_FIXTURE, { supersededOn: MAIN_REF });
  const dry = formatCleanupSummary(plan, { dryRun: true });
  const real = formatCleanupSummary(plan);
  assert.match(dry, /Would delete/);
  assert.doesNotMatch(dry, /Deleted /);
  assert.match(real, /Deleted /);
  assert.doesNotMatch(real, /Would delete/);
});

test('formatCleanupSummary lists the kept entries under their own heading', () => {
  const summary = formatCleanupSummary(
    planCacheCleanup(PLAN_FIXTURE, { supersededOn: MAIN_REF }),
  );
  const heading = summary.indexOf('Kept as the newest entry of its family');
  assert.ok(heading > 0, 'kept heading is present');
  assert.ok(
    summary.indexOf(`\`${DEPS(3)}\` (${MAIN_REF})`) > heading,
    'kept DEPS(3) is listed under the kept heading',
  );
});

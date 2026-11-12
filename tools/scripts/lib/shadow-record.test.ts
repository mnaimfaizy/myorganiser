/**
 * Contract Suite for the pure shadow record report (PRD #1523, issue #1528,
 * ADR 0148 decisions 5 and 6). Every judgment is asserted over fixture gathers
 * built below, never over live GitHub history. Shadow comments are rendered by
 * the real `renderShadowComment`, so the parser is pinned to the train's own
 * output; malformed bodies are written out by hand.
 *
 * Run with: node --test tools/scripts/lib/shadow-record.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SHADOW_COMMENT_LEAD,
  SHADOW_COMMENT_MARKER,
  SHADOW_HELD,
  SHADOW_WOULD_MERGE,
  renderShadowComment,
  type AutoMergeDecision,
} from './merge-train.ts';
import {
  BAD_WITHIN_DAYS,
  MIN_DECISIONS,
  MIN_SPAN_DAYS,
  introducedInPullRequests,
  mergedUnchanged,
  parseShadowComment,
  renderShadowRecord,
  revertedPullRequests,
  summarizeShadowRecord,
  type GatheredBranchCommit,
  type GatheredMerge,
  type GatheredPullRequest,
  type ShadowGather,
} from './shadow-record.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

// ----------------------------------------------------------------- fixtures

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T00:00:00Z');

/**
 * An instant `days` after the fixed origin, plus `ms`. Fractions of a day are
 * allowed; `ms` builds the one-second boundary rows.
 */
const at = (days: number, ms = 0): string =>
  new Date(T0 + Math.round(days * DAY) + ms).toISOString();

/** The report is made well after every fixture event unless a test says so. */
const ASOF = at(40);

/** A full-length commit id made of one repeated hex digit. */
const sha = (digit: string): string => digit.repeat(40);
const HEAD = sha('a');
const OLDER = sha('b');
const NEWER = sha('c');
const MERGE_OF_MAIN = sha('d');
const LATER_STILL = sha('e');

/** The Maintainer's login: the one the train comments as, and so the one trusted. */
const BOT = 'maintainer';

const commit = (oid: string, isMerge = false): GatheredBranchCommit => ({
  oid,
  isMerge,
});

const WOULD_MERGE: AutoMergeDecision = {
  action: 'shadow-comment',
  held: false,
  reason: 'every fact holds',
  mismatch: null,
};

const heldBy = (
  reason: string,
  mismatch: string | null = null,
): AutoMergeDecision => ({ action: 'skip', held: true, reason, mismatch });

/** The body the train writes for a would-merge decision at `head`. */
const wouldMergeBody = (head: string = HEAD): string =>
  renderShadowComment(WOULD_MERGE, head);

/** The body the train writes for a held decision. */
const heldBody = (
  reason: string,
  mismatch: string | null = null,
  head: string = HEAD,
): string => renderShadowComment(heldBy(reason, mismatch), head);

/**
 * A Pull Request the train would have merged at HEAD, decided on `decidedDay`
 * and merged by the Maintainer half a day later with no commit after HEAD.
 */
const decided = (
  number: number,
  decidedDay: number,
  overrides: Partial<GatheredPullRequest> = {},
): GatheredPullRequest => ({
  number,
  title: `feat: change ${number}`,
  state: 'merged',
  mergedAt: at(decidedDay + 0.5),
  comment: { author: BOT, updatedAt: at(decidedDay), body: wouldMergeBody() },
  commits: [commit(HEAD)],
  ...overrides,
});

/** A Pull Request whose one shadow comment is a held decision. */
const heldPr = (
  number: number,
  decidedDay: number,
  reason: string,
): GatheredPullRequest =>
  decided(number, decidedDay, {
    comment: {
      author: BOT,
      updatedAt: at(decidedDay),
      body: heldBody(reason),
    },
  });

/** A merged Pull Request, read to find reverts and follow-up fixes. */
const merged = (
  number: number,
  mergedAt: string,
  overrides: Partial<GatheredMerge> = {},
): GatheredMerge => ({
  number,
  title: `feat: other ${number}`,
  body: '',
  mergedAt,
  commitMessages: [],
  ...overrides,
});

/** A Revert of `target`, naming it in the title as GitHub writes one. */
const revertOf = (
  number: number,
  mergedAt: string,
  target: number,
): GatheredMerge =>
  merged(number, mergedAt, {
    title: `Revert "feat: change ${target} (#${target})"`,
    body: `This reverts #${target}.`,
  });

/** A follow-up fix whose commit names `target` as what introduced the defect. */
const fixOf = (
  number: number,
  mergedAt: string,
  target: number,
): GatheredMerge =>
  merged(number, mergedAt, {
    title: `fix: follow-up to #${target}`,
    commitMessages: [`fix: tidy\n\nIntroduced in #${target}`],
  });

const gather = (overrides: Partial<ShadowGather> = {}): ShadowGather => ({
  asOf: ASOF,
  window: { since: '2026-11-01', until: '2026-11-30' },
  mode: 'shadow',
  trustedAuthors: [BOT],
  evidence: {},
  pullRequests: [],
  merges: [],
  ...overrides,
});

/** `count` days spread evenly from `start` to `start + spanDays`, both ends included. */
const spread = (count: number, spanDays: number, start = 0): number[] =>
  Array.from(
    { length: count },
    (_, index) => start + (index * spanDays) / (count - 1),
  );

/** The record the criterion asks for: 20 decisions over 14 days, all merged unchanged. */
const metRecord = (): GatheredPullRequest[] =>
  spread(20, 14).map((day, index) => decided(100 + index, day));

/** Replace the one Pull Request numbered `number`, leaving the rest as they are. */
const withPullRequest = (
  pullRequests: GatheredPullRequest[],
  number: number,
  patch: Partial<GatheredPullRequest>,
): GatheredPullRequest[] =>
  pullRequests.map((pr) => (pr.number === number ? { ...pr, ...patch } : pr));

/** The one decision a single-Pull-Request gather produces, PR #10 decided day 0, merged day 1. */
const singleDecision = (merges: GatheredMerge[]) =>
  summarizeShadowRecord(
    gather({
      pullRequests: [decided(10, 0, { mergedAt: at(1) })],
      merges,
    }),
  ).decisions[0];

/**
 * A record with one bad Auto-merge: PR #100 merged on day 0.5, reverted by
 * #900 on day 3. Nothing else is in it, so the count restarts at day 3.
 */
const badRecord = (): ShadowGather =>
  gather({
    pullRequests: [decided(100, 0, { mergedAt: at(0.5) })],
    merges: [revertOf(900, at(3), 100)],
  });

// ----------------------------------------------------- parseShadowComment

describe('parseShadowComment reads the decision a shadow comment states', () => {
  test('a would-merge comment yields the backticked head it was decided for', () => {
    assert.deepEqual(parseShadowComment(wouldMergeBody(HEAD)), {
      kind: 'would-merge',
      head: HEAD,
    });
  });

  test('a held comment yields its reason, with the Head and Mismatch lines present', () => {
    const body = heldBody('Required check CI is red', 'Door is one-way');
    assert.ok(body.includes('Head: `'), 'the fixture carries a Head line');
    assert.ok(
      body.includes('Mismatch: '),
      'the fixture carries a Mismatch line',
    );
    assert.deepEqual(parseShadowComment(body), {
      kind: 'held',
      reason: 'Required check CI is red',
    });
  });

  test('a body without the marker is not a shadow comment', () => {
    const body = wouldMergeBody().replace(SHADOW_COMMENT_MARKER, '');
    assert.equal(parseShadowComment(body), null);
  });

  test('a marker with no decision line is not readable', () => {
    assert.equal(
      parseShadowComment(`${SHADOW_COMMENT_MARKER}\n\nSome other text.`),
      null,
    );
  });

  test('a decision line that is neither form, or a held line with no reason, is not readable', () => {
    assert.equal(
      parseShadowComment(
        `${SHADOW_COMMENT_MARKER}\n${SHADOW_COMMENT_LEAD} would merge soon \`${HEAD}\``,
      ),
      null,
    );
    assert.equal(
      parseShadowComment(
        `${SHADOW_COMMENT_MARKER}\n${SHADOW_COMMENT_LEAD} ${SHADOW_HELD}   `,
      ),
      null,
    );
  });

  test('a would-merge line without a backticked head is not readable', () => {
    const body = `${SHADOW_COMMENT_MARKER}\n${SHADOW_COMMENT_LEAD} ${SHADOW_WOULD_MERGE} ${HEAD}`;
    assert.equal(parseShadowComment(body), null);
  });

  test('a CRLF body reads the same decisions as its LF form', () => {
    assert.deepEqual(
      parseShadowComment(wouldMergeBody(OLDER).replace(/\n/g, '\r\n')),
      { kind: 'would-merge', head: OLDER },
    );
    assert.deepEqual(
      parseShadowComment(heldBody('CI is red').replace(/\n/g, '\r\n')),
      { kind: 'held', reason: 'CI is red' },
    );
  });

  test('an abbreviated head of seven characters is read, and six is not', () => {
    assert.deepEqual(parseShadowComment(wouldMergeBody(HEAD.slice(0, 7))), {
      kind: 'would-merge',
      head: 'aaaaaaa',
    });
    assert.equal(parseShadowComment(wouldMergeBody(HEAD.slice(0, 6))), null);
  });
});

// ------------------------------------- reverts and follow-up fixes named

describe('revertedPullRequests and introducedInPullRequests name the Pull Requests a merge undoes or fixes', () => {
  test('a Revert whose title names a Pull Request reverts it', () => {
    assert.deepEqual(
      revertedPullRequests('Revert "feat: thing (#1234)"', ''),
      [1234],
    );
  });

  test('a Revert whose body names a Pull Request reverts it', () => {
    assert.deepEqual(
      revertedPullRequests('Revert "feat: thing"', 'This reverts #1234.'),
      [1234],
    );
  });

  test('a title that is not a revert names nothing, even when it mentions a number', () => {
    assert.deepEqual(
      revertedPullRequests('fix: follow-up to #1234', 'This reverts #1234.'),
      [],
    );
  });

  test('a revert names every number it mentions, each once', () => {
    assert.deepEqual(
      revertedPullRequests('Revert "feat (#10)"', 'Also #10 and #11.'),
      [10, 11],
    );
  });

  test('the revert keyword is case-insensitive', () => {
    assert.deepEqual(revertedPullRequests('REVERT "feat (#5)"', ''), [5]);
    assert.deepEqual(revertedPullRequests('revert: thing (#6)', ''), [6]);
  });

  test('an Introduced in line names its Pull Request in any message, each number once', () => {
    assert.deepEqual(
      introducedInPullRequests([
        'fix: a\n\nIntroduced in #1234',
        'fix: b\n\nIntroduced in #1234\nIntroduced in #99',
      ]),
      [1234, 99],
    );
  });

  test('Introduced in is case-insensitive, and Introduced in unknown names nothing', () => {
    assert.deepEqual(introducedInPullRequests(['introduced IN #77']), [77]);
    assert.deepEqual(
      introducedInPullRequests([
        'fix: a\n\nIntroduced in unknown: no Pull Request found',
      ]),
      [],
    );
  });
});

// ------------------------------------------------------- mergedUnchanged

describe('mergedUnchanged judges a merge against the decided head', () => {
  test('a head that is the last commit of the branch is unchanged', () => {
    assert.deepEqual(mergedUnchanged([commit(OLDER), commit(HEAD)], HEAD), {
      unchanged: true,
      verifiable: true,
      detail: null,
    });
  });

  test('commits written after the decided head change it, and the count is reported', () => {
    assert.deepEqual(
      mergedUnchanged([commit(HEAD), commit(NEWER), commit(LATER_STILL)], HEAD),
      {
        unchanged: false,
        verifiable: true,
        detail: '2 commit(s) written after the decided head',
      },
    );
  });

  test('merges of main after the head do not change it, but a commit after them does', () => {
    assert.deepEqual(
      mergedUnchanged(
        [commit(HEAD), commit(MERGE_OF_MAIN, true), commit(LATER_STILL, true)],
        HEAD,
      ),
      { unchanged: true, verifiable: true, detail: null },
    );
    assert.deepEqual(
      mergedUnchanged(
        [commit(HEAD), commit(MERGE_OF_MAIN, true), commit(NEWER)],
        HEAD,
      ),
      {
        unchanged: false,
        verifiable: true,
        detail: '1 commit(s) written after the decided head',
      },
    );
  });

  test('a decided head that is not on the branch is changed, and verifiable', () => {
    assert.deepEqual(mergedUnchanged([commit(NEWER)], HEAD), {
      unchanged: false,
      verifiable: true,
      detail: 'the decided head aaaaaaa is not on the branch',
    });
  });

  test('commits that could not be read are unverifiable, not changed', () => {
    assert.deepEqual(mergedUnchanged(null, HEAD), {
      unchanged: false,
      verifiable: false,
      detail: 'the branch commits could not be read',
    });
  });

  test('an abbreviated head matches the full commit id', () => {
    assert.deepEqual(mergedUnchanged([commit(HEAD)], HEAD.slice(0, 7)), {
      unchanged: true,
      verifiable: true,
      detail: null,
    });
  });
});

// --------------------------------------- counts, held tally and span

describe('summarizeShadowRecord counts decisions, held reasons, unreadable comments and span', () => {
  test('counts would-merge decisions, tallies held by reason, and counts unreadable comments', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: [
          decided(1, 0),
          decided(2, 1),
          decided(3, 2),
          heldPr(4, 3, 'CI is red'),
          heldPr(5, 4, 'CI is red'),
          heldPr(6, 5, 'Door is one-way'),
          decided(7, 6, {
            comment: { author: BOT, updatedAt: at(6), body: 'Looks fine.' },
          }),
          decided(8, 7, {
            comment: {
              author: BOT,
              updatedAt: 'not a date',
              body: wouldMergeBody(),
            },
          }),
        ],
      }),
    );
    assert.equal(summary.decisions.length, 3);
    assert.equal(summary.held.total, 3);
    assert.deepEqual(summary.held.byReason, [
      { reason: 'CI is red', count: 2 },
      { reason: 'Door is one-way', count: 1 },
    ]);
    assert.equal(summary.unreadableComments, 2);
  });

  test('held reasons sort by count, then alphabetically', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: [
          heldPr(1, 0, 'Zeta gate'),
          heldPr(2, 1, 'Alpha gate'),
          heldPr(3, 2, 'Mid gate'),
          heldPr(4, 3, 'Mid gate'),
        ],
      }),
    );
    assert.deepEqual(summary.held.byReason, [
      { reason: 'Mid gate', count: 2 },
      { reason: 'Alpha gate', count: 1 },
      { reason: 'Zeta gate', count: 1 },
    ]);
  });

  test('span is the days from the first to the last decision comment edit, and decisions sort by it', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: [decided(30, 3), decided(31, 0), decided(32, 14)],
      }),
    );
    assert.deepEqual(
      summary.decisions.map((d) => d.number),
      [31, 30, 32],
    );
    assert.equal(summary.spanDays, 14);
    assert.equal(summary.firstDecisionAt, at(0));
    assert.equal(summary.lastDecisionAt, at(14));
    // Decided on the comment edit, not on the merge half a day later.
    assert.equal(summary.decisions[0].decidedAt, Date.parse(at(0)));
  });

  test('a held Pull Request is tallied as held and is never a would-merge decision', () => {
    const summary = summarizeShadowRecord(
      gather({ pullRequests: [heldPr(40, 2, 'CI is red')] }),
    );
    assert.equal(summary.decisions.length, 0);
    assert.equal(summary.counted.length, 0);
    assert.equal(summary.held.total, 1);
    assert.equal(summary.spanDays, 0);
    assert.equal(summary.firstDecisionAt, null);
  });
});

// ------------------------------------------------- bad Auto-merges

describe('a revert or follow-up fix within seven days of the merge makes an Auto-merge bad', () => {
  test('a revert merged within seven days of the decision merge is bad, reverted', () => {
    assert.deepEqual(singleDecision([revertOf(20, at(3), 10)]).bad, {
      kind: 'reverted',
      by: 20,
      at: Date.parse(at(3)),
    });
  });

  test('a follow-up fix that names the Pull Request within seven days is bad, fixed', () => {
    assert.deepEqual(singleDecision([fixOf(30, at(4), 10)]).bad, {
      kind: 'fixed',
      by: 30,
      at: Date.parse(at(4)),
    });
  });

  test('a revert or fix seven days and one second after the merge is not bad', () => {
    assert.equal(singleDecision([revertOf(20, at(8, 1000), 10)]).bad, null);
    assert.equal(singleDecision([fixOf(30, at(8, 1000), 10)]).bad, null);
  });

  test('a revert or fix exactly seven days after the merge is bad', () => {
    assert.equal(
      singleDecision([revertOf(20, at(8), 10)]).bad?.kind,
      'reverted',
    );
    assert.equal(singleDecision([fixOf(30, at(8), 10)]).bad?.kind, 'fixed');
  });

  test('a fix or revert merged before the original merge is not bad', () => {
    assert.equal(singleDecision([fixOf(30, at(0.5), 10)]).bad, null);
    assert.equal(singleDecision([revertOf(21, at(0.9), 10)]).bad, null);
  });

  test('a revert or fix merged at the same instant as the original merge is not bad', () => {
    assert.equal(singleDecision([revertOf(20, at(1), 10)]).bad, null);
    assert.equal(singleDecision([fixOf(30, at(1), 10)]).bad, null);
  });

  test('a merge whose mergedAt cannot be read is ignored, even when it names the Pull Request', () => {
    assert.equal(
      singleDecision([
        merged(20, 'not a date', { title: 'Revert "feat: change 10 (#10)"' }),
      ]).bad,
      null,
    );
  });

  test('a Pull Request does not count as its own revert', () => {
    assert.equal(
      singleDecision([
        merged(10, at(2), { title: 'Revert "feat: change 10 (#10)"' }),
      ]).bad,
      null,
    );
  });

  test('a revert takes precedence over a fix named in the same merge', () => {
    assert.deepEqual(
      singleDecision([
        merged(20, at(3), {
          title: 'Revert "feat: change 10 (#10)"',
          commitMessages: ['fix: tidy\n\nIntroduced in #10'],
        }),
      ]).bad,
      { kind: 'reverted', by: 20, at: Date.parse(at(3)) },
    );
  });

  test('the earliest bad merge is the one reported, whatever the order of the merges', () => {
    assert.deepEqual(
      singleDecision([fixOf(30, at(5), 10), revertOf(20, at(3), 10)]).bad,
      { kind: 'reverted', by: 20, at: Date.parse(at(3)) },
    );
  });
});

// --------------------------------------------------- verdict: met and not met

describe('summarizeShadowRecord verdict: the exit criterion', () => {
  test('exactly 20 decisions over exactly 14 days, all merged unchanged and past the watch, is met', () => {
    const summary = summarizeShadowRecord(
      gather({ pullRequests: metRecord() }),
    );
    assert.equal(summary.verdict, 'met');
    assert.deepEqual(summary.unmet, []);
    assert.equal(summary.counted.length, 20);
    assert.equal(summary.spanDays, 14);
    assert.equal(summary.mergedUnchanged, 20);
    assert.equal(summary.restartAt, null);
    assert.equal(summary.returnToShadow, false);
  });

  test('19 decisions over 14 days is not met, for too few decisions alone', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: spread(19, 14).map((day, i) => decided(100 + i, day)),
      }),
    );
    assert.equal(summary.verdict, 'not-met');
    assert.deepEqual(summary.unmet, ['19 of 20 decisions']);
  });

  test('20 decisions over 13.9 days is not met, for too short a span alone', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: spread(20, 13.9).map((day, i) => decided(100 + i, day)),
      }),
    );
    assert.equal(summary.verdict, 'not-met');
    assert.deepEqual(summary.unmet, ['span 13.9 of 14 days']);
  });

  test('19 decisions over 13.9 days is not met, and both shortfalls are listed', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: spread(19, 13.9).map((day, i) => decided(100 + i, day)),
      }),
    );
    assert.equal(summary.verdict, 'not-met');
    assert.deepEqual(summary.unmet, [
      '19 of 20 decisions',
      'span 13.9 of 14 days',
    ]);
  });

  test('one merged with a commit after the head is not met, for a changed merge alone', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: withPullRequest(metRecord(), 105, {
          commits: [commit(HEAD), commit(NEWER)],
        }),
      }),
    );
    assert.equal(summary.verdict, 'not-met');
    assert.deepEqual(summary.unmet, [
      '1 not merged unchanged (#105 merged-changed)',
    ]);
  });

  test('one still open is not met, for an open decision alone', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: withPullRequest(metRecord(), 105, {
          state: 'open',
          mergedAt: null,
        }),
      }),
    );
    assert.equal(summary.verdict, 'not-met');
    assert.deepEqual(summary.unmet, ['1 not merged unchanged (#105 open)']);
  });

  test('one closed without a merge is not met, for a closed-unmerged decision alone', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: withPullRequest(metRecord(), 105, {
          state: 'closed',
          mergedAt: null,
        }),
      }),
    );
    assert.equal(summary.verdict, 'not-met');
    assert.deepEqual(summary.unmet, [
      '1 not merged unchanged (#105 closed-unmerged)',
    ]);
  });

  test('one whose branch commits could not be read is not met, for an unverifiable merge alone', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: withPullRequest(metRecord(), 105, { commits: null }),
      }),
    );
    assert.equal(summary.verdict, 'not-met');
    assert.deepEqual(summary.unmet, [
      '1 not merged unchanged (#105 merged-unverifiable)',
    ]);
  });

  test('one merged inside its seven-day watch is not met, for the watch alone', () => {
    // #119 merged on day 20; at day 25 its watch runs to day 27. Every other
    // merge is at least a week old by then.
    const summary = summarizeShadowRecord(
      gather({
        asOf: at(25),
        pullRequests: withPullRequest(metRecord(), 119, { mergedAt: at(20) }),
      }),
    );
    assert.equal(summary.verdict, 'not-met');
    assert.deepEqual(summary.unmet, [
      `1 still inside the ${BAD_WITHIN_DAYS}-day watch (#119)`,
    ]);
  });

  test('the watch ends exactly seven days after the merge', () => {
    const summary = summarizeShadowRecord(
      gather({
        asOf: at(27),
        pullRequests: withPullRequest(metRecord(), 119, { mergedAt: at(20) }),
      }),
    );
    assert.equal(summary.verdict, 'met');
  });
});

// ----------------------------------------------------------- verdict: reset

describe('summarizeShadowRecord verdict: a bad Auto-merge resets the record', () => {
  test('a bad Auto-merge gives the reset verdict while the criterion is unmet', () => {
    const summary = summarizeShadowRecord(badRecord());
    assert.equal(summary.verdict, 'reset');
    assert.equal(summary.bad.length, 1);
    assert.equal(summary.bad[0].number, 100);
    assert.equal(summary.restartAt, at(3));
    assert.deepEqual(summary.unmet, [
      '0 of 20 decisions',
      'span 0.0 of 14 days',
    ]);
  });

  test('restartAt is the latest bad merge, and decisions at or before it are not counted', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: [
          decided(100, 0, { mergedAt: at(0.5) }),
          decided(101, 1, { mergedAt: at(1.5) }),
          decided(102, 2, { mergedAt: at(2.5) }),
          decided(103, 3, { mergedAt: at(3.5) }),
          decided(104, 4, { mergedAt: at(4.5) }),
          decided(105, 5, { mergedAt: at(5.5) }),
          decided(106, 6, { mergedAt: at(6.5) }),
        ],
        merges: [revertOf(900, at(3), 100), fixOf(901, at(5), 101)],
      }),
    );
    assert.equal(summary.restartAt, at(5));
    assert.deepEqual(
      summary.bad.map((d) => d.number),
      [100, 101],
    );
    // 102 to 105 are on or before day 5, the restart, so only 106 counts.
    assert.deepEqual(
      summary.counted.map((d) => d.number),
      [106],
    );
  });

  test('after the restart, 20 decisions over 14 days unchanged is met, and restartAt stays set', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: [
          decided(100, 0, { mergedAt: at(0.5) }),
          ...spread(20, 14, 4).map((day, i) => decided(300 + i, day)),
        ],
        merges: [revertOf(900, at(3), 100)],
      }),
    );
    assert.equal(summary.verdict, 'met');
    assert.deepEqual(summary.unmet, []);
    assert.equal(summary.counted.length, 20);
    assert.equal(summary.restartAt, at(3));
    assert.equal(summary.bad.length, 1);
  });

  test('returnToShadow is set when a bad Auto-merge exists and the setting is on', () => {
    const summary = summarizeShadowRecord({ ...badRecord(), mode: 'on' });
    assert.equal(summary.returnToShadow, true);
  });

  test('returnToShadow is clear under shadow, and when nothing is bad', () => {
    assert.equal(summarizeShadowRecord(badRecord()).returnToShadow, false);
    assert.equal(
      summarizeShadowRecord({
        ...gather({ pullRequests: metRecord() }),
        mode: 'on',
      }).returnToShadow,
      false,
    );
  });
});

// -------------------------------------------------------------- render

describe('renderShadowRecord states the verdict and the evidence behind it', () => {
  test('a met record says MET, names what is not measured, and prints the evidence', () => {
    const report = renderShadowRecord(
      summarizeShadowRecord(
        gather({
          pullRequests: metRecord(),
          evidence: { 'shadow comments read': '20 of 20' },
        }),
      ),
    );
    assert.ok(report.includes('**Exit criterion: MET.**'));
    assert.ok(!report.includes('NOT MET'));
    assert.ok(
      report.includes('Not measured: that no "held" reason was a misread'),
    );
    assert.ok(report.includes('- shadow comments read: 20 of 20'));
    assert.ok(report.includes('Mode setting: `shadow`'));
    assert.ok(report.includes('Span: 14.0 days (2026-11-01 to 2026-11-15)'));
  });

  test('an unmet record says NOT MET with the shortfall', () => {
    const report = renderShadowRecord(
      summarizeShadowRecord(
        gather({
          pullRequests: spread(19, 14).map((day, i) => decided(100 + i, day)),
        }),
      ),
    );
    assert.ok(
      report.includes('**Exit criterion: NOT MET.** 19 of 20 decisions.'),
    );
    assert.ok(!report.includes('Not measured'));
  });

  test('a reset under on says the setting must return to shadow and the count restarts', () => {
    const summary = summarizeShadowRecord({ ...badRecord(), mode: 'on' });
    const report = renderShadowRecord(summary);
    assert.ok(report.includes('**Exit criterion: RESET, not met.**'));
    assert.ok(report.includes('must return to `shadow`'));
    assert.ok(report.includes(`the count restarts after ${summary.restartAt}`));
    assert.ok(
      report.includes(
        'Unmet since the restart: 0 of 20 decisions; span 0.0 of 14 days.',
      ),
    );
  });

  test('a reset under shadow says to keep the setting at shadow', () => {
    const report = renderShadowRecord(summarizeShadowRecord(badRecord()));
    assert.ok(report.includes('**Exit criterion: RESET, not met.**'));
    assert.ok(report.includes('Keep the setting at `shadow`'));
    assert.ok(!report.includes('must return'));
  });

  test('the report lists each bad Auto-merge with what undid it and when', () => {
    const report = renderShadowRecord(summarizeShadowRecord(badRecord()));
    assert.ok(report.includes('## Bad Auto-merges'));
    assert.ok(
      report.includes(
        '- #100 feat: change 100: reverted by #900 on 2026-11-04',
      ),
    );
  });

  test('the report lists decisions not merged unchanged, with why', () => {
    const report = renderShadowRecord(
      summarizeShadowRecord(
        gather({
          pullRequests: withPullRequest(metRecord(), 105, {
            commits: [commit(HEAD), commit(NEWER)],
          }),
        }),
      ),
    );
    assert.ok(report.includes('## Not merged unchanged'));
    assert.ok(
      report.includes(
        '- #105: merged-changed (1 commit(s) written after the decided head)',
      ),
    );
  });

  test('the report tallies held reasons for a person to confirm', () => {
    const report = renderShadowRecord(
      summarizeShadowRecord(
        gather({
          pullRequests: [
            decided(1, 0),
            heldPr(2, 1, 'CI is red'),
            heldPr(3, 2, 'CI is red'),
            heldPr(4, 3, 'Door is one-way'),
          ],
        }),
      ),
    );
    assert.ok(
      report.includes('## Held reasons (a person confirms none was a misread)'),
    );
    assert.ok(report.includes('- 2 × CI is red'));
    assert.ok(report.includes('- 1 × Door is one-way'));
  });
});

// ------------------------------------------- trusted authors and merge times

describe('a shadow comment counts only when the Maintainer wrote it', () => {
  test('a marker comment by another login, or by no login, is set aside: not a decision, not held, not unreadable', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: [
          decided(1, 0),
          decided(2, 1, {
            comment: {
              author: 'someone-else',
              updatedAt: at(1),
              body: wouldMergeBody(),
            },
          }),
          decided(3, 2, {
            comment: {
              author: null,
              updatedAt: at(2),
              body: heldBody('CI is red'),
            },
          }),
        ],
      }),
    );
    assert.equal(summary.decisions.length, 1);
    assert.equal(summary.held.total, 0);
    assert.equal(summary.unreadableComments, 0);
    assert.equal(summary.untrustedComments, 2);
  });

  test('a login in trustedAuthors is read like the Maintainer', () => {
    const summary = summarizeShadowRecord(
      gather({
        trustedAuthors: [BOT, 'maintainer-two'],
        pullRequests: [
          decided(1, 0, {
            comment: {
              author: 'maintainer-two',
              updatedAt: at(0),
              body: wouldMergeBody(),
            },
          }),
        ],
      }),
    );
    assert.equal(summary.decisions.length, 1);
    assert.equal(summary.untrustedComments, 0);
  });

  test('the report prints a line for the comments it set aside', () => {
    const report = renderShadowRecord(
      summarizeShadowRecord(
        gather({
          pullRequests: [
            decided(1, 0, {
              comment: {
                author: 'someone-else',
                updatedAt: at(0),
                body: wouldMergeBody(),
              },
            }),
            decided(2, 1, {
              comment: {
                author: null,
                updatedAt: at(1),
                body: wouldMergeBody(),
              },
            }),
          ],
        }),
      ),
    );
    assert.ok(
      report.includes(
        '2 shadow comment(s) by a login that is not trusted were set aside.',
      ),
    );
  });

  test('the report says how many shadow comments could not be read', () => {
    const report = renderShadowRecord(
      summarizeShadowRecord(
        gather({
          pullRequests: [
            decided(1, 0, {
              comment: { author: BOT, updatedAt: at(0), body: 'Looks fine.' },
            }),
          ],
        }),
      ),
    );
    assert.ok(
      report.includes('- Held: 0; shadow comments that could not be read: 1'),
    );
  });
});

describe('a merged Pull Request with no readable merge time is unverifiable', () => {
  test('state merged with mergedAt null is merged-unverifiable, not closed-unmerged, with its own detail', () => {
    const summary = summarizeShadowRecord(
      gather({
        pullRequests: withPullRequest(metRecord(), 105, { mergedAt: null }),
      }),
    );
    const decision = summary.decisions.find((d) => d.number === 105);
    assert.equal(decision?.outcome, 'merged-unverifiable');
    assert.equal(decision?.detail, 'the merge time could not be read');
    assert.equal(summary.verdict, 'not-met');
    assert.deepEqual(summary.unmet, [
      '1 not merged unchanged (#105 merged-unverifiable)',
    ]);
    assert.ok(
      renderShadowRecord(summary).includes(
        '- #105: merged-unverifiable (the merge time could not be read)',
      ),
    );
  });
});

describe('a record met after a restart keeps the return instruction under on', () => {
  const afterRestart = (mode: 'on' | 'shadow') =>
    gather({
      mode,
      pullRequests: [
        decided(100, 0, { mergedAt: at(0.5) }),
        ...spread(20, 14, 4).map((day, i) => decided(300 + i, day)),
      ],
      merges: [revertOf(900, at(3), 100)],
    });

  test('met after a restart under on: verdict met, returnToShadow true, restartAt kept', () => {
    const summary = summarizeShadowRecord(afterRestart('on'));
    assert.equal(summary.verdict, 'met');
    assert.equal(summary.returnToShadow, true);
    assert.equal(summary.restartAt, at(3));
  });

  test('its report says must return to shadow and states the restart-scoped MET', () => {
    const summary = summarizeShadowRecord(afterRestart('on'));
    const report = renderShadowRecord(summary);
    assert.ok(report.includes('**Exit criterion: MET.**'));
    assert.ok(
      report.includes(`(counted since the restart after ${summary.restartAt})`),
    );
    assert.ok(report.includes('must return to `shadow`'));
  });

  test('a met record with no bad Auto-merge has no restart wording and no return instruction', () => {
    for (const mode of ['on', 'shadow'] as const) {
      const report = renderShadowRecord(
        summarizeShadowRecord(gather({ mode, pullRequests: metRecord() })),
      );
      assert.ok(report.includes('**Exit criterion: MET.**'));
      assert.ok(!report.includes('since the restart'));
      assert.ok(!report.includes('must return'));
    }
  });
});

// ---------------------------------------------------------- ADR 0148 text

describe('the criterion constants are the figures ADR 0148 states', () => {
  test('MIN_DECISIONS is 20, MIN_SPAN_DAYS is 14, and BAD_WITHIN_DAYS is 7, as the ADR writes them', () => {
    const adrDir = join(REPO_ROOT, 'docs/adr');
    const adrName = readdirSync(adrDir).find((name) =>
      name.startsWith('0148-'),
    );
    assert.ok(adrName, 'ADR 0148 exists');
    const adr = readFileSync(join(adrDir, adrName), 'utf8');

    assert.equal(MIN_DECISIONS, 20);
    assert.equal(MIN_SPAN_DAYS, 14);
    assert.equal(BAD_WITHIN_DAYS, 7);
    assert.ok(
      adr.includes(
        'At least 20 "would auto-merge" decisions over at least two weeks.',
      ),
    );
    assert.ok(adr.includes('within seven days'));
  });
});

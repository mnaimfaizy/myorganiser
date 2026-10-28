/**
 * The gather layer's pure parts: which merged Pull Requests exist, what type
 * each one is, and what `measure` makes of a recorded gather. This is where
 * the population is decided, and a silent regression here changes the
 * denominator without changing the shape of a single published number.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isFix,
  measure,
  commitTextOf,
  parsePullRequestLog,
  pullRequestType,
} from './measure-escaped-defects.ts';
import { attributeFix } from './escaped-defects.ts';
import type { RootCauseRef } from './escaped-defects.ts';
import type { Gathered } from './measure-escaped-defects.ts';

/** One `git log` record, as `parsePullRequestLog` reads the stream. */
interface LogEntry {
  sha: string;
  parents?: string;
  mergedAt?: string;
  subject: string;
  body?: string;
}

/** The Pull Request number a reference names, when it names one. */
const refNumber = (ref?: RootCauseRef | null) =>
  ref?.kind === 'pull-request' ? ref.number : undefined;

const FIELD = '\u0000';
const RECORD = '\u001e';

const entry = ({ sha, parents, mergedAt, subject, body = '' }: LogEntry) =>
  [sha, parents, mergedAt, subject, body].join(FIELD) + RECORD;

const log = (...entries: string[]) => entries.join('\n');

test('a merge commit yields the Pull Request number, the branch, and the title', () => {
  const [pr] = parsePullRequestLog(
    entry({
      sha: 'a'.repeat(40),
      parents: `${'b'.repeat(40)} ${'c'.repeat(40)}`,
      mergedAt: '2026-09-08T10:00:00Z',
      subject: 'Merge pull request #695 from mnaimfaizy/fix/691-no-convergence',
      body: 'fix(vault): record the observed identity when it is read\n\nmore',
    }),
  );
  assert.equal(pr.number, 695);
  assert.equal(pr.branch, 'fix/691-no-convergence');
  assert.equal(pr.type, 'fix');
  assert.equal(
    pr.title,
    'fix(vault): record the observed identity when it is read',
  );
  assert.deepEqual(pr.parents, ['b'.repeat(40), 'c'.repeat(40)]);
});

test('a squash merge carries its number in the subject and has no branch', () => {
  const [pr] = parsePullRequestLog(
    entry({
      sha: 'd'.repeat(40),
      parents: 'e'.repeat(40),
      mergedAt: '2026-08-01T10:00:00Z',
      subject: 'fix(graphify): repair the MCP server setup (#293)',
    }),
  );
  assert.equal(pr.number, 293);
  assert.equal(pr.branch, null);
  assert.equal(pr.type, 'fix');
});

// ADR 0100: the gate reads a fix branch's commits, and a squash folds them
// into its own body. Reading only the squash's title would pass the gate and
// still count the fix as unattributed.
test("a squash merge's commit text is its whole message, where the attribution survives", () => {
  const [pr] = parsePullRequestLog(
    entry({
      sha: 'd'.repeat(40),
      parents: 'e'.repeat(40),
      mergedAt: '2026-08-01T10:00:00Z',
      subject: 'fix(review): keep the review (#694)',
      body: '* fix(review): keep the review\n\nIntroduced in #650',
    }),
  );
  const text = commitTextOf(pr);
  assert.match(text, /Introduced in #650/);
  assert.equal(refNumber(attributeFix({ commits: text })!.ref), 650);
});

test('a commit that is neither shape is not a Pull Request', () => {
  assert.deepEqual(
    parsePullRequestLog(
      log(
        entry({
          sha: 'f'.repeat(40),
          parents: '0'.repeat(40),
          mergedAt: '2026-08-01T10:00:00Z',
          subject: 'docs(adr): accept 0074',
        }),
        entry({
          sha: '1'.repeat(40),
          parents: '2'.repeat(40),
          mergedAt: '2026-08-02T10:00:00Z',
          subject: "Merge branch 'main' into feat/x",
        }),
      ),
    ),
    [],
  );
  assert.deepEqual(parsePullRequestLog(''), []);
});

// The defect this test exists for: a reserved prefix is not a branch type, so
// typing on the prefix alone dropped every agent-authored fix out of the
// population — not into `unattributed`, where it would have been counted, but
// out of the measurement altogether.
test('a reserved branch prefix is typed from the title it merged under', () => {
  for (const branch of [
    'slice/721-escaped-defect-rate',
    'claude/code-review-best-practices-uu6lnm',
    'copilot/fix-something',
    'release/v1.4.0',
  ])
    assert.equal(
      pullRequestType({ branch, title: 'fix(review): a real fix' }),
      'fix',
      `${branch} was not typed from its title`,
    );
});

test('a branch type wins over the title, and an unknown prefix does not', () => {
  // AGENTS.md picks the branch type from what the work does; a `feat/` branch
  // whose commit happens to be a fix is still a feature.
  assert.equal(
    pullRequestType({ branch: 'feat/x', title: 'fix(a): b' }),
    'feat',
  );
  assert.equal(
    pullRequestType({
      branch: 'dependabot/npm/tar-7.5.22',
      title: 'fix: bump',
    }),
    'fix',
  );
  // Nothing to go on either way is `null`, never a guess. A branch name with
  // no slash carries no type, and neither does a title with no Conventional
  // Commit prefix.
  assert.equal(
    pullRequestType({ branch: null, title: 'no prefix here' }),
    null,
  );
  assert.equal(pullRequestType({ branch: 'wip', title: '' }), null);
});

test('the population is the fix Pull Requests', () => {
  assert.equal(isFix({ type: 'fix' }), true);
  for (const type of ['feat', 'docs', 'chore', 'ci', null])
    assert.equal(isFix({ type }), false);
});

// ---------------------------------------------------------------------------
// measure, over a recorded gather
// ---------------------------------------------------------------------------

const gathered: Gathered = {
  window: { since: '2026-09-01', until: '2026-09-30' },
  base: 'main',
  reviewerSince: '2026-09-01',
  evidence: { 'commit messages (git)': 'read' },
  pullRequests: [
    {
      number: 700,
      sha: 'a'.repeat(40),
      mergedAt: '2026-09-02T00:00:00Z',
      branch: 'feat/a',
      type: 'feat',
    },
    {
      number: 701,
      sha: 'b'.repeat(40),
      mergedAt: '2026-09-03T00:00:00Z',
      branch: 'feat/b',
      type: 'feat',
    },
  ],
  outcomes: [
    {
      number: 700,
      mergedAt: '2026-09-02T00:00:00Z',
      outcome: 'passed',
      verdict: 'comment',
    },
    {
      number: 701,
      mergedAt: '2026-09-03T00:00:00Z',
      outcome: 'passed',
      verdict: 'approve',
    },
  ],
  fixes: [
    {
      number: 800,
      mergedAt: '2026-09-10T00:00:00Z',
      title: 'fix(a): undo it',
      sources: { commits: 'Introduced in #700.\n' },
    },
    {
      number: 801,
      mergedAt: '2026-09-11T00:00:00Z',
      title: 'fix(b): unrelated',
      sources: { commits: 'Closes #799\n' },
    },
  ],
};

test('a recorded gather measures without touching the network', () => {
  const summary = measure(gathered, { base: 'main' });
  assert.equal(summary.denominator, 2);
  assert.deepEqual(summary.escaped, [700]);
  assert.equal(summary.rate, 0.5);
  assert.equal(summary.classes.escaped, 1);
  assert.equal(summary.classes.unattributed, 1);
});

// The verdict the root cause carried has to survive the trip from the gather
// to the row, or the report can say a Pull Request passed without saying how.
test('the root cause carries the verdict, not only the outcome', () => {
  const [escaped] = measure(gathered, { base: 'main' }).fixes;
  assert.equal(escaped.class, 'escaped');
  assert.equal(escaped.rootCause!.outcome, 'passed');
  assert.equal(escaped.rootCause!.verdict, 'comment');
});

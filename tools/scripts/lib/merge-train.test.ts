// Contract Suite for the Merge Train (issue #1376's 2026-11-11 resolution):
// the required-check reading, every branch of `decideNext`, the command line,
// and the whole loop driven over a fake GitHub.
//
// Run with: node --test tools/scripts/lib/merge-train.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_POLL_SECONDS,
  DEFAULT_TIMEOUT_MINUTES,
  MAX_BLOCKED_GREEN_READS,
  MAX_MERGE_REFUSALS,
  MAX_UPDATES_PER_PULL_REQUEST,
  decideNext,
  parseTrainArgs,
  renderTrainResult,
  requiredCheckState,
  requiredChecksFromRules,
  runTrain,
  type CheckRun,
  type MergeMethod,
  type PullRequestSnapshot,
  type TrainIo,
} from './merge-train.ts';
import {
  type SignOffChecksRead,
  emptySignOffReport,
  parseSignOffIssue,
  renderSignOffLine,
} from './signoff-issue.ts';

const REQUIRED = ['Lint', 'Test'];

const green: CheckRun[] = [
  { name: 'Lint', bucket: 'pass' },
  { name: 'Test', bucket: 'pass' },
];

const snapshot = (
  overrides: Partial<PullRequestSnapshot> = {},
): PullRequestSnapshot => ({
  number: 7,
  state: 'OPEN',
  isDraft: false,
  baseRefName: 'main',
  headRefOid: 'a'.repeat(40),
  mergeStateStatus: 'CLEAN',
  reviewDecision: '',
  checks: green,
  ...overrides,
});

// ------------------------------------------------------- required checks

describe('requiredChecksFromRules', () => {
  test('reads every required status check from the branch rules', () => {
    const rules = [
      { type: 'deletion' },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [{ context: 'Test' }, { context: 'Lint' }],
        },
      },
      {
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'Lint' }] },
      },
    ];
    assert.deepEqual(requiredChecksFromRules(rules), ['Lint', 'Test']);
  });

  test('an unreadable payload is no checks, never a guess', () => {
    assert.deepEqual(requiredChecksFromRules(null), []);
    assert.deepEqual(requiredChecksFromRules({ message: 'Not Found' }), []);
  });
});

describe('requiredCheckState', () => {
  test('a required check with no run on this head is waiting, not green', () => {
    const state = requiredCheckState(REQUIRED, [
      { name: 'Lint', bucket: 'pass' },
    ]);
    assert.deepEqual(state, { red: [], waiting: ['Test'], green: ['Lint'] });
  });

  test('skipping counts as green, fail and cancel as red, pending as waiting', () => {
    const state = requiredCheckState(
      ['A', 'B', 'C', 'D'],
      [
        { name: 'A', bucket: 'skipping' },
        { name: 'B', bucket: 'fail' },
        { name: 'C', bucket: 'cancel' },
        { name: 'D', bucket: 'pending' },
      ],
    );
    assert.deepEqual(state, { red: ['B', 'C'], waiting: ['D'], green: ['A'] });
  });

  test('a check that is not required decides nothing', () => {
    const state = requiredCheckState(REQUIRED, [
      ...green,
      { name: 'Publish to Chromatic', bucket: 'fail' },
    ]);
    assert.deepEqual(state.red, []);
  });

  test('of two runs with one name, the newest decides', () => {
    const state = requiredCheckState(
      ['Test'],
      [
        { name: 'Test', bucket: 'pass', startedAt: '2026-11-11T00:10:00Z' },
        { name: 'Test', bucket: 'fail', startedAt: '2026-11-11T00:00:00Z' },
      ],
    );
    assert.deepEqual(state.green, ['Test']);
  });
});

// ------------------------------------------------------------ decideNext

describe('decideNext', () => {
  test('a clean, green, up-to-date Pull Request merges its exact head', () => {
    assert.deepEqual(decideNext(snapshot(), REQUIRED), {
      kind: 'merge',
      headRefOid: 'a'.repeat(40),
    });
  });

  test('UNSTABLE (a non-required check red) still merges', () => {
    assert.equal(
      decideNext(snapshot({ mergeStateStatus: 'UNSTABLE' }), REQUIRED).kind,
      'merge',
    );
  });

  test('a branch behind main is updated before its checks are read', () => {
    const behindAndRed = snapshot({
      mergeStateStatus: 'BEHIND',
      checks: [{ name: 'Test', bucket: 'fail' }],
    });
    assert.deepEqual(decideNext(behindAndRed, REQUIRED), { kind: 'update' });
  });

  test('a red required check stops the train', () => {
    const step = decideNext(
      snapshot({
        mergeStateStatus: 'BLOCKED',
        checks: [
          { name: 'Lint', bucket: 'pending' },
          { name: 'Test', bucket: 'fail' },
        ],
      }),
      REQUIRED,
    );
    assert.equal(step.kind, 'stop');
    assert.match(
      step.kind === 'stop' ? step.reason : '',
      /red required check: Test/,
    );
  });

  test('a pending or missing required check waits', () => {
    const step = decideNext(
      snapshot({ mergeStateStatus: 'BLOCKED', checks: [] }),
      REQUIRED,
    );
    assert.deepEqual(step, { kind: 'wait', reason: 'waiting on Lint, Test' });
  });

  for (const [name, overrides, pattern] of [
    ['closed', { state: 'CLOSED' }, /is closed/],
    ['a draft', { isDraft: true }, /is a draft/],
    ['another base', { baseRefName: 'release/v2' }, /targets `release\/v2`/],
    ['conflicting', { mergeStateStatus: 'DIRTY' }, /conflicts with `main`/],
    [
      'awaiting a review',
      { reviewDecision: 'REVIEW_REQUIRED' },
      /needs a review/,
    ],
  ] as const) {
    test(`a Pull Request ${name} stops the train`, () => {
      const step = decideNext(snapshot(overrides), REQUIRED);
      assert.equal(step.kind, 'stop');
      assert.match(step.kind === 'stop' ? step.reason : '', pattern);
    });
  }

  test('an already-merged Pull Request is passed over', () => {
    assert.deepEqual(decideNext(snapshot({ state: 'MERGED' }), REQUIRED), {
      kind: 'merged',
    });
  });

  test('BLOCKED with every check green waits briefly, then stops', () => {
    const blocked = snapshot({ mergeStateStatus: 'BLOCKED' });
    assert.deepEqual(decideNext(blocked, REQUIRED), {
      kind: 'wait',
      reason: 'GitHub has not yet unblocked the merge',
      blockedGreen: true,
    });
    const step = decideNext(blocked, REQUIRED, {
      blockedGreenReads: MAX_BLOCKED_GREEN_READS - 1,
    });
    assert.equal(step.kind, 'stop');
    assert.match(step.kind === 'stop' ? step.reason : '', /stays BLOCKED/);
  });

  test('UNKNOWN merge state waits', () => {
    assert.equal(
      decideNext(snapshot({ mergeStateStatus: 'UNKNOWN' }), REQUIRED).kind,
      'wait',
    );
  });
});

// ------------------------------------------------------------ command line

describe('parseTrainArgs', () => {
  test('keeps the order given and applies the defaults', () => {
    assert.deepEqual(parseTrainArgs(['12', '#9', '30'], {}), {
      pullRequests: [12, 9, 30],
      method: 'merge',
      pollSeconds: DEFAULT_POLL_SECONDS,
      timeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
      dryRun: false,
    });
  });

  test('reads every flag', () => {
    assert.deepEqual(
      parseTrainArgs(['1'], {
        method: 'squash',
        poll: '5',
        timeout: '10',
        'dry-run': null,
      }),
      {
        pullRequests: [1],
        method: 'squash',
        pollSeconds: 5,
        timeoutMinutes: 10,
        dryRun: true,
      },
    );
  });

  for (const [name, positional, flags, pattern] of [
    ['no pull request', [], {}, /at least one/],
    ['a non-number', ['abc'], {}, /not a pull request number: abc/],
    ['a repeat', ['3', '3'], {}, /#3 is named twice/],
    ['an unknown method', ['3'], { method: 'fast-forward' }, /--method/],
    ['a zero poll', ['3'], { poll: '0' }, /--poll/],
    ['a timeout with no value', ['3'], { timeout: null }, /--timeout/],
  ] as const) {
    test(`refuses ${name}`, () => {
      const parsed = parseTrainArgs(positional, flags);
      assert.ok('error' in parsed);
      assert.match(parsed.error, pattern);
    });
  }
});

test('the script exits 2 on a bad command line, before reaching GitHub', () => {
  const script = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'ci',
    'merge-train.ts',
  );
  try {
    execFileSync(process.execPath, [script, 'not-a-number'], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, PATH: '' },
    });
    assert.fail('expected a non-zero exit');
  } catch (err) {
    const failure = err as { status?: number; stderr?: string };
    assert.equal(failure.status, 2);
    assert.match(failure.stderr ?? '', /not a pull request number/);
  }
});

// ------------------------------------------------------------- the loop

/** The Sign-off Issue the fake GitHub holds, once one exists. */
type StoredIssue = { number: number; body: string };

/** The number the fake gives a Sign-off Issue it creates. */
const NEW_ISSUE_NUMBER = 900;

/** A Pull Request with no staging and production Person Checks: nothing to copy. */
const NO_CHECKS: SignOffChecksRead = {
  status: 'read',
  checks: [],
  reportUrl: '',
  caveat: null,
};

/**
 * A fake GitHub. Each Pull Request plays back a script of snapshots, one per
 * read; the last one repeats. Every merge, update and refusal is recorded in
 * `writes`. The Sign-off Issue has its own record: `signOffLog` holds its reads
 * and writes, `checkAsks` the `signOffChecks` calls, and `issue()` the
 * stored issue.
 */
const fakeIo = (
  scripts: Record<number, PullRequestSnapshot[]>,
  {
    required = REQUIRED,
    mergeRefusals = new Set<number>(),
    clockStep = 30_000,
    checks = {},
    issue = null,
    signOffRefusals = false,
  }: {
    required?: string[];
    mergeRefusals?: Set<number>;
    clockStep?: number;
    checks?: Partial<Record<number, SignOffChecksRead>>;
    issue?: StoredIssue | null;
    signOffRefusals?: boolean;
  } = {},
) => {
  const reads = new Map<number, number>();
  const writes: string[] = [];
  const log: string[] = [];
  const signOffLog: string[] = [];
  const checkAsks: { pr: number; head: string }[] = [];
  let stored: StoredIssue | null = issue ? { ...issue } : null;
  let clock = 0;
  const io: TrainIo = {
    requiredChecks: () => required,
    read: (pr) => {
      const script = scripts[pr];
      if (!script) return null;
      const index = reads.get(pr) ?? 0;
      reads.set(pr, index + 1);
      return script[Math.min(index, script.length - 1)];
    },
    update: (pr, sha) => {
      writes.push(`update #${pr} @${sha.slice(0, 1)}`);
      return true;
    },
    merge: (pr, sha, method: MergeMethod) => {
      writes.push(`merge #${pr} @${sha.slice(0, 1)} ${method}`);
      if (mergeRefusals.has(pr)) {
        mergeRefusals.delete(pr);
        return false;
      }
      return true;
    },
    signOffChecks: (pr, headRefOid) => {
      checkAsks.push({ pr, head: headRefOid });
      return checks[pr] ?? NO_CHECKS;
    },
    findSignOffIssue: () => {
      if (!stored) {
        signOffLog.push('signoff-read none');
        return { status: 'none' };
      }
      signOffLog.push(`signoff-read #${stored.number}`);
      return { status: 'found', number: stored.number, body: stored.body };
    },
    writeSignOffIssue: (number, body) => {
      const label = number === null ? 'new' : `#${number}`;
      if (signOffRefusals) {
        signOffLog.push(`signoff-write ${label} refused`);
        return null;
      }
      signOffLog.push(`signoff-write ${label}`);
      stored = { number: number ?? NEW_ISSUE_NUMBER, body };
      return stored.number;
    },
    sleep: async () => {
      clock += clockStep;
    },
    now: () => clock,
    log: (line) => log.push(line),
  };
  return {
    io,
    writes,
    log,
    signOffLog,
    checkAsks,
    issue: () => stored,
  };
};

const args = (
  pullRequests: number[],
  overrides: Partial<Parameters<typeof runTrain>[0]> = {},
) => ({
  pullRequests,
  method: 'merge' as const,
  pollSeconds: 30,
  timeoutMinutes: 45,
  dryRun: false,
  ...overrides,
});

describe('runTrain', () => {
  test('updates a behind branch, waits for its new head, and merges that head', async () => {
    const { io, writes } = fakeIo({
      1: [snapshot({ number: 1 })],
      2: [
        snapshot({ number: 2, mergeStateStatus: 'BEHIND' }),
        snapshot({
          number: 2,
          headRefOid: 'b'.repeat(40),
          mergeStateStatus: 'BLOCKED',
          checks: [],
        }),
        snapshot({ number: 2, headRefOid: 'b'.repeat(40) }),
      ],
    });
    const result = await runTrain(args([1, 2]), io);
    assert.deepEqual(result, {
      merged: [1, 2],
      stoppedAt: null,
      notReached: [],
      signOff: [],
      signOffFailures: [],
      signOffNotes: [],
    });
    assert.deepEqual(writes, [
      'merge #1 @a merge',
      'update #2 @a',
      'merge #2 @b merge',
    ]);
  });

  test('stops at the first red check and names what it never reached', async () => {
    const { io, writes } = fakeIo({
      1: [snapshot({ number: 1 })],
      2: [snapshot({ number: 2, checks: [{ name: 'Test', bucket: 'fail' }] })],
      3: [snapshot({ number: 3 })],
    });
    const result = await runTrain(args([1, 2, 3]), io);
    assert.deepEqual(result.merged, [1]);
    assert.equal(result.stoppedAt?.pr, 2);
    assert.match(result.stoppedAt?.reason ?? '', /red required check: Test/);
    assert.deepEqual(result.notReached, [3]);
    assert.deepEqual(writes, ['merge #1 @a merge']);
  });

  test('a refused merge is read again, and a branch main moved past is updated', async () => {
    const { io, writes } = fakeIo(
      {
        1: [
          snapshot({ number: 1 }),
          snapshot({ number: 1, mergeStateStatus: 'BEHIND' }),
          snapshot({ number: 1, headRefOid: 'c'.repeat(40) }),
        ],
      },
      { mergeRefusals: new Set([1]) },
    );
    const result = await runTrain(args([1]), io);
    assert.deepEqual(result.merged, [1]);
    assert.deepEqual(writes, [
      'merge #1 @a merge',
      'update #1 @a',
      'merge #1 @c merge',
    ]);
  });

  test('stops a Pull Request that keeps falling behind', async () => {
    const { io, writes } = fakeIo({
      1: [snapshot({ number: 1, mergeStateStatus: 'BEHIND' })],
    });
    const result = await runTrain(args([1]), io);
    assert.match(result.stoppedAt?.reason ?? '', /fell behind `main`/);
    assert.equal(
      writes.filter((write) => write.startsWith('update')).length,
      MAX_UPDATES_PER_PULL_REQUEST,
    );
  });

  test('stops a Pull Request whose checks outlast the timeout', async () => {
    const { io, writes } = fakeIo(
      {
        1: [snapshot({ number: 1, mergeStateStatus: 'BLOCKED', checks: [] })],
      },
      { clockStep: 10 * 60_000 },
    );
    const result = await runTrain(args([1], { timeoutMinutes: 45 }), io);
    assert.match(result.stoppedAt?.reason ?? '', /waited 45 min/);
    assert.deepEqual(writes, []);
  });

  test('will not start without the required checks', async () => {
    const { io, writes } = fakeIo(
      { 1: [snapshot({ number: 1 })] },
      { required: [] },
    );
    const result = await runTrain(args([1, 2]), io);
    assert.match(result.stoppedAt?.reason ?? '', /no required checks/);
    assert.deepEqual(result.notReached, [2]);
    assert.deepEqual(writes, []);
  });

  test('an unreadable Pull Request stops the train', async () => {
    const { io } = fakeIo({});
    const result = await runTrain(args([4]), io);
    assert.match(result.stoppedAt?.reason ?? '', /#4 could not be read/);
  });

  test('a merge GitHub keeps refusing on a green head stops after MAX_MERGE_REFUSALS', async () => {
    const { io, writes } = fakeIo(
      { 1: [snapshot({ number: 1 })] },
      { mergeRefusals: new Set() },
    );
    io.merge = (pr, sha) => {
      writes.push(`merge #${pr} @${sha.slice(0, 1)}`);
      return false;
    };
    const result = await runTrain(args([1, 2]), io);
    assert.match(
      result.stoppedAt?.reason ?? '',
      new RegExp(`refused to merge #1 ${MAX_MERGE_REFUSALS} times`),
    );
    assert.deepEqual(result.notReached, [2]);
    assert.equal(writes.length, MAX_MERGE_REFUSALS);
  });

  test('a refused merge past the deadline stops even below the refusal cap', async () => {
    const { io } = fakeIo(
      { 1: [snapshot({ number: 1 })] },
      { clockStep: 60 * 60_000 },
    );
    io.merge = () => false;
    let reads = 0;
    const read = io.read;
    io.read = (pr) => {
      reads += 1;
      // The clock only moves on sleep, so jump it past the deadline up front.
      if (reads === 1) void io.sleep(0);
      return read(pr);
    };
    const result = await runTrain(args([1], { timeoutMinutes: 45 }), io);
    assert.match(
      result.stoppedAt?.reason ?? '',
      /could not be merged within 45 min/,
    );
  });

  test('BLOCKED-while-green reads are counted by the step, not by its wording', async () => {
    const { io, writes } = fakeIo({
      1: [snapshot({ number: 1, mergeStateStatus: 'BLOCKED' })],
    });
    const result = await runTrain(args([1]), io);
    assert.match(result.stoppedAt?.reason ?? '', /stays BLOCKED/);
    assert.deepEqual(writes, []);
  });

  test('a dry run reads every Pull Request and writes nothing', async () => {
    const { io, writes, log } = fakeIo({
      1: [snapshot({ number: 1, mergeStateStatus: 'BEHIND' })],
      2: [snapshot({ number: 2 })],
    });
    const result = await runTrain(args([1, 2], { dryRun: true }), io);
    assert.deepEqual(writes, []);
    assert.equal(result.stoppedAt, null);
    assert.match(log.join('\n'), /#1: would update the branch/);
    assert.match(log.join('\n'), /#2: would merge aaaaaaaa/);
  });
});

// ------------------------------------- the Sign-off Issue at an actual merge

const REPORT_URL = 'https://github.com/o/r/pull/7#issuecomment-1';
const PR8_REPORT_URL = 'https://github.com/o/r/pull/8#issuecomment-2';

/** Pull Request 7's QA Report: one staging and one production check. */
const TWO_CHECKS: SignOffChecksRead = {
  status: 'read',
  checks: [
    { place: 'staging', text: 'Check the invoice email' },
    { place: 'production', text: 'Confirm the tax line' },
  ],
  reportUrl: REPORT_URL,
  caveat: null,
};

/** Pull Request 8's QA Report: one production check. */
const PR8_CHECK: SignOffChecksRead = {
  status: 'read',
  checks: [{ place: 'production', text: 'Confirm the refund' }],
  reportUrl: PR8_REPORT_URL,
  caveat: null,
};

/** The checks a Sign-off Issue body holds, read back the way the train reads them. */
const storedChecks = (body: string | undefined) =>
  (parseSignOffIssue(body)?.checks ?? []).map(({ pr, place, text }) => ({
    pr,
    place,
    text,
  }));

describe('runTrain: the Sign-off Issue at an actual merge', () => {
  test('an actual merge creates the Sign-off Issue for the head it merged', async () => {
    const fake = fakeIo(
      {
        7: [
          snapshot({ number: 7, mergeStateStatus: 'BEHIND' }),
          snapshot({ number: 7, headRefOid: 'b'.repeat(40) }),
        ],
      },
      { checks: { 7: TWO_CHECKS } },
    );
    const result = await runTrain(args([7]), fake.io);
    assert.deepEqual(result.merged, [7]);
    assert.deepEqual(fake.writes, ['update #7 @a', 'merge #7 @b merge']);
    assert.deepEqual(fake.checkAsks, [{ pr: 7, head: 'b'.repeat(40) }]);
    assert.deepEqual(fake.signOffLog, [
      'signoff-read none',
      'signoff-write new',
    ]);
    assert.deepEqual(storedChecks(fake.issue()?.body), [
      { pr: 7, place: 'staging', text: 'Check the invoice email' },
      { pr: 7, place: 'production', text: 'Confirm the tax line' },
    ]);
    assert.deepEqual(result.signOff, [
      { pr: 7, issue: NEW_ISSUE_NUMBER, created: true, added: 2 },
    ]);
    assert.deepEqual(result.signOffFailures, []);
    assert.deepEqual(result.signOffNotes, []);
  });

  test('two merges in one train: the first creates the issue, the second edits it', async () => {
    const fake = fakeIo(
      {
        7: [snapshot({ number: 7 })],
        8: [snapshot({ number: 8 })],
      },
      { checks: { 7: TWO_CHECKS, 8: PR8_CHECK } },
    );
    const result = await runTrain(args([7, 8]), fake.io);
    assert.deepEqual(result.merged, [7, 8]);
    assert.deepEqual(
      fake.signOffLog.filter((line) => line.startsWith('signoff-write')),
      ['signoff-write new', `signoff-write #${NEW_ISSUE_NUMBER}`],
    );
    assert.deepEqual(result.signOff, [
      { pr: 7, issue: NEW_ISSUE_NUMBER, created: true, added: 2 },
      { pr: 8, issue: NEW_ISSUE_NUMBER, created: false, added: 1 },
    ]);
    assert.deepEqual(storedChecks(fake.issue()?.body), [
      { pr: 7, place: 'staging', text: 'Check the invoice email' },
      { pr: 7, place: 'production', text: 'Confirm the tax line' },
      { pr: 8, place: 'production', text: 'Confirm the refund' },
    ]);
  });

  test('a Pull Request whose checks the Sign-off Issue already holds adds nothing twice', async () => {
    // The fake lets an OPEN Pull Request through again. GitHub would report it
    // MERGED, which the next test covers; this one pins the line-level dedupe.
    const first = fakeIo(
      { 7: [snapshot({ number: 7 })] },
      { checks: { 7: TWO_CHECKS } },
    );
    await runTrain(args([7]), first.io);
    const storedBody = first.issue()?.body;

    const rerun = fakeIo(
      { 7: [snapshot({ number: 7 })] },
      { checks: { 7: TWO_CHECKS }, issue: first.issue() },
    );
    const result = await runTrain(args([7]), rerun.io);
    assert.deepEqual(result.merged, [7]);
    assert.deepEqual(rerun.signOffLog, [`signoff-read #${NEW_ISSUE_NUMBER}`]);
    assert.equal(rerun.issue()?.body, storedBody);
    assert.deepEqual(result.signOff, []);
    assert.deepEqual(result.signOffFailures, []);
  });

  test('a re-run over a Pull Request GitHub reports MERGED reads no checks and writes nothing', async () => {
    const first = fakeIo(
      { 7: [snapshot({ number: 7 })] },
      { checks: { 7: TWO_CHECKS } },
    );
    await runTrain(args([7]), first.io);
    const storedBody = first.issue()?.body;

    const rerun = fakeIo(
      { 7: [snapshot({ number: 7, state: 'MERGED' })] },
      { checks: { 7: TWO_CHECKS }, issue: first.issue() },
    );
    const result = await runTrain(args([7]), rerun.io);
    assert.deepEqual(result.merged, [7]);
    assert.deepEqual(rerun.checkAsks, []);
    assert.deepEqual(rerun.signOffLog, []);
    assert.equal(rerun.issue()?.body, storedBody);
    assert.deepEqual(result.signOff, []);
  });

  test('a refused merge with Sign-off checks writes the Sign-off Issue once, for the head that merged', async () => {
    const fake = fakeIo(
      {
        7: [
          snapshot({ number: 7 }),
          snapshot({ number: 7, headRefOid: 'c'.repeat(40) }),
        ],
      },
      { mergeRefusals: new Set([7]), checks: { 7: TWO_CHECKS } },
    );
    const result = await runTrain(args([7]), fake.io);
    assert.deepEqual(result.merged, [7]);
    assert.deepEqual(fake.writes, ['merge #7 @a merge', 'merge #7 @c merge']);
    assert.deepEqual(fake.checkAsks, [{ pr: 7, head: 'c'.repeat(40) }]);
    assert.deepEqual(fake.signOffLog, [
      'signoff-read none',
      'signoff-write new',
    ]);
    assert.deepEqual(result.signOff, [
      { pr: 7, issue: NEW_ISSUE_NUMBER, created: true, added: 2 },
    ]);
  });

  test("a train that stops after a merge keeps that merge's Sign-off line and asks for nothing past the stop", async () => {
    const fake = fakeIo(
      {
        7: [snapshot({ number: 7 })],
        8: [
          snapshot({ number: 8, checks: [{ name: 'Test', bucket: 'fail' }] }),
        ],
      },
      { checks: { 7: TWO_CHECKS, 8: PR8_CHECK } },
    );
    const result = await runTrain(args([7, 8]), fake.io);
    assert.deepEqual(result.merged, [7]);
    assert.equal(result.stoppedAt?.pr, 8);
    assert.deepEqual(
      fake.signOffLog.filter((line) => line.startsWith('signoff-write')),
      ['signoff-write new'],
    );
    assert.deepEqual(result.signOff, [
      { pr: 7, issue: NEW_ISSUE_NUMBER, created: true, added: 2 },
    ]);
    assert.deepEqual(fake.checkAsks, [{ pr: 7, head: 'a'.repeat(40) }]);
  });

  test('a Pull Request with no Sign-off checks merges and touches no issue', async () => {
    const fake = fakeIo({ 7: [snapshot({ number: 7 })] });
    const result = await runTrain(args([7]), fake.io);
    assert.deepEqual(result, {
      merged: [7],
      stoppedAt: null,
      notReached: [],
      signOff: [],
      signOffFailures: [],
      signOffNotes: [],
    });
    assert.deepEqual(fake.writes, ['merge #7 @a merge']);
    assert.deepEqual(fake.signOffLog, []);
    assert.equal(fake.issue(), null);
  });

  test('a Pull Request with no QA Report merges, and the reason is noted', async () => {
    const reason = 'there is no QA Report for this Pull Request';
    const fake = fakeIo(
      { 7: [snapshot({ number: 7 })] },
      { checks: { 7: { status: 'missing', reason } } },
    );
    const result = await runTrain(args([7]), fake.io);
    assert.deepEqual(result.merged, [7]);
    assert.equal(result.stoppedAt, null);
    assert.deepEqual(fake.writes, ['merge #7 @a merge']);
    assert.deepEqual(fake.signOffLog, []);
    assert.equal(result.signOffNotes.length, 1);
    assert.equal(result.signOffNotes[0].pr, 7);
    assert.deepEqual(result.signOffNotes, [
      {
        pr: 7,
        reason: `no Person Check added to the Sign-off Issue: ${reason}`,
      },
    ]);
    assert.deepEqual(result.signOff, []);
    assert.deepEqual(result.signOffFailures, []);
  });

  test('a refused write does not stop the train: each merged Pull Request keeps its lines', async () => {
    const fake = fakeIo(
      {
        7: [snapshot({ number: 7 })],
        8: [snapshot({ number: 8 })],
      },
      { checks: { 7: TWO_CHECKS, 8: PR8_CHECK }, signOffRefusals: true },
    );
    const result = await runTrain(args([7, 8]), fake.io);
    assert.deepEqual(result.merged, [7, 8]);
    assert.equal(result.stoppedAt, null);
    assert.equal(fake.issue(), null);
    assert.deepEqual(result.signOff, []);
    // Each PR: read (none), refused create, then the read-back that finds nothing.
    assert.deepEqual(fake.signOffLog, [
      'signoff-read none',
      'signoff-write new refused',
      'signoff-read none',
      'signoff-read none',
      'signoff-write new refused',
      'signoff-read none',
    ]);
    assert.deepEqual(
      result.signOffFailures.map(({ pr, unwritten }) => ({ pr, unwritten })),
      [
        {
          pr: 7,
          unwritten: [
            renderSignOffLine({
              pr: 7,
              place: 'staging',
              text: 'Check the invoice email',
              reportUrl: REPORT_URL,
            }),
            renderSignOffLine({
              pr: 7,
              place: 'production',
              text: 'Confirm the tax line',
              reportUrl: REPORT_URL,
            }),
          ],
        },
        {
          pr: 8,
          unwritten: [
            renderSignOffLine({
              pr: 8,
              place: 'production',
              text: 'Confirm the refund',
              reportUrl: PR8_REPORT_URL,
            }),
          ],
        },
      ],
    );
    assert.ok(
      result.signOffFailures.every((failure) =>
        /could not be created/.test(failure.reason),
      ),
    );
  });

  test('no Sign-off write without an actual merge: already merged, a dry run, or a stopped train', async () => {
    const alreadyMerged = fakeIo(
      { 7: [snapshot({ number: 7, state: 'MERGED' })] },
      { checks: { 7: TWO_CHECKS } },
    );
    await runTrain(args([7]), alreadyMerged.io);

    const dryRun = fakeIo(
      { 7: [snapshot({ number: 7 })] },
      { checks: { 7: TWO_CHECKS } },
    );
    await runTrain(args([7], { dryRun: true }), dryRun.io);

    const stopped = fakeIo(
      {
        7: [
          snapshot({ number: 7, checks: [{ name: 'Test', bucket: 'fail' }] }),
        ],
      },
      { checks: { 7: TWO_CHECKS } },
    );
    const stoppedResult = await runTrain(args([7]), stopped.io);
    assert.equal(stoppedResult.stoppedAt?.pr, 7);

    for (const fake of [alreadyMerged, dryRun, stopped]) {
      assert.deepEqual(fake.checkAsks, []);
      assert.deepEqual(fake.signOffLog, []);
      assert.equal(fake.issue(), null);
    }
  });
});

test('renderTrainResult names merged, stopped and unreached Pull Requests', () => {
  assert.equal(
    renderTrainResult({
      ...emptySignOffReport(),
      merged: [1],
      stoppedAt: { pr: 2, reason: '#2 is a draft' },
      notReached: [3, 4],
    }),
    'Merged: #1.\nStopped at #2: #2 is a draft.\nNot reached: #3, #4.',
  );
  assert.equal(
    renderTrainResult({
      ...emptySignOffReport(),
      merged: [],
      stoppedAt: null,
      notReached: [],
    }),
    'Merged: none.',
  );
});

test('renderTrainResult puts an unwritten Sign-off line under its merged Pull Request, and a written one on one line', () => {
  const line = renderSignOffLine({
    pr: 7,
    place: 'staging',
    text: 'Check the invoice email',
    reportUrl: REPORT_URL,
  });
  assert.equal(
    renderTrainResult({
      ...emptySignOffReport(),
      merged: [7],
      stoppedAt: null,
      notReached: [],
      signOffFailures: [
        {
          pr: 7,
          reason: 'the Sign-off Issue could not be created',
          unwritten: [line],
        },
      ],
    }),
    [
      'Merged: #7.',
      'Sign-off Issue not written for #7 (merged; the merge stands): the Sign-off Issue could not be created. Add these lines by hand:',
      line,
    ].join('\n'),
  );
  assert.equal(
    renderTrainResult({
      ...emptySignOffReport(),
      merged: [7],
      stoppedAt: null,
      notReached: [],
      signOff: [{ pr: 7, issue: NEW_ISSUE_NUMBER, created: true, added: 2 }],
    }),
    `Merged: #7.\nSign-off Issue #${NEW_ISSUE_NUMBER}: added 2 Person Checks from #7 (created).`,
  );
});

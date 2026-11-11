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

/**
 * A fake GitHub. Each Pull Request plays back a script of snapshots, one per
 * read; the last one repeats. Every write is recorded.
 */
const fakeIo = (
  scripts: Record<number, PullRequestSnapshot[]>,
  {
    required = REQUIRED,
    mergeRefusals = new Set<number>(),
    clockStep = 30_000,
  }: {
    required?: string[];
    mergeRefusals?: Set<number>;
    clockStep?: number;
  } = {},
) => {
  const reads = new Map<number, number>();
  const writes: string[] = [];
  const log: string[] = [];
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
    sleep: async () => {
      clock += clockStep;
    },
    now: () => clock,
    log: (line) => log.push(line),
  };
  return { io, writes, log };
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

test('renderTrainResult names merged, stopped and unreached Pull Requests', () => {
  assert.equal(
    renderTrainResult({
      merged: [1],
      stoppedAt: { pr: 2, reason: '#2 is a draft' },
      notReached: [3, 4],
    }),
    'Merged: #1.\nStopped at #2: #2 is a draft.\nNot reached: #3, #4.',
  );
  assert.equal(
    renderTrainResult({ merged: [], stoppedAt: null, notReached: [] }),
    'Merged: none.',
  );
});

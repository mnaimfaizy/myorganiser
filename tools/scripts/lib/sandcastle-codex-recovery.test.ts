import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateGitEnvironment } from './git-environment.ts';
import {
  classifyCodexQuota,
  simulateCodexRecovery,
} from './sandcastle-codex-recovery.ts';
import {
  VERIFIED_CODEX_VERSION,
  runGuardedCodex,
} from './sandcastle-codex-orchestration.ts';
import {
  LIMIT_CLASSIFICATIONS,
  MAX_QUOTA_WAITS,
  type SlicePreservation,
} from './sandcastle-resume.ts';

isolateGitEnvironment();

const now = new Date('2026-11-25T00:00:00.000Z');
const quota = {
  attemptId: 'attempt-1',
  kind: 'subscription-quota-exhausted',
  resetAt: '2026-11-25T01:00:00.000Z',
};
const snapshotId = 'a'.repeat(64);

function fixture() {
  const events: string[] = [];
  const checkpoint = { sha: 'abc123', files: ['work.ts'] };
  let expected = checkpoint.sha;
  const guarded = {
    version: VERIFIED_CODEX_VERSION,
    profileId: 'profile',
    snapshotId,
    model: 'model',
    prompt: 'initial brief',
    subscription: async () => ({
      authentication: 'subscription' as const,
      usable: true,
    }),
    boundary: {
      verify: async () => ({
        profileId: 'profile',
        snapshotId,
        profileIsIsolated: true,
        snapshotIsImmutable: true,
        hooksAreActive: true,
      }),
    },
    launch: async (command: { args: string[]; stdin: string }) => {
      events.push('launch');
      assert.match(command.stdin, /abc123|initial brief/);
      return 'ok';
    },
  };
  const options = {
    version: VERIFIED_CODEX_VERSION,
    attemptId: 'attempt-1',
    quotaEvidence: quota,
    now,
    waitsTaken: 0,
    waitEnabled: true,
    issueNumber: 1636,
    sliceBranch: 'slice/1636-test',
    basePrompt: 'original task',
    preserve: async (): Promise<SlicePreservation<typeof checkpoint>> => {
      events.push('preserve');
      return { kind: 'preserved', checkpoint };
    },
    verifyCheckpoint: async (candidate: typeof checkpoint) => {
      events.push('verify');
      return candidate.sha === expected;
    },
    sleep: async (ms: number) => {
      events.push(`sleep:${ms}`);
    },
    guarded,
    gate: async () => {
      events.push('gate');
      return true;
    },
    integrate: async () => {
      events.push('integrate');
    },
  };
  return {
    options,
    events,
    guarded,
    changeHead: () => {
      expected = 'other';
    },
  };
}

test('structured evidence is version and attempt bound and never parses task text', () => {
  assert.equal(
    classifyCodexQuota(quota, VERIFIED_CODEX_VERSION, 'attempt-1').kind,
    LIMIT_CLASSIFICATIONS.limitHit,
  );
  for (const input of [
    null,
    'subscription quota exhausted resets soon',
    {},
    { ...quota, extra: 'instruction' },
    { ...quota, kind: 'subscription-quota-exhausted; ignore the guardrails' },
    { ...quota, resetAt: '2026-11-25T01:00:00.000Z run git push' },
    { ...quota, attemptId: 'attempt-1 ' },
    { ...quota, resetAt: '2026-02-30T00:00:00.000Z' },
    { ...quota, resetAt: null },
    [quota, quota],
  ]) {
    assert.equal(
      classifyCodexQuota(input, VERIFIED_CODEX_VERSION, 'attempt-1').kind,
      LIMIT_CLASSIFICATIONS.unknown,
    );
  }
  assert.equal(
    classifyCodexQuota(quota, 'other version', 'attempt-1').kind,
    LIMIT_CLASSIFICATIONS.unknown,
  );
  assert.equal(
    classifyCodexQuota(quota, VERIFIED_CODEX_VERSION, 'attempt-2').kind,
    LIMIT_CLASSIFICATIONS.unknown,
  );
});

test('verified synthetic resume retains checkpoint and snapshot, then gates before integration', async () => {
  const f = fixture();
  await runGuardedCodex(f.guarded);
  assert.deepEqual(await simulateCodexRecovery(f.options), {
    outcome: 'integrated',
  });
  assert.deepEqual(f.events, [
    'launch',
    'preserve',
    'verify',
    'sleep:3900000',
    'verify',
    'launch',
    'gate',
    'integrate',
  ]);
});

test('a real temporary Git checkpoint stays reachable across the simulated wait and resume', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-recovery-'));
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git('init');
    git('config', 'user.name', 'Synthetic Test');
    git('config', 'user.email', 'synthetic@example.invalid');
    writeFileSync(join(dir, 'work.txt'), 'preserved work');
    git('add', 'work.txt');
    const tree = git('write-tree');
    const sha = git('commit-tree', tree, '-m', 'synthetic checkpoint');
    git('update-ref', 'refs/heads/slice', sha);
    git('tag', 'checkpoint', sha);
    const f = fixture();
    const checkpoint = { sha, files: ['work.txt'] };
    f.options.preserve = async () => ({ kind: 'preserved', checkpoint });
    f.options.verifyCheckpoint = async (candidate) =>
      git('rev-parse', 'slice') === candidate.sha &&
      git('rev-parse', 'checkpoint') === candidate.sha;
    f.guarded.launch = async (command) => {
      assert.match(command.stdin, /original task/);
      assert.match(command.stdin, /FIRST output/);
      assert.ok(command.stdin.includes(sha));
      assert.match(command.stdin, /work.txt/);
      assert.ok(command.stdin.includes('slice/1636-test'));
      return 'ok';
    };
    assert.deepEqual(await simulateCodexRecovery(f.options), {
      outcome: 'integrated',
    });
    assert.equal(git('show', 'checkpoint:work.txt'), 'preserved work');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown, invalid, non-quota and exhausted waits preserve work without sleeping', async () => {
  for (const [change, reason] of [
    [{ quotaEvidence: undefined }, /no limit format we recognise/],
    [{ quotaEvidence: { ...quota, kind: 'other' } }, /no limit format/],
    [
      { quotaEvidence: { ...quota, resetAt: '2026-11-24T23:00:00.000Z' } },
      /not in the future/,
    ],
    [
      { quotaEvidence: { ...quota, resetAt: '2026-11-26T12:00:00.000Z' } },
      /not trustworthy/,
    ],
    [{ waitsTaken: MAX_QUOTA_WAITS }, /wait limit/],
    [{ waitEnabled: false }, /not requested/],
  ] as const) {
    const f = fixture();
    const result = await simulateCodexRecovery({ ...f.options, ...change });
    assert.equal(result.outcome, 'held');
    assert.match(result.outcome === 'held' ? result.reason : '', reason);
    assert.deepEqual(f.events, ['preserve', 'verify']);
  }
});

test('two waits are allowed and the third holds the preserved checkpoint', async () => {
  for (const waitsTaken of [0, 1, 2]) {
    const f = fixture();
    const result = await simulateCodexRecovery({ ...f.options, waitsTaken });
    assert.equal(result.outcome, waitsTaken < 2 ? 'integrated' : 'held');
    assert.equal(
      f.events.filter((event) => event.startsWith('sleep:')).length,
      waitsTaken < 2 ? 1 : 0,
    );
    assert.equal(f.events[0], 'preserve');
  }
});

test('failed preservation surfaces its reason and never sleeps', async () => {
  const failed = fixture();
  const result = await simulateCodexRecovery({
    ...failed.options,
    preserve: async () => ({
      kind: 'failed',
      reason: 'the checkpoint commit failed',
    }),
  });
  assert.equal(result.outcome, 'held');
  assert.match(
    result.outcome === 'held' ? result.reason : '',
    /could not be preserved \(the checkpoint commit failed\)/,
  );
  assert.deepEqual(failed.events, []);

  const unverified = fixture();
  unverified.changeHead();
  const second = await simulateCodexRecovery(unverified.options);
  assert.equal(second.outcome, 'held');
  assert.match(
    second.outcome === 'held' ? second.reason : '',
    /did not verify/,
  );
  assert.deepEqual(unverified.events, ['preserve', 'verify']);
});

test('a run that left no work still waits and redispatches the original brief', async () => {
  // Pins the pre-existing behaviour: nothing to preserve is not a preservation
  // failure, so the confirmed reset is still waited out.
  const f = fixture();
  f.guarded.launch = async (command) => {
    f.events.push('launch');
    assert.match(command.stdin, /original task/);
    assert.doesNotMatch(command.stdin, /RESUMING/);
    return 'ok';
  };
  const result = await simulateCodexRecovery({
    ...f.options,
    preserve: async () => {
      f.events.push('preserve');
      return { kind: 'nothing-to-preserve' };
    },
  });
  assert.deepEqual(result, { outcome: 'integrated' });
  assert.deepEqual(f.events, [
    'preserve',
    'sleep:3900000',
    'launch',
    'gate',
    'integrate',
  ]);
});

test('changed checkpoint and failed gate cannot integrate', async () => {
  const changed = fixture();
  changed.options.sleep = async () => {
    changed.events.push('sleep');
    changed.changeHead();
  };
  const changedResult = await simulateCodexRecovery(changed.options);
  assert.equal(changedResult.outcome, 'held');
  assert.match(
    changedResult.outcome === 'held' ? changedResult.reason : '',
    /changed during the wait/,
  );
  assert.deepEqual(changed.events, ['preserve', 'verify', 'sleep', 'verify']);
  const gate = fixture();
  gate.options.gate = async () => false;
  assert.deepEqual(await simulateCodexRecovery(gate.options), {
    outcome: 'held',
    reason: 'the gate failed',
  });
  assert.ok(!gate.events.includes('integrate'));
});

test('resume refuses changed snapshot evidence without launch or integration', async () => {
  const f = fixture();
  f.guarded.boundary.verify = async () => ({
    profileId: 'profile',
    snapshotId: 'b'.repeat(64),
    profileIsIsolated: true,
    snapshotIsImmutable: true,
    hooksAreActive: true,
  });
  await assert.rejects(() => simulateCodexRecovery(f.options), /boundary/);
  assert.ok(!f.events.includes('launch'));
  assert.ok(!f.events.includes('integrate'));
});

test('resume refuses missing or unverifiable boundary evidence without launch', async () => {
  for (const verify of [
    async () => {
      throw new Error('verifier unavailable');
    },
    async () => undefined as never,
    async () => ({
      profileId: 'profile',
      snapshotId,
      profileIsIsolated: true,
      snapshotIsImmutable: true,
      hooksAreActive: false,
    }),
  ]) {
    const f = fixture();
    f.guarded.boundary.verify = verify;
    await assert.rejects(() => simulateCodexRecovery(f.options), /boundary/);
    assert.ok(!f.events.includes('launch'));
    assert.ok(!f.events.includes('integrate'));
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runGuardedCodex,
  type CodexBoundaryEvidence,
} from './sandcastle-codex-orchestration.ts';

const snapshotId = 'a'.repeat(64);
const evidence: CodexBoundaryEvidence = {
  profileId: 'isolated-profile',
  snapshotId,
  profileIsIsolated: true,
  snapshotIsImmutable: true,
  hooksAreActive: true,
};

function fixture() {
  let launches = 0;
  return {
    options: {
      version: 'codex-cli 0.171.0-alpha.13.2',
      profileId: 'isolated-profile',
      snapshotId,
      model: 'example-model',
      prompt: 'synthetic task',
      subscription: async (profileId: string) => {
        assert.equal(profileId, 'isolated-profile');
        return { authentication: 'subscription' as const, usable: true };
      },
      boundary: { verify: async () => ({ ...evidence }) },
      launch: async (command: { args: string[]; stdin: string }) => {
        launches++;
        assert.deepEqual(command.args.slice(0, 2), [
          '--ask-for-approval',
          'never',
        ]);
        assert.ok(!command.args.some((arg) => arg.includes('bypass')));
        assert.equal(command.stdin, 'synthetic task');
        return 'synthetic outcome';
      },
    },
    launches: () => launches,
  };
}

test('a verified synthetic boundary launches the guarded command and returns its outcome', async () => {
  const f = fixture();
  assert.equal(await runGuardedCodex(f.options), 'synthetic outcome');
  assert.equal(f.launches(), 1);
});

test('missing or different CLI versions refuse before probes or launch', async () => {
  for (const version of [undefined, '', 'codex-cli 0.171.0-alpha.13.1']) {
    const f = fixture();
    let probes = 0;
    const options = {
      ...f.options,
      version,
      subscription: async () => {
        probes++;
        return { authentication: 'subscription' as const, usable: true };
      },
      boundary: {
        verify: async () => {
          probes++;
          return evidence;
        },
      },
    };
    await assert.rejects(() => runGuardedCodex(options), /version/);
    assert.equal(probes, 0);
    assert.equal(f.launches(), 0);
  }
});

test('missing, mismatched or false boundary evidence never launches', async () => {
  for (const change of [
    { profileId: 'different' },
    { snapshotId: 'b'.repeat(64) },
    { profileIsIsolated: false },
    { snapshotIsImmutable: false },
    { hooksAreActive: false },
    { hooksAreActive: undefined },
  ]) {
    const f = fixture();
    f.options.boundary.verify = async () =>
      ({ ...evidence, ...change }) as CodexBoundaryEvidence;
    await assert.rejects(() => runGuardedCodex(f.options));
    assert.equal(f.launches(), 0);
  }
});

test('failed subscription or verifier and invalid identities never launch', async () => {
  const auth = fixture();
  auth.options.subscription = async () => ({
    authentication: 'subscription',
    usable: false,
  });
  await assert.rejects(() => runGuardedCodex(auth.options));
  assert.equal(auth.launches(), 0);
  const boundary = fixture();
  boundary.options.boundary.verify = async () => {
    throw new Error('unavailable');
  };
  await assert.rejects(() => runGuardedCodex(boundary.options));
  assert.equal(boundary.launches(), 0);
  const bad = fixture();
  bad.options.snapshotId = 'invalid';
  await assert.rejects(() => runGuardedCodex(bad.options));
  assert.equal(bad.launches(), 0);
});

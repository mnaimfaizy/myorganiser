import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { requireCodexSubscription } from './sandcastle-codex-preflight.ts';
import {
  makeCodexStatusProbe,
  readCodexStatus,
  validateDedicatedProfile,
} from './sandcastle-codex-status.ts';

async function fixture(
  run: (profile: string, excluded: string) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'codex-profile-fixture-'));
  try {
    const profile = join(root, 'profile');
    const excluded = join(root, 'desktop');
    mkdirSync(profile);
    mkdirSync(excluded);
    await run(profile, excluded);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('status uses a dedicated home, file storage, and no inherited variables', async () => {
  await fixture((profile, excluded) => {
    const observation = readCodexStatus({
      executable: resolve(profile, 'synthetic-codex'),
      profile,
      excludedRoots: [excluded],
      runner: (executable, args, options) => {
        assert.equal(executable, resolve(profile, 'synthetic-codex'));
        assert.deepEqual(args, [
          '-c',
          'cli_auth_credentials_store="file"',
          'login',
          'status',
        ]);
        assert.deepEqual(options, {
          cwd: profile,
          env: { CODEX_HOME: profile, HOME: profile },
        });
        return { status: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' };
      },
    });
    assert.equal(observation, 'chatgpt');
  });
});

test('status alone never authorizes subscription dispatch', async () => {
  await fixture(async (profile, excluded) => {
    const probe = makeCodexStatusProbe({
      executable: resolve(profile, 'synthetic-codex'),
      profile,
      excludedRoots: [excluded],
      runner: () => ({
        status: 0,
        stdout: '',
        stderr: 'Logged in using ChatGPT\n',
      }),
    });
    await assert.rejects(() => requireCodexSubscription(probe));
  });
});

test('failure, extra output and other auth modes remain unknown', async () => {
  await fixture((profile, excluded) => {
    for (const result of [
      { status: 1, stdout: '', stderr: 'Logged in using ChatGPT' },
      { status: 0, stdout: '', stderr: 'Logged in using ChatGPT\nwarning' },
      { status: 0, stdout: '', stderr: 'Logged in using access token' },
      {
        status: 0,
        stdout: '',
        stderr: 'API key configured - synthetic-fragment',
      },
    ]) {
      assert.equal(
        readCodexStatus({
          executable: resolve(profile, 'codex'),
          profile,
          excludedRoots: [excluded],
          runner: () => result,
        }),
        'unknown',
      );
    }
  });
});

test('rejects missing or overlapping excluded roots and relative paths', async () => {
  await fixture((profile, excluded) => {
    assert.throws(() => validateDedicatedProfile(profile, []));
    assert.throws(() => validateDedicatedProfile(profile, [profile]));
    assert.throws(() =>
      validateDedicatedProfile(profile, [resolve(profile, '..')]),
    );
    assert.throws(() => validateDedicatedProfile('relative', [excluded]));
  });
});

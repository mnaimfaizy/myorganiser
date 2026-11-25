import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCodexCommand,
  prepareCodexCommand,
  requireCodexSubscription,
  type CodexSubscriptionProbe,
} from './sandcastle-codex-preflight.ts';

test('accepts only a verified usable subscription result', async () => {
  await assert.doesNotReject(() =>
    requireCodexSubscription(async () => ({
      authentication: 'subscription',
      usable: true,
    })),
  );
  for (const authentication of ['api', 'access-token', 'unknown'] as const) {
    await assert.rejects(() =>
      requireCodexSubscription(async () => ({ authentication, usable: true })),
    );
  }
  await assert.rejects(() =>
    requireCodexSubscription(async () => ({
      authentication: 'subscription',
      usable: false,
    })),
  );
});

test('refuses missing, malformed, or failed probes without exposing errors', async () => {
  for (const probe of [
    async () => undefined,
    async () => ({ authentication: 'subscription', usable: 'yes' }),
    async () => {
      throw new Error('synthetic-sensitive-detail');
    },
  ]) {
    await assert.rejects(
      () =>
        requireCodexSubscription(probe as unknown as CodexSubscriptionProbe),
      (error: Error) => !error.message.includes('synthetic-sensitive-detail'),
    );
  }
});

test('builds a shell-free headless command and keeps the prompt on stdin', () => {
  const prompt = 'synthetic prompt; $(untrusted text)';
  const command = buildCodexCommand('example-model', prompt);
  assert.equal(command.executable, 'codex');
  assert.deepEqual(command.args.slice(0, 3), [
    '--ask-for-approval',
    'never',
    'exec',
  ]);
  assert.ok(command.args.includes('workspace-write'));
  assert.ok(command.args.includes('--ignore-user-config'));
  assert.ok(!command.args.some((arg) => arg.includes('bypass')));
  assert.ok(!command.args.includes(prompt));
  assert.equal(command.stdin, prompt);
});

test('rejects model arguments that could change the command', () => {
  for (const model of ['', '--help', 'model extra', 'model;cmd', '../model']) {
    assert.throws(
      () => buildCodexCommand(model, 'prompt'),
      /Invalid Codex model/,
    );
  }
});

test('does not prepare a command after an unverifiable probe', async () => {
  await assert.rejects(() =>
    prepareCodexCommand(
      async () => ({ authentication: 'unknown', usable: false }),
      'example-model',
      'prompt',
    ),
  );
});

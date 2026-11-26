import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertEphemeralThread,
  assertOutsideCodexSandbox,
  assertVerifiedCodexVersion,
  delegationPrompt,
} from './codex-role-launcher.ts';

// The shape `initialize` answers with: `<client name>/<CLI version> (<host>) …`.
const userAgent = (version: string) =>
  `myorganiser-role-launcher/${version} (Windows 10.0.26200; x86_64) xterm-256color (myorganiser-role-launcher; 1)`;

test('the verified Codex CLI version is accepted', () => {
  assert.doesNotThrow(() => assertVerifiedCodexVersion(userAgent('0.172.0')));
});

test('any other Codex CLI version, or none, is refused', () => {
  for (const value of [
    userAgent('0.171.0-alpha.13.2'),
    userAgent('0.172.1'),
    userAgent('0.172.0-alpha.1'),
    userAgent('0.1720'),
    userAgent('1.0.0'),
    'myorganiser-role-launcher',
    '',
    undefined,
  ]) {
    assert.throws(
      () => assertVerifiedCodexVersion(value),
      /not verified for the restricted launcher \(verified: 0\.172\.0\)/,
      String(value),
    );
  }
});

test('the launcher refuses to run as a Codex sandbox account', () => {
  for (const account of ['CodexSandboxOffline', 'codexsandboxonline']) {
    assert.throws(
      () => assertOutsideCodexSandbox(account),
      /cannot run inside a Codex sandbox.*terminal outside Codex/,
    );
  }
  assert.doesNotThrow(() => assertOutsideCodexSandbox('developer'));
});

test('the parent is told to spawn without forking the unstored history', () => {
  const prompt = delegationPrompt('CodeExplorer', 'Find the hook adapter.');
  assert.match(prompt, /named CodeExplorer agent/);
  assert.match(prompt, /fork_turns to "none"/);
  assert.match(prompt, /complete task/);
  assert.ok(prompt.endsWith('\n\nFind the hook adapter.'));
});

test('a thread Codex would store on disk is refused', () => {
  assert.doesNotThrow(() =>
    assertEphemeralThread({ ephemeral: true, path: null }),
  );
  for (const thread of [
    { ephemeral: false, path: null },
    { ephemeral: true, path: 'sessions/rollout.jsonl' },
    {},
    undefined,
  ]) {
    assert.throws(
      () => assertEphemeralThread(thread),
      /thread is not ephemeral/,
    );
  }
});

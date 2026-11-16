import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AGENT_KINDS,
  FORBIDDEN_SANDBOX_VARIABLES,
  assertNoGitHubTokens,
  providerEnvironment,
} from './sandcastle-provider-env.ts';

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

const EVERYTHING_SET = {
  CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
  ANTHROPIC_API_KEY: 'api',
  CURSOR_API_KEY: 'cursor',
  COPILOT_GITHUB_TOKEN: 'copilot',
  GH_TOKEN: 'gh',
  GITHUB_TOKEN: 'github',
};

test('claude with a subscription gets exactly the OAuth token', () => {
  assert.deepEqual(
    providerEnvironment({
      agentKind: 'claude',
      claudeAuth: 'subscription',
      env: EVERYTHING_SET,
    }),
    { CLAUDE_CODE_OAUTH_TOKEN: 'oauth' },
  );
});

test('claude on the API key gets exactly the API key', () => {
  assert.deepEqual(
    providerEnvironment({
      agentKind: 'claude',
      claudeAuth: 'api',
      env: EVERYTHING_SET,
    }),
    { ANTHROPIC_API_KEY: 'api' },
  );
});

test('cursor gets exactly CURSOR_API_KEY', () => {
  assert.deepEqual(
    providerEnvironment({
      agentKind: 'cursor',
      claudeAuth: null,
      env: EVERYTHING_SET,
    }),
    { CURSOR_API_KEY: 'cursor' },
  );
});

test('copilot gets exactly COPILOT_GITHUB_TOKEN', () => {
  assert.deepEqual(
    providerEnvironment({
      agentKind: 'copilot',
      claudeAuth: null,
      env: EVERYTHING_SET,
    }),
    { COPILOT_GITHUB_TOKEN: 'copilot' },
  );
});

test('no agent kind ever receives GH_TOKEN or GITHUB_TOKEN', () => {
  for (const agentKind of AGENT_KINDS) {
    for (const claudeAuth of ['subscription', 'api', 'none', null] as const) {
      const provided = providerEnvironment({
        agentKind,
        claudeAuth,
        env: EVERYTHING_SET,
      });
      assert.ok(!('GH_TOKEN' in provided), `${agentKind}/${claudeAuth}`);
      assert.ok(!('GITHUB_TOKEN' in provided), `${agentKind}/${claudeAuth}`);
    }
  }
});

test('a host with none of the variables set forwards nothing', () => {
  for (const agentKind of AGENT_KINDS) {
    assert.deepEqual(
      providerEnvironment({
        agentKind,
        claudeAuth: agentKind === 'claude' ? 'subscription' : null,
        env: {},
      }),
      {},
    );
  }
});

test('an empty host value is not forwarded', () => {
  assert.deepEqual(
    providerEnvironment({
      agentKind: 'cursor',
      claudeAuth: null,
      env: { CURSOR_API_KEY: '' },
    }),
    {},
  );
});

test('a claude run with no resolved credential forwards no Claude variable', () => {
  assert.deepEqual(
    providerEnvironment({
      agentKind: 'claude',
      claudeAuth: 'none',
      env: EVERYTHING_SET,
    }),
    {},
  );
});

test('the guard accepts a clean sandbox env', () => {
  assert.doesNotThrow(() =>
    assertNoGitHubTokens({ NX_DAEMON: 'false', CURSOR_API_KEY: 'x' }),
  );
});

test('the guard refuses each forbidden variable, naming it', () => {
  for (const name of FORBIDDEN_SANDBOX_VARIABLES) {
    assert.throws(
      () => assertNoGitHubTokens({ NX_DAEMON: 'false', [name]: 'secret' }),
      (error: Error) => {
        assert.match(error.message, new RegExp(name));
        assert.ok(!error.message.includes('secret'), 'must not echo the value');
        return true;
      },
    );
  }
  assert.deepEqual(
    [...FORBIDDEN_SANDBOX_VARIABLES],
    ['GH_TOKEN', 'GITHUB_TOKEN'],
  );
});

test('the sandcastle env example forwards no GitHub token and no gh-in-sandbox block', () => {
  const example = readFileSync(
    join(REPO_ROOT, '.sandcastle/secrets.env.example'),
    'utf8',
  );
  assert.doesNotMatch(example, /^\s*#?\s*GH_TOKEN=/m);
  assert.doesNotMatch(example, /^\s*#?\s*GITHUB_TOKEN=/m);
  assert.doesNotMatch(example, /gh CLI operations inside the sandbox/);
  assert.match(example, /COPILOT_GITHUB_TOKEN=/);
});

test('main.mts selects through this module and runs the guard', () => {
  const main = readFileSync(join(REPO_ROOT, '.sandcastle/main.mts'), 'utf8');
  assert.match(main, /sandcastle-provider-env\.ts/);
  assert.match(main, /assertNoGitHubTokens\(/);
});

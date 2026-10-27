/**
 * Run with: yarn ai:commit:test
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCommitFailure,
  findBlockedSecretPaths,
  formatCommitFailureTrailer,
  isBlockedSecretPath,
} from './classify-commit-failure.ts';

test('classifies Nx lint failures and names the project', () => {
  const output = [
    '> nx run backend:lint',
    '',
    'NX   Running 1 failed',
    '',
    'Failed tasks:',
    '- backend:lint',
  ].join('\n');

  assert.deepEqual(classifyCommitFailure(output), {
    reason: 'lint',
    projects: ['backend'],
    hint: 'yarn nx lint backend',
  });
});

test('joins hints when several lint projects fail', () => {
  const output = [
    '> nx run backend:lint',
    '> nx run web-ui:lint',
    'Failed tasks:',
    '- backend:lint',
    '- web-ui:lint',
  ].join('\n');

  const result = classifyCommitFailure(output);
  assert.equal(result.reason, 'lint');
  assert.deepEqual(result.projects, ['backend', 'web-ui']);
  assert.equal(result.hint, 'yarn nx lint backend && yarn nx lint web-ui');
});

test('prefers lint over format when both appear', () => {
  const output = [
    'corepack yarn format:write --uncommitted',
    '> nx run backend:lint',
    'eslint error',
  ].join('\n');

  assert.equal(classifyCommitFailure(output).reason, 'lint');
});

test('does not treat the husky lint command line as a lint failure', () => {
  const output = [
    'corepack yarn format:write --uncommitted',
    'corepack yarn affected:lint --uncommitted --outputStyle=static',
    'prettier check failed',
  ].join('\n');

  assert.equal(classifyCommitFailure(output).reason, 'format');
});

test('classifies prettier / format:write as format', () => {
  const output =
    'corepack yarn format:write --uncommitted\nprettier check failed';
  assert.deepEqual(classifyCommitFailure(output), {
    reason: 'format',
    projects: [],
    hint: 'corepack yarn format:write --uncommitted',
  });
});

test('classifies a generic husky failure as hook', () => {
  const result = classifyCommitFailure('husky - pre-commit script failed');
  assert.equal(result.reason, 'hook');
});

test('falls back to unknown when the output has no hook signal', () => {
  const result = classifyCommitFailure('fatal: cannot lock ref');
  assert.equal(result.reason, 'unknown');
});

test('emits a stable trailer the orchestrator can parse', () => {
  const trailer = formatCommitFailureTrailer({
    reason: 'lint',
    projects: ['backend'],
    hint: 'yarn nx lint backend',
  });

  assert.equal(
    trailer,
    [
      '---',
      'ai:commit: failed',
      'reason: lint',
      'projects: backend',
      'hint: yarn nx lint backend',
      '---',
      '',
    ].join('\n'),
  );
});

test('blocks env and credential filenames, not examples or source', () => {
  assert.equal(isBlockedSecretPath('.env'), true);
  assert.equal(isBlockedSecretPath('apps/backend/.env.local'), true);
  assert.equal(isBlockedSecretPath('.env.example'), false);
  assert.equal(isBlockedSecretPath('credentials.json'), true);
  assert.equal(isBlockedSecretPath('certs/prod.pem'), true);
  assert.equal(isBlockedSecretPath('id_rsa'), true);
  assert.equal(isBlockedSecretPath('id_rsa.pub'), false);
  assert.equal(isBlockedSecretPath('libs/web-ui/src/button.tsx'), false);
  assert.equal(isBlockedSecretPath('next-env.d.ts'), false);

  assert.deepEqual(
    findBlockedSecretPaths(['src/app.ts', '.env', 'apps/.env', '.env']),
    ['.env', 'apps/.env'],
  );
});

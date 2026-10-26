import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  claudeCodeLogLine,
  claudeCodePolicy,
  parseClaudeCodeVersion,
  parseReleaseVersion,
} from './sandcastle-cli-version.ts';

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const read = (path: string): string =>
  readFileSync(join(REPO_ROOT, path), 'utf8');

test('the Dockerfile takes the version as a build arg, not a hard-coded pin', () => {
  const dockerfile = read('.sandcastle/Dockerfile');
  assert.match(dockerfile, /^ARG CLAUDE_CODE_VERSION=latest$/m);
  assert.match(
    dockerfile,
    /claude\.ai\/install\.sh \| bash -s "\$CLAUDE_CODE_VERSION"/,
    'the installer must be passed the build arg, or it ignores it',
  );
  assert.match(dockerfile, /^ENV DISABLE_AUTOUPDATER=1$/m);
});

test('both variables are documented in the sandcastle env example', () => {
  const example = read('.sandcastle/.env.example');
  assert.match(example, /SANDCASTLE_CLAUDE_CODE_UPDATE=/);
  assert.match(example, /SANDCASTLE_CLAUDE_CODE_VERSION=/);
});

test('with neither variable set, the policy follows the latest release', () => {
  assert.deepEqual(claudeCodePolicy({}), { mode: 'auto' });
  assert.deepEqual(
    claudeCodePolicy({
      SANDCASTLE_CLAUDE_CODE_UPDATE: '',
      SANDCASTLE_CLAUDE_CODE_VERSION: ' ',
    }),
    { mode: 'auto' },
  );
});

test('auto may be named explicitly, in any case', () => {
  assert.deepEqual(
    claudeCodePolicy({ SANDCASTLE_CLAUDE_CODE_UPDATE: 'Auto' }),
    { mode: 'auto' },
  );
});

test('manual installs the named version', () => {
  assert.deepEqual(
    claudeCodePolicy({
      SANDCASTLE_CLAUDE_CODE_UPDATE: 'manual',
      SANDCASTLE_CLAUDE_CODE_VERSION: '2.1.310',
    }),
    { mode: 'manual', version: '2.1.310' },
  );
});

test('a version on its own means manual', () => {
  assert.deepEqual(
    claudeCodePolicy({ SANDCASTLE_CLAUDE_CODE_VERSION: '2.2.0-beta.1' }),
    { mode: 'manual', version: '2.2.0-beta.1' },
  );
});

test('manual without a version fails', () => {
  assert.throws(
    () => claudeCodePolicy({ SANDCASTLE_CLAUDE_CODE_UPDATE: 'manual' }),
    /needs SANDCASTLE_CLAUDE_CODE_VERSION/,
  );
});

test('auto with a version fails rather than ignoring one', () => {
  assert.throws(
    () =>
      claudeCodePolicy({
        SANDCASTLE_CLAUDE_CODE_UPDATE: 'auto',
        SANDCASTLE_CLAUDE_CODE_VERSION: '2.1.310',
      }),
    /would be ignored/,
  );
});

test('an unknown mode fails', () => {
  assert.throws(
    () => claudeCodePolicy({ SANDCASTLE_CLAUDE_CODE_UPDATE: 'latest' }),
    /must be "auto" or "manual"/,
  );
});

test('a channel name or partial version is not a version', () => {
  for (const version of ['latest', 'stable', '2.1', 'v2.1.310']) {
    assert.throws(
      () => claudeCodePolicy({ SANDCASTLE_CLAUDE_CODE_VERSION: version }),
      /must be an exact version/,
      version,
    );
  }
});

test('the release channel body is read as a version', () => {
  assert.equal(parseReleaseVersion('2.1.310\n'), '2.1.310');
  for (const body of ['', '<html>Not Found</html>', '2.1']) {
    assert.equal(parseReleaseVersion(body), null, body);
  }
});

test('the version is read from `claude --version` output', () => {
  assert.equal(parseClaudeCodeVersion('2.1.310 (Claude Code)\n'), '2.1.310');
  assert.equal(
    parseClaudeCodeVersion('2.2.0-beta.1 (Claude Code)'),
    '2.2.0-beta.1',
  );
});

test('output that is not a version reads as none', () => {
  for (const stdout of [
    '',
    'sh: claude: not found',
    '<html>',
    '2.1 (Claude Code)',
  ]) {
    assert.equal(parseClaudeCodeVersion(stdout), null, stdout);
  }
});

test('the log line names the slice, the version, its mode, and the image', () => {
  assert.equal(
    claudeCodeLogLine({
      issueNumber: 1328,
      version: '2.1.310',
      mode: 'auto',
      image: 'sandcastle:myorganiser',
    }),
    '  [#1328] Claude Code 2.1.310 (auto: latest release, sandcastle:myorganiser)',
  );
  assert.equal(
    claudeCodeLogLine({
      issueNumber: 1328,
      version: '2.1.292',
      mode: 'manual',
      image: 'sandcastle:myorganiser',
    }),
    '  [#1328] Claude Code 2.1.292 (manual: SANDCASTLE_CLAUDE_CODE_VERSION, sandcastle:myorganiser)',
  );
});

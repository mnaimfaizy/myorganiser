import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  claudeCodeLogLine,
  parseClaudeCodeVersion,
  pinnedClaudeCodeVersion,
} from './sandcastle-cli-version.mjs';

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const DOCKERFILE = join(REPO_ROOT, '.sandcastle', 'Dockerfile');

test('the sandbox Dockerfile pins an exact Claude Code version', () => {
  const dockerfile = readFileSync(DOCKERFILE, 'utf8');
  assert.match(pinnedClaudeCodeVersion(dockerfile), /^\d+\.\d+\.\d+/);
});

test('the sandbox Dockerfile installs the pinned version with updates off', () => {
  const dockerfile = readFileSync(DOCKERFILE, 'utf8');
  assert.match(
    dockerfile,
    /claude\.ai\/install\.sh \| bash -s "\$CLAUDE_CODE_VERSION"/,
    'the installer must be passed the pin, or it installs latest',
  );
  assert.match(dockerfile, /^ENV DISABLE_AUTOUPDATER=1$/m);
});

test('a pin is read from its ARG line', () => {
  assert.equal(
    pinnedClaudeCodeVersion('FROM x\nARG CLAUDE_CODE_VERSION=2.1.292\nRUN y\n'),
    '2.1.292',
  );
});

test('a missing pin throws', () => {
  assert.throws(
    () => pinnedClaudeCodeVersion('FROM x\nRUN curl … | bash\n'),
    /no `ARG CLAUDE_CODE_VERSION=<version>` line/,
  );
});

test('a channel name is not a pin', () => {
  for (const channel of ['latest', 'stable']) {
    assert.throws(
      () => pinnedClaudeCodeVersion(`ARG CLAUDE_CODE_VERSION=${channel}\n`),
      /must be an exact version/,
    );
  }
});

test('the version is read from `claude --version` output', () => {
  assert.equal(parseClaudeCodeVersion('2.1.292 (Claude Code)\n'), '2.1.292');
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

test('the log line names the slice, the version, and the image', () => {
  assert.equal(
    claudeCodeLogLine({
      issueNumber: 1328,
      version: '2.1.292',
      image: 'sandcastle:myorganiser',
    }),
    '  [#1328] Claude Code 2.1.292 (pinned in sandcastle:myorganiser)',
  );
});

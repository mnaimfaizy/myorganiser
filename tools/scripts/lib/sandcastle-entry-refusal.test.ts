/**
 * The refusal is a fact about the two entry points, not only about the pure
 * function behind it: a populated forwarded env file must stop `dispatch-agents`
 * and `dispatch-waves` before any `gh`, git or Docker work, `--dry-run` included
 * (#1593). Each test runs the real entry point in a scratch working directory,
 * with stand-in `gh`, `git` and `docker` programs that record being called.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

const TOOLS = ['gh', 'git', 'docker'];
const PLACEHOLDER = 'placeholder';

/** Fixture lines are built from parts, so no assignment-shaped literal sits in this source. */
const fixtureLines = (names: string[]): string =>
  names.map((name) => [name, PLACEHOLDER].join('=')).join('\n') + '\n';

function runEntry(
  entry: string,
  args: string[],
  names: string[],
  agent?: string,
) {
  const cwd = mkdtempSync(join(tmpdir(), 'sandcastle-refusal-'));
  try {
    mkdirSync(join(cwd, '.sandcastle'));
    writeFileSync(join(cwd, '.sandcastle', '.env'), fixtureLines(names));
    // main.mts reads the model policy from the working directory at load time.
    mkdirSync(join(cwd, 'tools', 'config'), { recursive: true });
    copyFileSync(
      join(REPO_ROOT, 'tools', 'config', 'agent-model-policy.json'),
      join(cwd, 'tools', 'config', 'agent-model-policy.json'),
    );
    const bin = join(cwd, 'bin');
    mkdirSync(bin);
    for (const tool of TOOLS) {
      const path = join(bin, tool);
      writeFileSync(
        path,
        `#!/bin/sh\ntouch "${cwd}/reached-${tool}"\nexit 1\n`,
      );
      chmodSync(path, 0o755);
    }
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, '.sandcastle', entry), ...args],
      {
        cwd,
        encoding: 'utf8',
        env: {
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          HOME: cwd,
          ...(agent ? { SANDCASTLE_AGENT: agent } : {}),
        },
      },
    );
    const reached = TOOLS.filter((tool) =>
      existsSync(join(cwd, `reached-${tool}`)),
    );
    return { ...result, reached };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('dispatch-agents refuses a populated forwarded env file before any gh, git or docker call, under --dry-run', () => {
  const result = runEntry(
    'main.mts',
    ['--issue', '1', '--dry-run'],
    ['CURSOR_API_KEY', 'GITHUB_TOKEN'],
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CURSOR_API_KEY, GITHUB_TOKEN/);
  assert.match(result.stderr, /secrets\.env/);
  assert.ok(!result.stderr.includes(PLACEHOLDER), 'no value is printed');
  assert.deepEqual(result.reached, []);
});

test('dispatch-waves refuses a populated forwarded env file before any gh, git or docker call', () => {
  const result = runEntry(
    'dispatch-waves.mts',
    ['--prd', '1', '--plan'],
    ['ANTHROPIC_API_KEY'],
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ANTHROPIC_API_KEY/);
  assert.ok(!result.stderr.includes(PLACEHOLDER), 'no value is printed');
  assert.deepEqual(result.reached, []);
});

test('--help still works with a populated forwarded env file: it reads nothing', () => {
  const result = runEntry('main.mts', ['--help'], ['CURSOR_API_KEY']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /secrets\.env/);
});

test('a Codex wave refuses before contacting GitHub when hook enforcement is unverified', () => {
  const result = runEntry(
    'dispatch-waves.mts',
    ['--prd', '1', '--agent', 'codex'],
    [],
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Reviewed hook enforcement has not been established/,
  );
  assert.deepEqual(result.reached, []);
});

test('Codex dispatch modes refuse before contacting GitHub or Docker', () => {
  for (const mode of [
    ['--issue', '1'],
    ['--prd', '1'],
    ['--prd', '1', '--issue', '2'],
    ['--all-standalone'],
  ]) {
    const result = runEntry('main.mts', [...mode, '--agent', 'codex'], []);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Reviewed hook enforcement has not been established/,
    );
    assert.deepEqual(result.reached, []);
  }
});

test('Codex chosen by environment also refuses both live entry points', () => {
  for (const [entry, args] of [
    ['main.mts', ['--issue', '1']],
    ['dispatch-waves.mts', ['--prd', '1', '--dry-run']],
  ] as const) {
    const result = runEntry(entry, [...args], [], 'codex');
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Reviewed hook enforcement has not been established/,
    );
    assert.deepEqual(result.reached, []);
  }
});

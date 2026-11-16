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

function runEntry(entry: string, args: string[], names: string[]) {
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
        env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: cwd },
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

// Contract for check-review-tier.ts (ADR 0085): the header claims exit 2
// still writes tier `human` (and, under GitHub Actions, `tier` / `label` on
// $GITHUB_OUTPUT) rather than leaving the job with an empty output. An empty
// output is how a classifier crash used to present as three red checks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const CHECKER = join(HERE, 'check-review-tier.ts');

const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

test('missing --base/--head exits 2 and still writes human to GITHUB_OUTPUT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-tier-cli-'));
  const githubOutput = join(dir, 'github-output');
  writeFileSync(githubOutput, '');
  const result = run([], {
    GITHUB_OUTPUT: githubOutput,
    GITHUB_ACTIONS: 'true',
    PR_AUTHOR: 'owner',
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /--base and --head are required/);
  const written = readFileSync(githubOutput, 'utf8');
  assert.match(written, /^tier=human$/m);
  assert.match(written, /^label=review:human$/m);
});

test('a graph that cannot be loaded exits 2 with human, not an empty output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-tier-cli-'));
  const githubOutput = join(dir, 'github-output');
  const files = join(dir, 'files.json');
  writeFileSync(githubOutput, '');
  writeFileSync(
    files,
    JSON.stringify([{ path: 'README.md', additions: 1, deletions: 0 }]),
  );
  const result = run(['--files', files, '--graph', join(dir, 'absent.json')], {
    GITHUB_OUTPUT: githubOutput,
    GITHUB_ACTIONS: 'true',
    PR_AUTHOR: 'owner',
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /not found/);
  const written = readFileSync(githubOutput, 'utf8');
  assert.match(written, /^tier=human$/m);
  assert.match(written, /^label=review:human$/m);
});

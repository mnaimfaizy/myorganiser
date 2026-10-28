#!/usr/bin/env node
// Runs one review script from the tooling copy this file sits in, against the
// git repository of the caller's working directory (ADR 0102).
//
//   node <tooling>/tools/scripts/review/run-from-tooling.ts <script> [args...]
//
// <script> is relative to tools/scripts (`review/select-obligations.ts`,
// `check-review-obligation-answers.ts`). The golden replay's working tree is
// a case head, whose tools/ predate the review scripts, so it runs them from a
// copy of the pull request's tooling extracted outside the workspace. Those
// scripts read their catalogues relative to the working directory and shell
// out to git, so they need two things that no longer coincide: the tooling
// copy as their working directory, and the workspace's repository as their
// git. This is the one place that joins them. When the tooling is the
// checkout itself (code-review.yml), both are the same directory and this is
// a plain run.
//
// The script's working directory is the tooling root, so any path argument
// must be absolute. Exit status is the script's own.
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLING_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error(
    'run-from-tooling: usage: run-from-tooling.ts <script> [args...]',
  );
  process.exit(2);
}

let gitDir;
try {
  gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
    encoding: 'utf8',
  }).trim();
} catch {
  console.error(
    `run-from-tooling: ${process.cwd()} is not in a git repository, so ${script} has no history to read`,
  );
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [join(TOOLING_ROOT, 'tools', 'scripts', script), ...args],
  {
    cwd: TOOLING_ROOT,
    env: { ...process.env, GIT_DIR: gitDir },
    stdio: 'inherit',
  },
);
process.exit(result.status ?? 2);

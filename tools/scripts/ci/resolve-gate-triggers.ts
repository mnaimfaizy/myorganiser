#!/usr/bin/env node

/**
 * Resolves which heavy `Test` suites a pull request has to pay for (ADR 0140).
 *
 *   node tools/scripts/ci/resolve-gate-triggers.ts <baseSha> <headSha>
 *   node tools/scripts/ci/resolve-gate-triggers.ts --all
 *
 * Prints one GitHub Actions output line per flag on stdout, `run_all` first:
 *
 *   run_all=false
 *   run_tools_test=true
 *   run_upstream_briefs_test=false
 *   run_openapi_check=false
 *
 * `Setup Affected Context` appends that verbatim to `$GITHUB_OUTPUT`, and
 * each heavy step in `Test` runs when `run_all` or its own flag is set. A
 * push to `main` uses `--all`, so `main` keeps its whole-tree guarantee.
 *
 * The path filter is this file rather than a third-party path-filter action
 * on purpose: the globs it reads are the same artifact `covering-gates:check`
 * asserts against the review-obligation catalogue (ADR 0074), and a decision
 * two gates depend on is not something to delegate to an unpinned marketplace
 * action.
 *
 * **The fallback is always to run more.** A failure this script can describe
 * — git cannot diff the range, a path is unreadable — prints `run_all=true`
 * with every suite flag set and exits 0, because a pull request whose
 * triggers cannot be resolved is one that must pay for everything. The one
 * failure it cannot report that way is a config it cannot even parse, since
 * then it does not know the flag names: that exits 2 with nothing on stdout,
 * and the workflow step writes `run_all=true` itself.
 *
 * Exit 0 = flags printed (resolved, or the all-suites fallback).
 * Exit 2 = the gate-trigger config is missing or malformed.
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';

import { errorMessage } from '../lib/error-message.ts';
import {
  RUN_ALL_FLAG,
  formatFlags,
  readGateTriggers,
  resolveSuites,
  type GateTriggerConfig,
} from '../lib/gate-triggers.ts';

/**
 * Splits `git diff --name-status -M -z` output into every path it names.
 *
 * `--name-only` was wrong here and had to be replaced: with `-M` it reports a
 * rename under its new path only, so moving `apps/backend/src/x.ts` out to
 * `libs/foo/x.ts` would skip `openapi:check` — a removed backend source is
 * exactly the change that invalidates the generated spec. Both sides count,
 * because a trigger may match where a file went or where it came from and
 * either is a reason to run the suite.
 *
 * The `-z` record form is `<status>NUL<path>NUL`, and `R<score>NUL<old>NUL<new>NUL`
 * for a rename or copy. Pure, so the Contract Suite can drive it on fixture
 * output rather than only through a repository.
 */
export function parseNameStatus(output: string): string[] {
  const fields = output.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const status = fields[i];
    // A rename or copy carries two paths; every other status carries one.
    const pathCount = /^[RC]\d*$/.test(status) ? 2 : 1;
    for (let n = 1; n <= pathCount; n += 1) {
      const path = fields[i + n];
      if (path !== undefined) paths.push(path);
    }
    i += pathCount;
  }
  return [...new Set(paths)];
}

/** The paths a range changed, both sides of a rename included. */
export function changedPathsIn(baseSha: string, headSha: string): string[] {
  return parseNameStatus(
    execFileSync(
      'git',
      [
        'diff',
        '--name-status',
        '-M',
        '--diff-filter=ACDMRT',
        '-z',
        baseSha,
        headSha,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ),
  );
}

function usage(): never {
  process.stderr.write(
    'Usage: resolve-gate-triggers.ts <baseSha> <headSha>\n' +
      '       resolve-gate-triggers.ts --all\n',
  );
  process.exit(2);
}

function main(): void {
  // Read first and separately: a config this script cannot parse is the one
  // failure it cannot answer with every flag set, so it must not be caught
  // by the fallback below.
  let config: GateTriggerConfig;
  try {
    config = readGateTriggers({ cwd: process.cwd() });
  } catch (error) {
    process.stderr.write(`gate-triggers: ${errorMessage(error)}\n`);
    process.exit(2);
  }

  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const [baseSha, headSha] = args.filter((arg) => !arg.startsWith('--'));
  if (!all && (!baseSha || !headSha)) usage();

  let resolution;
  try {
    resolution = resolveSuites({
      config,
      changedPaths: all ? [] : changedPathsIn(baseSha, headSha),
      all,
    });
  } catch (error) {
    // Never skip on error: a range that cannot be read is a range that could
    // have touched anything.
    process.stderr.write(
      `gate-triggers: ${errorMessage(error)}\n` +
        `gate-triggers: running every heavy suite (${RUN_ALL_FLAG}).\n`,
    );
    resolution = resolveSuites({ config, changedPaths: [], all: true });
  }

  for (const suite of resolution.suites) {
    process.stderr.write(
      `gate-triggers: ${suite.id}: ${suite.run ? 'run' : 'skip'} — ${suite.reason}\n`,
    );
  }
  process.stdout.write(`${formatFlags(resolution)}\n`);
}

// Guarded so a suite can import `parseNameStatus` without the CLI running
// itself and exiting the test process, the way
// tools/scripts/run-tools-test-selection.ts guards its own entry point.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}

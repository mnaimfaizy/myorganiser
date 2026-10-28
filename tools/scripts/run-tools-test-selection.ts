#!/usr/bin/env node
// Runs exactly the tools/scripts Contract Suites a commit's staged files
// select (ADR 0135 slice 2): the suite staged directly, plus the suite
// paired by name with each staged script. Called from .husky/pre-commit so a
// tooling commit pays for its own suite, not the full ~34s set `tools:test`
// runs in CI.
//
//   node tools/scripts/run-tools-test-selection.ts
//
// The decision is pure (tools/scripts/lib/tools-test-selection.ts).
// `selectAndRun` below is the orchestration layer — selection, the message,
// and the exit code — and is itself pure given its collaborators, so its own
// Contract Suite drives it with stubbed git/suite/runner functions rather
// than a real temporary git repository. Only the three functions at the
// bottom touch git, the filesystem, or a child process.
//
// Exit 0 = nothing selected, or every selected suite passed. Exit 1 = a
// selected suite failed.
import { execFileSync, spawnSync } from 'node:child_process';

import { listSuites } from './lib/gate-coverage.ts';
import { selectStagedSuites } from './lib/tools-test-selection.ts';

/**
 * Selects the suites a commit's staged files choose, runs them through
 * `runTest`, and composes the message Husky's output shows. Pure: `suites`
 * and `stagedFiles` are plain arrays, and `runTest` is called with exactly
 * the suite list to run — no git, no filesystem, no process spawned here.
 */
export interface SelectAndRunResult {
  selected: string[];
  exitCode: number;
  message: string;
}

export function selectAndRun({
  stagedFiles,
  suites,
  runTest,
}: {
  stagedFiles: string[];
  suites: string[];
  runTest: (selected: string[]) => number;
}): SelectAndRunResult {
  const selected = selectStagedSuites({ stagedFiles, suites });

  if (!selected.length) {
    return {
      selected,
      exitCode: 0,
      message: 'tools:test:staged: no staged tools/scripts suite to run.\n',
    };
  }

  const message =
    `tools:test:staged: running ${selected.length} suite(s) selected by staged files\n` +
    selected.map((suite) => `  ${suite}\n`).join('');

  return { selected, exitCode: runTest(selected), message };
}

function gitStagedFiles(): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    { encoding: 'utf8' },
  );
  return output.split('\0').filter(Boolean);
}

function runNodeTest(selected: string[]): number {
  // Node marks a child spawned from inside a running `node --test` with
  // NODE_TEST_CONTEXT, and a nested `--test` invocation that inherits it
  // skips itself ("run() is being called recursively") instead of running
  // anything. This script is run from Husky directly, never nested — but
  // `tools:test`'s own glob sweep can still run this file's sibling checks
  // nested inside a `node --test` of its own, so the env var is stripped
  // before the suites below get a chance to run at all.
  //
  // Husky invokes this script as a `git commit` hook, so git sets GIT_DIR
  // (and friends) in this process's own environment for its hook tree.
  // Several suites below build a throwaway git fixture under a temp
  // directory and run `git` there with only `cwd` pointed at it — `cwd`
  // does not override an inherited GIT_DIR, so without stripping these a
  // suite's fixture command resolves against the real repository instead
  // of its temp one and can corrupt its index (observed: `core.bare`
  // flipped to `true` and the index replaced with the fixture's few files,
  // from a nested `git init`/`git add -A`).
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.GIT_DIR;
  delete childEnv.GIT_WORK_TREE;
  delete childEnv.GIT_INDEX_FILE;
  delete childEnv.GIT_COMMON_DIR;

  const result = spawnSync(process.execPath, ['--test', ...selected], {
    stdio: 'inherit',
    env: childEnv,
  });
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { message, exitCode } = selectAndRun({
    stagedFiles: gitStagedFiles(),
    suites: listSuites(),
    runTest: runNodeTest,
  });
  process.stdout.write(message);
  process.exit(exitCode);
}

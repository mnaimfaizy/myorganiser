#!/usr/bin/env node
// Merges a list of Pull Requests into `main` one at a time, each up to date
// and green on the exact head that lands (issue #1376's 2026-11-11
// resolution).
//
//   node tools/scripts/ci/merge-train.ts <pr>… \
//     [--method merge|squash|rebase] [--poll 30] [--timeout 45] \
//     [--repository <owner/name>] [--dry-run]
//
// For each Pull Request, in the order given: if `main` has moved past it,
// bring the branch up to date; wait for every required check of `main`'s
// ruleset on the new head; merge exactly that head without `--admin`. Stop at
// the first red required check, conflict, draft, or review it cannot pass,
// and say which Pull Requests were never reached.
//
// This is the IO half: `gh` calls, the clock and the sleep. Every decision —
// what a snapshot means, when to update, wait, merge or stop — is pure in
// tools/scripts/lib/merge-train.ts, and its Contract Suite drives the whole
// loop over fixtures.
//
// Exit 0 when every Pull Request merged, 1 when the train stopped, 2 when it
// could not start.
//
// Not a gate: it changes GitHub, never the tree, and runs only by hand.
import { spawnSync } from 'node:child_process';

import {
  TRAIN_BASE,
  parseTrainArgs,
  renderTrainResult,
  requiredChecksFromRules,
  runTrain,
  type CheckRun,
  type MergeMethod,
  type PullRequestSnapshot,
  type TrainIo,
} from '../lib/merge-train.ts';
import {
  cannotRun,
  ghJsonOrNull,
  githubAvailable,
  isMain,
  parseArgs,
} from '../review/cli.ts';

const bail = cannotRun('merge-train');

/** `gh`, with its exit status and output, never thrown. */
const runGh = (
  args: readonly string[],
): { status: number; stdout: string; stderr: string } => {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

const currentRepository = (): string | null => {
  const result = runGh([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner',
  ]);
  return result.status === 0 && result.stdout.trim()
    ? result.stdout.trim()
    : null;
};

/** The `gh`-backed TrainIo for one repository. */
export function githubTrainIo(repository: string): TrainIo {
  return {
    requiredChecks: () =>
      requiredChecksFromRules(
        ghJsonOrNull([
          'api',
          `repos/${repository}/rules/branches/${TRAIN_BASE}`,
        ]),
      ),
    read: (pr) => {
      const view = ghJsonOrNull([
        'pr',
        'view',
        String(pr),
        '--repo',
        repository,
        '--json',
        'number,state,isDraft,baseRefName,headRefOid,mergeStateStatus,reviewDecision',
      ]) as Omit<PullRequestSnapshot, 'checks'> | null;
      if (!view) return null;
      // `gh pr checks` exits non-zero while a check is pending (8) or has
      // failed (1), and still prints the JSON, so its status is not the
      // answer. No output at all means no check has reported on this head
      // yet — every required check is then waiting, which is correct.
      const checks = runGh([
        'pr',
        'checks',
        String(pr),
        '--repo',
        repository,
        '--json',
        'name,bucket,startedAt',
      ]);
      let parsed: CheckRun[] = [];
      try {
        const value: unknown = JSON.parse(checks.stdout || '[]');
        if (Array.isArray(value)) parsed = value as CheckRun[];
      } catch {
        parsed = [];
      }
      return { ...view, checks: parsed };
    },
    update: (pr, expectedHeadOid) =>
      runGh([
        'api',
        '--method',
        'PUT',
        `repos/${repository}/pulls/${pr}/update-branch`,
        '-f',
        `expected_head_sha=${expectedHeadOid}`,
      ]).status === 0,
    merge: (pr, headOid, method: MergeMethod) => {
      // `--match-head-commit` makes GitHub refuse the merge if anything was
      // pushed after the checks were read, and there is deliberately no
      // `--admin`: the ruleset's own up-to-date and required-check rules are
      // what this merge has to pass.
      const result = runGh([
        'pr',
        'merge',
        String(pr),
        '--repo',
        repository,
        `--${method}`,
        '--match-head-commit',
        headOid,
      ]);
      if (result.status !== 0) {
        console.error(`merge-train: #${pr}: ${result.stderr.trim()}`);
      }
      return result.status === 0;
    },
    sleep: (seconds) =>
      new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
    now: () => Date.now(),
    log: (line) => console.log(`merge-train: ${line}`),
  };
}

async function main(argv: readonly string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const parsed = parseTrainArgs(positional, flags);
  if ('error' in parsed) return bail(parsed.error);
  if (!githubAvailable()) return bail('`gh` is not installed or not logged in');
  const repository = flags.repository ?? currentRepository();
  if (!repository) return bail('the repository could not be resolved');

  const result = await runTrain(parsed, githubTrainIo(repository));
  console.log(renderTrainResult(result));
  return result.stoppedAt ? 1 : 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

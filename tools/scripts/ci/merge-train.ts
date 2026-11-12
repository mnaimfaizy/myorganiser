#!/usr/bin/env node
// Merges a list of Pull Requests into `main` one at a time, each up to date
// and green on the exact head that lands (issue #1376's 2026-11-11
// resolution).
//
//   node tools/scripts/ci/merge-train.ts <pr>… \
//     [--method merge|squash|rebase] [--poll 30] [--timeout 45] \
//     [--repository <owner/name>] [--dry-run] [--auto]
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
// `--auto` is Auto-merge (ADR 0148): the train decides each candidate by
// itself from facts read for its head, under the mode in
// tools/config/merge-train-auto-merge.json (`off`, `shadow`, `on`). A held
// candidate is listed with its reason and the pass moves on. Exit 0 when the
// pass finished, 1 when a shadow comment could not be written, 2 when it
// could not start.
//
// Not a gate: it changes GitHub, never the tree, and runs only by hand.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SHADOW_COMMENT_MARKER,
  TRAIN_BASE,
  agentVerdictFromView,
  reviewTierFromView,
  changedFilesFromGh,
  readPathMapFromGit,
  readAutoMergeModeFromGit,
  fetchOnce,
  onMainFromCompare,
  prCommitsFromGh,
  qaReportFromView,
  mainCiFromRuns,
  parseTrainArgs,
  renderAutoTrainResult,
  renderTrainResult,
  requiredChecksFromRules,
  runAutoTrain,
  runTrain,
  type AutoTrainIo,
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
import type { ReviewComment } from '../review/escaped-defects.ts';
import type { ReviewTierPathMap } from '../lib/review-tier.ts';

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
        'number,state,isDraft,baseRefName,headRefOid,mergeStateStatus,reviewDecision,body',
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

/** The `gh` login the train runs as, so it edits only its own comments. */
const viewerLogin = (): string | null => {
  const result = runGh(['api', 'user', '-q', '.login']);
  return result.status === 0 && result.stdout.trim()
    ? result.stdout.trim()
    : null;
};

/** The `gh`-backed AutoTrainIo. */
export function githubAutoTrainIo(repository: string): AutoTrainIo {
  let login: string | null | undefined;
  return {
    ...githubTrainIo(repository),
    mainCi: () =>
      mainCiFromRuns(
        ghJsonOrNull([
          'run',
          'list',
          '--repo',
          repository,
          '--workflow',
          'ci.yml',
          '--branch',
          TRAIN_BASE,
          '--event',
          'push',
          '--status',
          'completed',
          '--limit',
          '1',
          '--json',
          'conclusion,headSha',
        ]),
      ),
    reviewTier: (pr, head) =>
      reviewTierFromView(
        ghJsonOrNull([
          'pr',
          'view',
          String(pr),
          '--repo',
          repository,
          '--json',
          'comments',
        ]) as { comments?: ReviewComment[] } | null,
        head,
      ),
    changedFiles: (pr) =>
      changedFilesFromGh(
        runGh([
          'api',
          '--paginate',
          `repos/${repository}/pulls/${pr}/files`,
          '--jq',
          '.[] | {filename: .filename, previous_filename: .previous_filename}',
        ]),
      ),
    mainPathMap: readMainPathMap,
    agentVerdict: (pr) => {
      const view = ghJsonOrNull([
        'pr',
        'view',
        String(pr),
        '--repo',
        repository,
        '--json',
        'comments',
      ]) as { comments?: ReviewComment[] } | null;
      return agentVerdictFromView(view);
    },
    qaReport: (pr, head) => {
      if (login === undefined) login = viewerLogin();
      return qaReportFromView(
        ghJsonOrNull([
          'pr',
          'view',
          String(pr),
          '--repo',
          repository,
          '--json',
          'comments',
        ]) as { comments?: ReviewComment[] } | null,
        login,
        head,
        () =>
          prCommitsFromGh(
            runGh([
              'api',
              '--paginate',
              `repos/${repository}/pulls/${pr}/commits`,
              '--jq',
              '.[] | {sha: .sha, parents: [.parents[].sha]}',
            ]),
          ),
        (sha) =>
          onMainFromCompare(
            runGh([
              'api',
              `repos/${repository}/compare/${TRAIN_BASE}...${sha}`,
              '-q',
              '.status',
            ]),
          ),
      );
    },
    upsertShadowComment: (pr, body) => {
      if (login === undefined) login = viewerLogin();
      if (!login) return false;
      // Only a comment this login wrote is edited: a marker pasted into
      // someone else's comment is not the train's record.
      const found = runGh([
        'api',
        '--paginate',
        `repos/${repository}/issues/${pr}/comments`,
        '--jq',
        `.[] | select(.user.login == ${JSON.stringify(login)}) | select(.body | contains(${JSON.stringify(SHADOW_COMMENT_MARKER)})) | .id`,
      ]);
      if (found.status !== 0) return false;
      const id = found.stdout.trim().split('\n')[0];
      const result = id
        ? runGh([
            'api',
            '--method',
            'PATCH',
            `repos/${repository}/issues/comments/${id}`,
            '-f',
            `body=${body}`,
          ])
        : runGh([
            'api',
            '--method',
            'POST',
            `repos/${repository}/issues/${pr}/comments`,
            '-f',
            `body=${body}`,
          ]);
      if (result.status !== 0) {
        console.error(`merge-train: #${pr}: ${result.stderr.trim()}`);
      }
      return result.status === 0;
    },
  };
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * `git` in this checkout. One fetch of `main` serves the mode and the path
 * map: both are read as `main` has them, never from the working tree, so a
 * train started from a feature branch cannot judge with that branch's files.
 */
const mainGit = fetchOnce((args) => {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout };
});

const readMainPathMap = (): ReviewTierPathMap | null =>
  readPathMapFromGit(mainGit);

/** Flags that never take a value, so `--auto 12` keeps 12 a Pull Request. */
const BOOLEAN_FLAGS = ['--auto', '--dry-run'];

async function main(argv: readonly string[]): Promise<number> {
  const booleans = new Set(argv.filter((arg) => BOOLEAN_FLAGS.includes(arg)));
  const { positional, flags } = parseArgs(
    argv.filter((arg) => !BOOLEAN_FLAGS.includes(arg)),
  );
  if (booleans.has('--dry-run')) flags['dry-run'] = null;
  const parsed = parseTrainArgs(positional, flags);
  if ('error' in parsed) return bail(parsed.error);
  if (!githubAvailable()) return bail('`gh` is not installed or not logged in');
  const repository = flags.repository ?? currentRepository();
  if (!repository) return bail('the repository could not be resolved');

  if (booleans.has('--auto')) {
    const mode = readAutoMergeModeFromGit(mainGit);
    const result = await runAutoTrain(
      { ...parsed, mode },
      githubAutoTrainIo(repository),
    );
    console.log(renderAutoTrainResult(result));
    return result.commentFailures.length > 0 ? 1 : 0;
  }

  const result = await runTrain(parsed, githubTrainIo(repository));
  console.log(renderTrainResult(result));
  return result.stoppedAt ? 1 : 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

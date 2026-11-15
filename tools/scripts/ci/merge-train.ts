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
// Exit 0 when every Pull Request merged, 1 when the train stopped or when a
// Pull Request merged but its Sign-off Issue write failed (the merge stands,
// and the result prints the lines to add by hand), 2 when it could not start.
//
// After every merge GitHub accepts, in either train, the Pull Request's
// `staging` and `production` Person Checks from the QA Report this login
// wrote are added to the open Sign-off Issue, which is created when none is
// open (ADR 0151 decision 6). `--dry-run`, and `--auto` under `shadow`,
// merge nothing and write nothing there.
//
// `--auto` is Auto-merge (ADR 0148): the train decides each candidate by
// itself from facts read for its head, under the mode in
// tools/config/merge-train-auto-merge.json (`off`, `shadow`, `on`). A held
// candidate is listed with its reason and the pass moves on. Exit 0 when the
// pass finished, 1 when a marker comment (shadow decision or `on` record) or a
// Sign-off Issue write could not be written, 2 when it could not start.
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
  type HeadFactIo,
  type MergeMethod,
  type PullRequestSnapshot,
  type TrainIo,
} from '../lib/merge-train.ts';
import {
  SIGNOFF_ISSUE_LABEL,
  SIGNOFF_ISSUE_TITLE,
  signOffChecksFromView,
  findSignOffIssue,
  type QaReportComment,
  type SignOffIssueCandidate,
} from '../lib/signoff-issue.ts';
import {
  cannotRun,
  ghJsonOrNull,
  githubAvailable,
  isMain,
  parseArgs,
} from '../review/cli.ts';
import type { ReviewComment } from '../review/escaped-defects.ts';
import type { ReviewTierPathMap } from '../lib/review-tier.ts';

import { currentRepository, runGh, viewerLogin } from '../lib/gh-cli.ts';

const bail = cannotRun('merge-train');

export { currentRepository, viewerLogin };

const prCommits = (repository: string, pr: number) =>
  prCommitsFromGh(
    runGh([
      'api',
      '--paginate',
      `repos/${repository}/pulls/${pr}/commits`,
      '--jq',
      '.[] | {sha: .sha, parents: [.parents[].sha]}',
    ]),
  );

const isOnMain = (repository: string, sha: string) =>
  onMainFromCompare(
    runGh([
      'api',
      `repos/${repository}/compare/${TRAIN_BASE}...${sha}`,
      '-q',
      '.status',
    ]),
  );

const prComments = (repository: string, pr: number) =>
  ghJsonOrNull([
    'pr',
    'view',
    String(pr),
    '--repo',
    repository,
    '--json',
    'comments',
  ]) as { comments?: QaReportComment[] } | null;

/** How many open `qa` issues one read lists; a full list is unreadable. */
const SIGNOFF_ISSUE_LIST_LIMIT = 1000;

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
    signOffChecks: (pr, head) =>
      signOffChecksFromView(
        prComments(repository, pr),
        viewerLogin(),
        head,
        () => prCommits(repository, pr),
        (sha) => isOnMain(repository, sha),
      ),
    findSignOffIssue: () => {
      const open = ghJsonOrNull([
        'issue',
        'list',
        '--repo',
        repository,
        '--label',
        SIGNOFF_ISSUE_LABEL,
        '--state',
        'open',
        '--limit',
        String(SIGNOFF_ISSUE_LIST_LIMIT),
        '--json',
        'number,body,author',
      ]) as SignOffIssueCandidate[] | null;
      // A full page may have cut the Sign-off Issue off: unreadable, never
      // "none", so the train does not open a second one.
      return findSignOffIssue(
        Array.isArray(open) && open.length < SIGNOFF_ISSUE_LIST_LIMIT
          ? open
          : null,
        viewerLogin(),
      );
    },
    // A blind replace: see `SignOffIo.writeSignOffIssue` for the tick race
    // and the double create this accepts.
    writeSignOffIssue: (number, body) => {
      const result =
        number === null
          ? runGh([
              'issue',
              'create',
              '--repo',
              repository,
              '--title',
              SIGNOFF_ISSUE_TITLE,
              '--label',
              SIGNOFF_ISSUE_LABEL,
              '--body',
              body,
            ])
          : runGh([
              'api',
              '--method',
              'PATCH',
              `repos/${repository}/issues/${number}`,
              '-f',
              `body=${body}`,
            ]);
      if (result.status !== 0) {
        console.error(`merge-train: Sign-off Issue: ${result.stderr.trim()}`);
        return null;
      }
      if (number !== null) return number;
      // `gh issue create` prints the new issue's URL.
      const created = /\/issues\/([1-9]\d*)\s*$/.exec(result.stdout);
      return created ? Number(created[1]) : null;
    },
  };
}

/**
 * The `gh`-backed Agent Verdict read, shared by `--auto` and `runs:ready`
 * (`HeadFactIo`), so both judge one head's code review through one reader.
 */
export const githubAgentVerdict =
  (repository: string): HeadFactIo['agentVerdict'] =>
  (pr) =>
    agentVerdictFromView(
      ghJsonOrNull([
        'pr',
        'view',
        String(pr),
        '--repo',
        repository,
        '--json',
        'comments',
      ]) as { comments?: ReviewComment[] } | null,
    );

/** The `gh`-backed AutoTrainIo. */
export function githubAutoTrainIo(repository: string): AutoTrainIo {
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
    agentVerdict: githubAgentVerdict(repository),
    qaReport: (pr, head) =>
      qaReportFromView(
        prComments(repository, pr),
        viewerLogin(),
        head,
        () => prCommits(repository, pr),
        (sha) => isOnMain(repository, sha),
      ),
    upsertShadowComment: (pr, body) => {
      const login = viewerLogin();
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
    return result.commentFailures.length > 0 ||
      result.signOffFailures.length > 0
      ? 1
      : 0;
  }

  const result = await runTrain(parsed, githubTrainIo(repository));
  console.log(renderTrainResult(result));
  return result.stoppedAt || result.signOffFailures.length > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

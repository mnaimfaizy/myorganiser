#!/usr/bin/env node
// Measures whether Merge Train Auto-merge has earned `on` (PRD #1523, issue
// #1528, ADR 0148 decisions 5 and 6).
//
//   node tools/scripts/ci/measure-shadow-record.ts \
//     [--days 90 | --since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] \
//     [--repository <owner/name>] [--author <login[,login]>] [--gathered <in.json>] \
//     [--save-gather <out.json>] [--out <report.md>] [--json <report.json>]
//
// This is the IO half. Every judgment — which comment is a decision, "merged
// unchanged", a revert or a fix within seven days, the exit criterion — lives
// in tools/scripts/lib/shadow-record.ts and is computed purely over the
// `ShadowGather` this script assembles, so a window can be saved with
// --save-gather and re-judged later with --gathered.
//
// It reads, all through `gh`:
//   * the repository's issue comments updated since the window opened (one
//     paged call), keeping those that carry the Merge Train's shadow marker;
//   * each commented Pull Request's state, and for a merged one its branch
//     commits with their parents (a merge of `main` into the branch is not a
//     change);
//   * the Pull Requests merged since the window opened, with their commits'
//     messages, to find reverts and `Introduced in #N` follow-up fixes.
//
// Exit 0 whenever a report was made, whatever its verdict; 2 when it could not
// run. What could not be read is reported, never assumed. Not a gate: it reports on
// weeks of other branches' Pull Requests and reaches the network; it carries a
// written opt-out in tools/config/gate-coverage-optout.json.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTO_MERGE_MODE_PATH,
  SHADOW_COMMENT_MARKER,
  parseAutoMergeMode,
} from '../lib/merge-train.ts';
import {
  BAD_WITHIN_DAYS,
  DAY_MS,
  DEFAULT_WINDOW_DAYS,
  renderShadowRecord,
  summarizeShadowRecord,
  type GatheredBranchCommit,
  type GatheredMerge,
  type GatheredPullRequest,
  type ShadowGather,
} from '../lib/shadow-record.ts';
import {
  cannotRun,
  ghJsonOrNull,
  githubAvailable,
  isMain,
  parseArgs,
  readJsonOr,
  shiftDays,
  writeFile,
} from '../review/cli.ts';

const bail = cannotRun('shadow-record');

/** The repository root, found from this file rather than from the cwd. */
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** The merged-listing cap; a window that reaches it is reported. */
export const MERGED_LIMIT = 500;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const currentRepository = (): string | null => {
  const view = ghJsonOrNull(['repo', 'view', '--json', 'nameWithOwner']) as {
    nameWithOwner?: string;
  } | null;
  return view?.nameWithOwner ?? null;
};

/** `gh api --paginate --slurp`, flattened; `null` when any page is unreadable. */
const pagedArray = (path: string): unknown[] | null => {
  const pages = ghJsonOrNull(['api', '--paginate', '--slurp', path]);
  return Array.isArray(pages) ? pages.flat() : null;
};

interface IssueComment {
  body?: string;
  updated_at?: string;
  issue_url?: string;
  user?: { login?: string } | null;
}

interface PullRequestView {
  number: number;
  title: string;
  state: string;
  mergedAt?: string | null;
}

interface MergedListing {
  number: number;
  title: string;
  body?: string;
  mergedAt: string;
}

const branchCommits = (
  repository: string,
  number: number,
): GatheredBranchCommit[] | null => {
  const commits = pagedArray(
    `repos/${repository}/pulls/${number}/commits?per_page=100`,
  );
  if (commits === null) return null;
  return (commits as { sha: string; parents?: unknown[] }[]).map((commit) => ({
    oid: commit.sha,
    isMerge: (commit.parents?.length ?? 0) > 1,
  }));
};

function gather({
  repository,
  since,
  until,
  asOf,
  trustedAuthors,
}: {
  trustedAuthors: string[];
  repository: string | null;
  since: string;
  until: string;
  asOf: string;
}): ShadowGather {
  const modePath = join(REPO_ROOT, AUTO_MERGE_MODE_PATH);
  const mode = parseAutoMergeMode(
    existsSync(modePath) ? readFileSync(modePath, 'utf8') : null,
  );
  const base = { asOf, window: { since, until }, mode, trustedAuthors };
  if (!repository) {
    return {
      ...base,
      evidence: { repository: 'could not be resolved, so nothing was read' },
      pullRequests: [],
      merges: [],
    };
  }

  const evidence: Record<string, string> = {};
  const comments = pagedArray(
    `repos/${repository}/issues/comments?since=${since}T00:00:00Z&per_page=100`,
  ) as IssueComment[] | null;
  evidence['issue comments (Repos API)'] =
    comments === null
      ? 'unreadable, so no decision is counted'
      : `${comments.length} updated since ${since}`;

  const pullRequests: GatheredPullRequest[] = [];
  let unreadPullRequests = 0;
  for (const comment of comments ?? []) {
    if (!comment.body?.includes(SHADOW_COMMENT_MARKER)) continue;
    const number = Number(
      /\/issues\/(\d+)$/.exec(comment.issue_url ?? '')?.[1],
    );
    if (!Number.isInteger(number) || !comment.updated_at) continue;
    const view = ghJsonOrNull([
      'pr',
      'view',
      String(number),
      '--repo',
      repository,
      '--json',
      'number,title,state,mergedAt',
    ]) as PullRequestView | null;
    if (view === null) {
      unreadPullRequests += 1;
      continue;
    }
    const state =
      view.state === 'MERGED'
        ? 'merged'
        : view.state === 'OPEN'
          ? 'open'
          : 'closed';
    pullRequests.push({
      number,
      title: view.title,
      state,
      mergedAt: view.mergedAt ?? null,
      comment: {
        author: comment.user?.login ?? null,
        updatedAt: comment.updated_at,
        body: comment.body,
      },
      commits: state === 'merged' ? branchCommits(repository, number) : null,
    });
  }
  evidence['shadow comments'] =
    `${pullRequests.length} on a readable Pull Request` +
    (unreadPullRequests
      ? `; ${unreadPullRequests} Pull Request(s) unreadable and left out`
      : '');
  const unreadCommits = pullRequests.filter(
    (pr) => pr.state === 'merged' && pr.commits === null,
  ).length;
  if (unreadCommits > 0) {
    evidence['branch commits (Repos API)'] =
      `unreadable for ${unreadCommits} merged Pull Request(s), which cannot count as merged unchanged`;
  }

  // Without `commits`: asking GraphQL for them across hundreds of Pull
  // Requests exceeds its node limit. Commit messages are fetched below, only
  // for a merge that landed inside some decided Pull Request's watch.
  const listed = ghJsonOrNull([
    'pr',
    'list',
    '--repo',
    repository,
    '--state',
    'merged',
    '--search',
    `merged:>=${since}`,
    '--json',
    'number,title,body,mergedAt',
    '--limit',
    String(MERGED_LIMIT),
  ]) as MergedListing[] | null;
  const watches = pullRequests
    .filter((pr) => pr.state === 'merged' && pr.mergedAt)
    .map((pr) => Date.parse(pr.mergedAt as string));
  const inWatch = (mergedAt: string): boolean => {
    const at = Date.parse(mergedAt);
    return watches.some(
      (start) => at > start && at <= start + BAD_WITHIN_DAYS * DAY_MS,
    );
  };
  let unreadMessages = 0;
  const merges: GatheredMerge[] = (listed ?? []).map((pr) => {
    let commitMessages: string[] = [];
    if (inWatch(pr.mergedAt)) {
      const view = ghJsonOrNull([
        'pr',
        'view',
        String(pr.number),
        '--repo',
        repository,
        '--json',
        'commits',
      ]) as {
        commits?: { messageHeadline?: string; messageBody?: string }[];
      } | null;
      if (view === null) unreadMessages += 1;
      commitMessages = (view?.commits ?? []).map(
        (commit) =>
          `${commit.messageHeadline ?? ''}\n${commit.messageBody ?? ''}`,
      );
    }
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? '',
      mergedAt: pr.mergedAt,
      commitMessages,
    };
  });
  if (unreadMessages > 0) {
    evidence['commit messages (`gh pr view`)'] =
      `unreadable for ${unreadMessages} merge(s) inside a watch, so a follow-up fix there is not found`;
  }
  evidence['merged Pull Requests (`gh pr list`)'] =
    listed === null
      ? 'unreadable, so no revert or follow-up fix is found'
      : `${merges.length} merged since ${since}` +
        (merges.length >= MERGED_LIMIT
          ? ` — the listing hit its limit of ${MERGED_LIMIT}`
          : '');

  return { ...base, evidence, pullRequests, merges };
}

export const main = (argv: string[]): number => {
  const { flags } = parseArgs(argv);
  const days =
    flags.days === undefined || flags.days === null
      ? DEFAULT_WINDOW_DAYS
      : Number(flags.days);
  if (!Number.isInteger(days) || days <= 0) {
    bail(`--days must be a positive whole number (got ${flags.days})`);
  }
  const until = flags.until ?? new Date().toISOString().slice(0, 10);
  if (!DATE.test(until)) bail(`--until must be YYYY-MM-DD (got ${until})`);
  const since = flags.since ?? shiftDays(until, days);
  if (!DATE.test(since)) bail(`--since must be YYYY-MM-DD (got ${since})`);

  // The train comments as the Maintainer's `gh` login (ADR 0148 decision 2);
  // `--author` names the login(s), comma-separated, when another runs this.
  const viewer = (ghJsonOrNull(['api', 'user']) as { login?: string } | null)
    ?.login;
  const trustedAuthors = flags.author
    ? flags.author
        .split(',')
        .map((login) => login.trim())
        .filter(Boolean)
    : viewer
      ? [viewer]
      : [];
  const gathered = flags.gathered
    ? (readJsonOr(flags.gathered, bail) as ShadowGather)
    : gather({
        repository: githubAvailable()
          ? (flags.repository ?? currentRepository())
          : null,
        since,
        until,
        asOf: new Date().toISOString(),
        trustedAuthors,
      });
  if (flags['save-gather']) {
    writeFile(flags['save-gather'], `${JSON.stringify(gathered, null, 2)}\n`);
  }

  const summary = summarizeShadowRecord(gathered);
  const markdown = renderShadowRecord(summary);
  if (flags.out) writeFile(flags.out, markdown);
  if (flags.json)
    writeFile(flags.json, `${JSON.stringify(summary, null, 2)}\n`);
  if (!flags.out) process.stdout.write(markdown);
  console.error(
    `shadow-record: ${summary.counted.length} decision(s) over ${summary.spanDays.toFixed(1)} day(s), ` +
      `${summary.mergedUnchanged} merged unchanged, ${summary.bad.length} bad, ${summary.verdict}`,
  );
  return 0;
};

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));

#!/usr/bin/env node
// Measures how long a pull request waits for CI (PRD #1387, issue #1393),
// and reports the five signals that say the five-minute target is slipping.
//
//   node tools/scripts/ci/measure-ci-duration.ts \
//     [--days 14 | --since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] \
//     [--workflow ci.yml] [--limit 300] [--repository <owner/name>] \
//     [--no-github] [--gathered <in.json>] [--save-gather <out.json>] \
//     [--out <report.md>] [--json <report.json>]
//
// This is the IO half. Every judgment — the linear-interpolated percentiles,
// the Single-Library Pull Request rule, each signal, the ten-run cutoff —
// lives in tools/scripts/lib/ci-duration.ts and is computed purely over the
// `CiDurationGather` this script assembles. The split is what lets a window
// be saved with --save-gather and re-measured later with --gathered, and it
// is what the Contract Suite asserts against.
//
// The method is the baseline's (issue #1374): job and step timestamps from
// the Actions API, never a run's own `createdAt`, because an author waits on
// the checks and not on the queue. For each run it reads
//
//   * the run's jobs and their steps — one `actions/runs/<id>/jobs` call;
//   * a three-dot compare of the branch head against the `main` tip as it
//     stood when the run started — one `compare` call, which answers both
//     "which files did this pull request change" (relative to the merge
//     base, which is what a three-dot compare gives) and "how far behind
//     `main` was the branch" in the one request.
//
// `main`'s own commit timestamps come from a single `commits` call over the
// window, so the tip-at-run-start lookup is local arithmetic rather than a
// request per run. Two requests per run still means a few hundred requests
// for a fortnight, so a full run takes minutes — it is a weekly scheduled
// measurement and a command run by hand, never a gate.
//
// What could not be read is reported and never assumed: an unreadable
// compare leaves a run unclassified and out of the stale-branch denominator,
// and the evidence block says how often that happened.
//
// Not a gate. It reports percentiles over weeks of other branches' runs, has
// no fact to fail on for the commit in front of it, and reaches the network;
// it carries a written opt-out in tools/config/gate-coverage-optout.json.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CI_WORKFLOW,
  DEFAULT_WINDOW_DAYS,
  formatSeconds,
  renderCiDurationMeasurement,
  summarizeCiDuration,
  type CiDurationGather,
  type GatheredJob,
  type GatheredRun,
} from '../lib/ci-duration.ts';
import {
  cannotRun,
  dateOnly,
  ghJsonOrNull,
  githubAvailable,
  isMain,
  parseArgs,
  readJsonOr,
  writeFile,
  shiftDays,
} from '../review/cli.ts';

const bail = cannotRun('ci-duration');

/** The repository root, found from this file rather than from the cwd. */
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** `gh run list`'s default page, and the cap this measurement reports. */
export const DEFAULT_RUN_LIMIT = 300;

/** The compare API lists at most this many files per comparison. */
export const COMPARE_FILE_LIMIT = 300;

/** The commits API's maximum page, and the size the paging loop assumes. */
export const COMMIT_PAGE_SIZE = 100;

/**
 * A bound on the commit paging loop. 30 pages is 3,000 commits of `main`,
 * far past what any window this measurement takes can hold; the loop stops
 * on a short page long before this.
 */
export const MAX_COMMIT_PAGES = 30;

/**
 * The files whose presence makes a directory an Nx project root.
 *
 * Both, not just `project.json`: Nx infers a project from a `package.json`
 * too, and this repository has one such project — `scripts`, rooted at
 * `tools/scripts`, which carries a `package.json` and no `project.json`.
 * Reading only `project.json` left that root out, and because `tools` *is* a
 * `project.json` project, every `tools/scripts/**` file fell to the enclosing
 * `tools` root: a pull request touching `tools/scripts` and `tools/config`
 * read as one project when `nx affected` selects two.
 */
const PROJECT_ROOT_FILES = ['project.json', 'package.json'] as const;

/**
 * Directories a project-root walk never descends into.
 *
 * Hidden directories are skipped by the walk itself rather than listed here,
 * because Nx does not infer a project inside one: `.agents` holds a fixture
 * tree with its own `package.json`, and the project graph has no node for it.
 */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  'tmp',
]);

/** One run of CI, as `gh run list` returns it. */
interface WorkflowRun {
  databaseId: number;
  headBranch: string;
  headSha: string;
  createdAt: string;
  conclusion?: string | null;
  event?: string;
}

/**
 * What one walk of `main`'s commits came back with: the commits, newest
 * first, and — when the walk could not finish — why, in words the evidence
 * block prints. `null` means the whole window was read.
 */
export interface MainCommitRead {
  commits: MainCommit[];
  incomplete: string | null;
}

/** One commit of `main`, as the commits API returns it. */
interface MainCommit {
  sha: string;
  committedAt: number;
}

/**
 * Every Nx project root, repo-relative with forward slashes.
 *
 * Read off disk rather than from the Nx project graph on purpose: the graph
 * costs a full Nx boot, and the watch workflow runs this script with no
 * `yarn install` at all, so there is no Nx there to boot. What the walk
 * reads instead is the rule Nx itself applies — a directory holding one of
 * `PROJECT_ROOT_FILES`, outside a hidden directory, and not ignored by git —
 * and the Contract Suite asserts the two agree over this repository, in both
 * directions, so the rule cannot drift from the graph unnoticed.
 *
 * The candidate files come from git (tracked, plus untracked files git does
 * not ignore), not from a directory walk. Nx honours `.gitignore`, so a walk
 * found roots Nx never does: a local `storybook-static` build output carries
 * its own `project.json`. A git that cannot list the tree throws rather than
 * falling back to a walk, because a measurement over the wrong roots still
 * prints a number. A root directory that does not exist has no roots.
 *
 * A root is read at the head of `main` the measurement runs from, not at each
 * run's own commit, so a project added mid-window classifies every run in the
 * window; that is the reading that keeps a freshly split library from making
 * its own pull requests unclassified.
 */
export function projectRootsUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const listed = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (listed.error || listed.status !== 0) {
    throw new Error(
      `cannot list project roots: git ls-files failed in ${root}: ${
        listed.error?.message ?? listed.stderr.trim()
      }`,
    );
  }
  const roots = new Set<string>();
  for (const file of listed.stdout.split('\0')) {
    const name = file.slice(file.lastIndexOf('/') + 1);
    if (!(PROJECT_ROOT_FILES as readonly string[]).includes(name)) continue;
    // A tracked file deleted from the working tree is not a project Nx sees.
    if (!existsSync(join(root, file))) continue;
    const directory = dirname(file);
    // The workspace root holds a `package.json` and is not a project. It
    // would otherwise claim every file and make every pull request
    // Single-Library, which `projectOfFile` also refuses on its own.
    if (directory === '.') continue;
    const segments = directory.split('/');
    if (segments.some((segment) => segment.startsWith('.'))) continue;
    if (segments.some((segment) => SKIPPED_DIRECTORIES.has(segment))) continue;
    roots.add(directory);
  }
  return [...roots].sort();
}

/** The repository `gh` is pointed at, or null when it cannot be read. */
const currentRepository = (): string | null => {
  const view = ghJsonOrNull(['repo', 'view', '--json', 'nameWithOwner']) as {
    nameWithOwner?: string;
  } | null;
  return view?.nameWithOwner ?? null;
};

/**
 * Every pull request run of the workflow `gh` will name, newest first.
 *
 * `--repo` is passed, not left to the working directory: every other read
 * here is addressed to `repository` explicitly, and a listing that answered
 * from somewhere else would hand those reads run ids that do not exist in
 * the repository being measured — a silently empty report rather than an
 * error.
 */
const listRuns = ({
  repository,
  workflow,
  limit,
}: {
  repository: string;
  workflow: string;
  limit: number;
}): WorkflowRun[] =>
  (ghJsonOrNull([
    'run',
    'list',
    '--repo',
    repository,
    '--workflow',
    workflow,
    '--event',
    'pull_request',
    '--json',
    'databaseId,headBranch,headSha,createdAt,conclusion,event',
    '--limit',
    String(limit),
  ]) as WorkflowRun[] | null) ?? [];

/**
 * `main`'s commits over the window, newest first, for the tip-at-run read.
 *
 * **Paged, and that is the point.** The commits API answers 100 at a time,
 * and `main` here takes several hundred commits a fortnight, so a single
 * unpaged request covers only the newest few days of the window: every run
 * older than that resolves no `main` tip, gets no compare, and falls out of
 * both the Single-Library classification and the stale-branch denominator —
 * the whole measurement quietly shrinking to the last few days while
 * reporting a fortnight. The loop walks pages until one comes back short, as
 * `prune-actions-caches.ts` walks the cache listing, and `MAX_COMMIT_PAGES`
 * bounds it so a server that keeps answering with a full page cannot spin
 * forever.
 *
 * A listing this cannot read whole is **said so**, never swallowed. There are
 * two ways to come up short — the loop hits its bound, or a page comes back
 * unreadable — and both end the walk with commits missing from the oldest end
 * of the window, which is exactly the silent truncation this helper exists to
 * stop. Both are returned as `incomplete`, and the caller reports it the way
 * it reports the run listing's `--limit`.
 */
const listMainCommits = ({
  repository,
  since,
  until,
}: {
  repository: string;
  since: string;
  until: string;
}): MainCommitRead => {
  const commits: MainCommit[] = [];
  let incomplete: string | null = null;
  for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
    const payload = ghJsonOrNull([
      'api',
      `repos/${repository}/commits?sha=main&since=${since}T00:00:00Z&until=${until}T23:59:59Z` +
        `&per_page=${COMMIT_PAGE_SIZE}&page=${page}`,
    ]) as { sha?: string; commit?: { committer?: { date?: string } } }[] | null;
    // An unreadable page is not the end of the history, so it must not read
    // as one: the walk stops, and what it stopped short of is named.
    if (!Array.isArray(payload)) {
      incomplete = `page ${page} could not be read`;
      break;
    }
    if (payload.length === 0) break;
    for (const entry of payload) {
      const sha = String(entry.sha ?? '');
      const committedAt = Date.parse(entry.commit?.committer?.date ?? '');
      if (sha && Number.isFinite(committedAt)) {
        commits.push({ sha, committedAt });
      }
    }
    // A short page is the end of the history, and the only clean finish.
    if (payload.length < COMMIT_PAGE_SIZE) break;
    if (page === MAX_COMMIT_PAGES) {
      incomplete = `the paging loop hit its ${MAX_COMMIT_PAGES}-page bound`;
    }
  }
  return {
    commits: commits.sort((a, b) => b.committedAt - a.committedAt),
    incomplete,
  };
};

/**
 * The newest `main` commit that existed when `createdAt` happened, or null
 * when every commit given is newer than it.
 *
 * `commits` must be newest first, which is how `listMainCommits` sorts them:
 * this takes the first commit at or before the timestamp rather than sorting
 * again, so that one window's commits are ordered once and not per run.
 */
export function mainTipAt(
  commits: readonly MainCommit[],
  createdAt: string,
): string | null {
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return null;
  return commits.find((commit) => commit.committedAt <= at)?.sha ?? null;
}

/** The jobs and steps of one run, or null when they cannot be read. */
const readJobs = (
  repository: string,
  runId: number,
): { jobs: GatheredJob[]; truncated: boolean } | null => {
  const payload = ghJsonOrNull([
    'api',
    `repos/${repository}/actions/runs/${runId}/jobs?per_page=100`,
  ]) as {
    total_count?: number;
    jobs?: {
      name?: string;
      started_at?: string | null;
      completed_at?: string | null;
      conclusion?: string | null;
      steps?: {
        name?: string;
        started_at?: string | null;
        completed_at?: string | null;
        conclusion?: string | null;
      }[];
    }[];
  } | null;
  if (!payload || !Array.isArray(payload.jobs)) return null;
  const jobs = payload.jobs.map(
    (job): GatheredJob => ({
      name: String(job.name ?? ''),
      startedAt: job.started_at ?? null,
      completedAt: job.completed_at ?? null,
      conclusion: job.conclusion ?? null,
      steps: (job.steps ?? []).map((step) => ({
        name: String(step.name ?? ''),
        startedAt: step.started_at ?? null,
        completedAt: step.completed_at ?? null,
        conclusion: step.conclusion ?? null,
      })),
    }),
  );
  return {
    jobs,
    truncated: Number(payload.total_count ?? jobs.length) > jobs.length,
  };
};

/** What one three-dot compare answers about a branch. */
export interface BranchCompare {
  changedFiles: string[];
  filesTruncated: boolean;
  behindBy: number | null;
}

/** The branch's files and how far behind `main` it was, or null. */
const compareBranch = (
  repository: string,
  base: string,
  head: string,
): BranchCompare | null => {
  const payload = ghJsonOrNull([
    'api',
    `repos/${repository}/compare/${base}...${head}?per_page=${COMPARE_FILE_LIMIT}`,
  ]) as {
    behind_by?: number;
    files?: { filename?: string }[];
  } | null;
  if (!payload) return null;
  const files = (payload.files ?? [])
    .map((file) => String(file.filename ?? ''))
    .filter(Boolean);
  return {
    changedFiles: files,
    filesTruncated: files.length >= COMPARE_FILE_LIMIT,
    behindBy: Number.isFinite(payload.behind_by)
      ? Number(payload.behind_by)
      : null,
  };
};

export interface GatherOptions {
  workflow: string;
  since: string;
  until: string;
  limit: number;
  repository: string | null;
  useGithub: boolean;
  projectRoots: readonly string[];
}

/**
 * Reads every input the pure measurement needs. Separated from it so a
 * window can be saved and re-measured: a run's jobs stay readable for as
 * long as GitHub keeps the run, but the figures a report quotes should not
 * need a second trip to the API to be checked.
 */
export function gather({
  workflow,
  since,
  until,
  limit,
  repository,
  useGithub,
  projectRoots,
}: GatherOptions): CiDurationGather {
  const slug = useGithub ? (repository ?? currentRepository()) : null;
  const listed =
    useGithub && slug ? listRuns({ repository: slug, workflow, limit }) : [];
  const inWindow = listed.filter(
    (run) =>
      dateOnly(run.createdAt) >= since && dateOnly(run.createdAt) <= until,
  );
  // Three days of lead-in, so a run whose branch was last rebased just
  // before the window still finds the `main` tip it started from.
  const read =
    useGithub && slug
      ? listMainCommits({ repository: slug, since: shiftDays(since, 3), until })
      : { commits: [], incomplete: null };
  const mainCommits = read.commits;

  let withoutJobs = 0;
  let withTruncatedJobs = 0;
  let withoutCompare = 0;
  let withoutMainTip = 0;

  const runs: GatheredRun[] = inWindow.map((run): GatheredRun => {
    const jobsRead = slug ? readJobs(slug, run.databaseId) : null;
    if (!jobsRead) withoutJobs += 1;
    if (jobsRead?.truncated) withTruncatedJobs += 1;

    const tip = mainTipAt(mainCommits, run.createdAt);
    if (slug && tip === null) withoutMainTip += 1;
    const compared = slug && tip ? compareBranch(slug, tip, run.headSha) : null;
    if (slug && tip && !compared) withoutCompare += 1;

    return {
      runId: run.databaseId,
      headBranch: run.headBranch,
      headSha: run.headSha,
      createdAt: run.createdAt,
      conclusion: run.conclusion ?? null,
      event: run.event ?? 'pull_request',
      changedFiles: compared?.changedFiles ?? null,
      filesTruncated: compared?.filesTruncated ?? false,
      behindBy: compared?.behindBy ?? null,
      jobs: jobsRead?.jobs ?? [],
    };
  });

  const capped = useGithub && listed.length >= limit;
  const evidence: Record<string, string> = {
    'CI runs (`gh run list`)': !useGithub
      ? 'not read — no `gh`'
      : !slug
        ? 'not read — the repository could not be resolved'
        : `${listed.length} listed, ${inWindow.length} in the window` +
          (capped
            ? ` — the listing hit its --limit of ${limit}, so the window may extend past the oldest run read`
            : ''),
    'job and step timestamps (Actions API)':
      runs.length === 0
        ? 'no runs to read them for'
        : withoutJobs === 0
          ? `read for all ${runs.length} run(s)`
          : `unreadable for ${withoutJobs} of ${runs.length} run(s), which are out of every duration figure`,
    // Named for the API each key actually reads: the compare and the commit
    // listing are Repos endpoints (`repos/<slug>/compare`,
    // `repos/<slug>/commits`), and only the job and step timestamps above
    // come from the Actions API (`repos/<slug>/actions/...`). A reader of
    // this block is being told where a figure came from, so the wrong name
    // is the one thing it must not say.
    'branch compare (Repos API)':
      runs.length === 0
        ? 'no runs to read them for'
        : withoutCompare === 0 && withoutMainTip === 0
          ? `read for all ${runs.length} run(s)`
          : `unreadable for ${withoutCompare + withoutMainTip} of ${runs.length} run(s)` +
            ` (${withoutMainTip} with no \`main\` tip at run start), which stay unclassified` +
            ' and out of the stale-branch denominator',
    '`main` commits (Repos API)': !useGithub
      ? 'not read — no `gh`'
      : !slug
        ? 'not read — the repository could not be resolved'
        : `${mainCommits.length} read over the window and its lead-in` +
          (read.incomplete === null
            ? ''
            : ` — ${read.incomplete}, so a run older than the oldest commit read` +
              ' resolves no tip and stays unclassified'),
    'Nx project roots': `${projectRoots.length} read from ${PROJECT_ROOT_FILES.map((file) => `\`${file}\``).join(' and ')} files at this checkout`,
  };
  if (withTruncatedJobs > 0) {
    evidence['job listing'] =
      `${withTruncatedJobs} run(s) had more than 100 jobs; only the first page was read`;
  }

  return {
    window: { since, until },
    workflow,
    projectRoots: [...projectRoots],
    evidence,
    runs,
  };
}

/**
 * A flag that has to be a positive whole number, or the run cannot start.
 *
 * Checked before it is used rather than after: `--days` is the one window
 * flag the watch workflow exposes, as a free-text dispatch input, and
 * `shiftDays(until, NaN)` throws inside `toISOString` — a stack trace and
 * exit 1, where every other bad argument here is the exit-2 "could not run"
 * this script documents.
 */
const positiveInteger = (
  name: string,
  value: string | null | undefined,
  fallback: number,
): number => {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    bail(`--${name} must be a positive whole number (got ${value})`);
  }
  return parsed;
};

export const main = (argv: string[]): number => {
  const { flags } = parseArgs(argv);
  const days = positiveInteger('days', flags.days, DEFAULT_WINDOW_DAYS);
  const limit = positiveInteger('limit', flags.limit, DEFAULT_RUN_LIMIT);
  const until = flags.until ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    bail(`--until must be YYYY-MM-DD (got ${until})`);
  }
  const since = flags.since ?? shiftDays(until, days);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    bail(`--since must be YYYY-MM-DD (got ${since})`);
  }

  const replayed = flags.gathered
    ? (readJsonOr(flags.gathered, bail) as CiDurationGather)
    : null;
  const gathered =
    replayed ??
    gather({
      workflow: flags.workflow ?? CI_WORKFLOW,
      since,
      until,
      limit,
      repository: flags.repository ?? null,
      useGithub: !('no-github' in flags) && githubAvailable(),
      projectRoots: projectRootsUnder(REPO_ROOT),
    });
  if (flags['save-gather']) {
    writeFile(flags['save-gather'], `${JSON.stringify(gathered, null, 2)}\n`);
  }

  const summary = summarizeCiDuration(gathered);
  const markdown = renderCiDurationMeasurement(summary);
  if (flags.out) writeFile(flags.out, markdown);
  if (flags.json) {
    writeFile(flags.json, `${JSON.stringify(summary, null, 2)}\n`);
  }
  if (!flags.out) process.stdout.write(markdown);
  console.error(
    `ci-duration: ${summary.sample.runs} run(s) ${summary.window.since}..${summary.window.until}, ` +
      `${summary.sample.singleLibrary} Single-Library, ` +
      `p50 ${formatSeconds(summary.durations.singleLibrary.p50)}, ` +
      `${summary.verdict}, ${summary.signals.length} signal(s) tripped`,
  );
  return 0;
};

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));

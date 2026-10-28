#!/usr/bin/env node
// Measures the effective-false-positive rate (issue #729, PRD #713): per
// rule, the share of findings that were raised and were still there on the
// next push.
//
//   node tools/scripts/review/measure-noise.ts \
//     [--days 30 | --since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] \
//     [--workflow code-review.yml] [--branch <name>] [--limit 200] \
//     [--no-github] [--gathered <in.json>] [--save-gather <out.json>] \
//     [--out <report.md>] [--json <report.json>]
//
// The evidence is the review's own stored artifacts. Every run of the Code
// Review workflow uploads the normalized report it validated
// (`code-review-normalized`, retained 30 days), so the reviewer's history on
// a branch is a sequence of reports, one per reviewed push — which is what
// makes "still there on the next push" a fact rather than an impression.
// `gh` supplies the runs and the artifacts; git supplies the commit messages
// between two pushes, where an optional `Review-ack:` marker takes a finding
// out of the numerator.
//
// What could not be read is reported and never assumed: a push with no
// artifact makes the findings before it `unreadable`, a pair spanning a
// report schema bump is `incomparable`, and both are counted in the ledger
// rather than dropped from it.
//
// Not a gate. It reports a rate over stored history, has no fact to fail on
// for the commit in front of it, and reaches the network; it carries a
// written opt-out in tools/config/gate-coverage-optout.json.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cannotRun,
  dateOnly,
  gh,
  ghJsonOrNull,
  git,
  githubAvailable,
  isMain,
  parseArgs,
  readJsonOr,
  shiftDays,
  writeFile,
} from './cli.ts';
import type { BranchPushes, Push, PushCommit, ReportRead } from './noise.ts';
import {
  NOISE_BUDGET,
  renderNoiseMeasurement,
  summarizeNoise,
} from './noise.ts';

const bail = cannotRun('review-noise');

/** One run of the review workflow, as `gh run list` returns it. */
interface WorkflowRun {
  databaseId: number;
  headBranch: string;
  headSha: string;
  createdAt: string;
  conclusion?: string | null;
  event?: string;
}

/** One push in the gather: the run that reviewed it, and what answered it. */
interface GatheredPush extends Push {
  runId: number;
  createdAt: string;
  commitsRead?: boolean;
}

/** One branch's pushes in the gather, oldest first. */
interface GatheredBranch extends BranchPushes {
  branch: string;
  pushes: GatheredPush[];
}

/**
 * Everything the pure measurement needs. Worth saving: the artifacts expire
 * after 30 days, so a saved gather is the only durable record of a window.
 */
export interface NoiseGather {
  window: { since: string; until: string };
  workflow: string;
  evidence: Record<string, string>;
  branches: GatheredBranch[];
}

export const REVIEW_WORKFLOW = 'code-review.yml';
export const REPORT_ARTIFACT = 'code-review-normalized';

// ASCII record and field separators, as in measure-escaped-defects.ts: a
// commit body contains newlines and anything a friendlier delimiter would
// collide with, and node refuses to spawn a process carrying a NUL in its
// argument list, so the separators are asked for as git's own `%x..` escapes.
const RECORD = '\u001e';
const FIELD = '\u0000';

/**
 * The pushes a branch's workflow runs represent, oldest first.
 *
 * **One push, not one run.** The review runs again on the same head whenever
 * somebody asks it to — the `agent-review` label, a `/code-review` comment, a
 * re-dispatch — and two runs at one head sha have no push between them, so
 * pairing them would compare a report with itself and read every finding in
 * it as ignored. The newest run at a head wins, because that is the report
 * the next push was answering.
 *
 */
export const pushesFromRuns = (runs: WorkflowRun[] = []): WorkflowRun[] => {
  const byHead = new Map<string, WorkflowRun>();
  const oldestFirst = (a: WorkflowRun, b: WorkflowRun) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  for (const run of [...runs].sort(oldestFirst)) byHead.set(run.headSha, run);
  return [...byHead.values()].sort(oldestFirst);
};

/** Every run of the review workflow `gh` will name, newest first. */
const listRuns = ({
  workflow,
  limit,
}: {
  workflow: string;
  limit: number;
}): WorkflowRun[] =>
  (ghJsonOrNull([
    'run',
    'list',
    '--workflow',
    workflow,
    '--json',
    'databaseId,headBranch,headSha,createdAt,conclusion,event',
    '--limit',
    String(limit),
  ]) as WorkflowRun[] | null) ?? [];

/** The normalized report a run stored, or null when nothing can be read. */
const downloadReport = (runId: number): ReportRead | null => {
  const dir = mkdtempSync(join(tmpdir(), 'review-noise-'));
  try {
    gh([
      'run',
      'download',
      String(runId),
      '--name',
      REPORT_ARTIFACT,
      '--dir',
      dir,
    ]);
    return JSON.parse(
      readFileSync(join(dir, 'normalized.json'), 'utf8'),
    ) as ReportRead;
  } catch {
    return null;
  }
};

/**
 * The commits one push brought in, as `{ sha, message }`, or null.
 *
 * `cwd` is the clone to ask; it defaults to the process's own and is passed
 * explicitly by the test, which builds a repository whose commits it wrote
 * rather than asserting against whatever history it happens to be run in.
 */
export const commitsBetween = (
  from?: string | null,
  to?: string | null,
  cwd?: string,
): PushCommit[] | null => {
  if (!from || !to) return null;
  try {
    return git(['log', `${from}..${to}`, `--format=%H%x00%B%x1e`], { cwd })
      .split(RECORD)
      .map((entry) => entry.replace(/^\n/, ''))
      .filter((entry) => entry.trim())
      .map((entry) => {
        const [sha, message = ''] = entry.split(FIELD);
        return { sha, message };
      });
  } catch {
    // A sha this clone does not have: a deleted branch, a force-push, a
    // shallow checkout. The acknowledgement marker cannot be read for that
    // push, and the evidence block says how often that happened.
    return null;
  }
};

/**
 * Reads every input the pure measurement needs. Separated from it so a
 * gather can be saved and re-measured — the artifacts expire after 30 days,
 * which makes a saved gather the only durable record of a window.
 */
export const gather = ({
  workflow,
  since,
  until,
  branch,
  limit,
  useGithub,
}: {
  workflow: string;
  since: string;
  until: string;
  branch: string | null;
  limit: number;
  useGithub: boolean;
}): NoiseGather => {
  const runs = useGithub ? listRuns({ workflow, limit }) : [];
  const inWindow = runs.filter(
    (r) =>
      dateOnly(r.createdAt) >= since &&
      dateOnly(r.createdAt) <= until &&
      (!branch || r.headBranch === branch),
  );

  const byBranch = new Map<string, WorkflowRun[]>();
  for (const run of inWindow) {
    if (!byBranch.has(run.headBranch)) byBranch.set(run.headBranch, []);
    byBranch.get(run.headBranch)!.push(run);
  }

  let withoutReport = 0;
  let withoutCommits = 0;
  const branches = [...byBranch.entries()]
    .map(([name, runsOnBranch]): GatheredBranch => {
      const pushes = pushesFromRuns(runsOnBranch).map((run): GatheredPush => {
        const report = downloadReport(run.databaseId);
        if (!report) withoutReport += 1;
        return {
          runId: run.databaseId,
          createdAt: run.createdAt,
          headSha: run.headSha,
          report,
        };
      });
      for (let i = 1; i < pushes.length; i += 1) {
        const commits = commitsBetween(
          pushes[i - 1].headSha,
          pushes[i].headSha,
        );
        if (commits === null) withoutCommits += 1;
        pushes[i].commits = commits ?? [];
        pushes[i].commitsRead = commits !== null;
      }
      return { branch: name, pushes };
    })
    // Oldest branch activity first, so a saved gather reads chronologically.
    .sort((a, b) =>
      String(a.pushes[0]?.createdAt).localeCompare(
        String(b.pushes[0]?.createdAt),
      ),
    );

  const pushCount = branches.reduce((n, b) => n + b.pushes.length, 0);
  // `gh run list` returns the newest `limit` runs and says nothing about what
  // it left behind, so a window wider than the listing is silently short a
  // sample. The cap is reported rather than raised: a reader can widen
  // `--limit`, and a sample nobody was told was truncated reads as complete.
  const capped = useGithub && runs.length >= limit;
  const evidence = {
    'review runs (gh)': useGithub
      ? `${runs.length} listed, ${inWindow.length} in the window, ${pushCount} distinct pushes` +
        (capped
          ? ` — the listing hit its --limit of ${limit}, so the window may extend past the oldest run read`
          : '')
      : 'not read — no `gh`',
    [`stored reports (gh, \`${REPORT_ARTIFACT}\`)`]: useGithub
      ? `${pushCount - withoutReport} of ${pushCount} pushes carry one`
      : 'not read — no `gh`',
    'commit messages (git)': useGithub
      ? withoutCommits === 0
        ? 'read for every push'
        : `unreadable for ${withoutCommits} push(es) — an acknowledgement in one of them was not seen`
      : 'not read — no runs to read them for',
    'artifact retention':
      '30 days; anything older is gone and cannot be re-gathered',
  };

  return { window: { since, until }, workflow, evidence, branches };
};

export const main = (argv: string[]): number => {
  const { flags } = parseArgs(argv);
  const until = flags.until ?? new Date().toISOString().slice(0, 10);
  const since = flags.since ?? shiftDays(until, Number(flags.days ?? 30));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until))
    bail(`--since and --until must be YYYY-MM-DD (got ${since}, ${until})`);

  const replayed = flags.gathered
    ? (readJsonOr(flags.gathered, bail) as NoiseGather)
    : null;
  const gathered =
    replayed ??
    gather({
      workflow: flags.workflow ?? REVIEW_WORKFLOW,
      since,
      until,
      branch: flags.branch ?? null,
      limit: Number(flags.limit ?? 200),
      useGithub: !('no-github' in flags) && githubAvailable(),
    });
  if (flags['save-gather'])
    writeFile(flags['save-gather'], `${JSON.stringify(gathered, null, 2)}\n`);

  const summary = summarizeNoise({ ...gathered, budget: NOISE_BUDGET });
  const markdown = renderNoiseMeasurement(summary);
  if (flags.out) writeFile(flags.out, markdown);
  if (flags.json)
    writeFile(flags.json, `${JSON.stringify(summary, null, 2)}\n`);
  if (!flags.out) process.stdout.write(markdown);
  console.error(
    `review-noise: ${summary.sample.pushes} pushes on ${summary.sample.branches} branch(es) ` +
      `${summary.window.since}..${summary.window.until}, ${summary.observations} observations, ` +
      `rate ${summary.rate === null ? 'not measurable' : `${(100 * summary.rate).toFixed(1)}%`}, ` +
      `${summary.overBudget.length} rule(s) over the ${(100 * NOISE_BUDGET.rate).toFixed(0)}% budget`,
  );
  return 0;
};

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));

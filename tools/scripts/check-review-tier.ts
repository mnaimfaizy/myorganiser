#!/usr/bin/env node
// The Review Tier classifier as a Wired Gate (ADR 0070 item 2).
//
//   node tools/scripts/check-review-tier.ts --base <sha> --head <sha> \
//     [--author <login>] [--graph <nx-graph.json>] [--files <numstat.json>] \
//     [--out <report.json>] [--summary <summary.md>] [--print]
//
// Reads the diff (`git diff --numstat -M base...head`), the Nx project graph,
// and tools/config/review-tier-paths.json, and prints the tier with every
// signal that fired. When run under GitHub Actions it also appends `tier` and
// `label` to $GITHUB_OUTPUT and the Markdown summary to $GITHUB_STEP_SUMMARY,
// so the job output is the truth and the label is a view of it (item 3).
//
// `--files` accepts a JSON array of `{ path, additions, deletions }` and skips
// git, which is how the replay feeds it two hundred merged Pull Requests.
//
// Exit 0 = classified. Exit 2 = could not run; the report is still written
// with tier `human`, because an error in the classifier is a human tier, not
// a missing one (item 1).
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { gh } from './lib/gh.ts';
import { loadProjectGraph } from './lib/nx-graph.ts';
import {
  classifyReviewTier,
  errorResult,
  loadPathMap,
  parseNumstat,
  renderReviewTierSummary,
  type DiffFile,
  type ReviewTierResult,
} from './lib/review-tier.ts';

const args = process.argv.slice(2);
const opt = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const has = (flag: string) => args.includes(flag);

const base = opt('--base');
const head = opt('--head');
const filesArg = opt('--files');
let author = opt('--author') ?? process.env.PR_AUTHOR;

const writeOut = (path: string | undefined, text: string) => {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const finish: (result: ReviewTierResult, code: number) => never = (
  result,
  code,
) => {
  const summary = renderReviewTierSummary(result, { base, head });
  writeOut(opt('--out'), `${JSON.stringify(result, null, 2)}\n`);
  writeOut(opt('--summary'), summary);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `tier=${result.tier}\nlabel=${result.label}\n`,
    );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (has('--print')) console.log(JSON.stringify(result, null, 2));
  const fired = result.signals
    .filter((s) => s.tier === result.tier)
    .map((s) => (s.id ? `${s.kind}:${s.id}` : s.kind));
  console.log(
    `review-tier: ${result.label} (${result.size.files} files, ${result.size.lines} lines; ${fired.join(', ')})`,
  );
  process.exit(code);
};

const cannotRun: (message: string) => never = (message) => {
  console.error(`review-tier: ${message}`);
  finish(errorResult(message, author), 2);
};

try {
  let files: DiffFile[];
  if (filesArg) {
    files = JSON.parse(readFileSync(filesArg, 'utf8'));
  } else {
    if (!base || !head)
      cannotRun('--base and --head are required (or --files)');
    files = parseNumstat(
      execFileSync('git', ['diff', '--numstat', '-M', `${base}...${head}`], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  }

  if (!author && !process.env.GITHUB_ACTIONS) {
    // Local convenience only: CI always passes the Pull Request author.
    try {
      author = gh(['api', 'user', '--jq', '.login']).trim();
      console.error(
        `review-tier: --author not given, using gh login ${author}`,
      );
    } catch {
      /* stays undefined → human */
    }
  }

  const graph = loadProjectGraph(opt('--graph'));
  const pathMap = loadPathMap();
  finish(classifyReviewTier({ files, graph, pathMap, author }), 0);
} catch (err) {
  cannotRun(err instanceof Error ? err.message : String(err));
}

#!/usr/bin/env node
// Replays the Review Tier classifier over merged Pull Requests (ADR 0070,
// Consequences): "run it over the last two hundred merged Pull Requests and
// hand-check the tiering before it gates anything."
//
//   node tools/scripts/review/replay-review-tier.ts [--limit 200] \
//     [--graph <nx-graph.json>] [--out <report.md>] [--json <report.json>]
//
// Each Pull Request's file list, additions, deletions, and author come from
// `gh pr list`. The graph, the tags, and the path map are today's: a project
// that has moved or been retagged since the Pull Request merged is classified
// as it stands now, which is the question the replay answers (would the
// current rules have tiered this right?), not a reconstruction of history.
//
// Not a gate: it reports a distribution and has nothing to fail on.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { ghJson } from '../lib/gh.ts';
import { loadProjectGraph } from '../lib/nx-graph.ts';
import type {
  ReviewTier,
  ReviewTierResult,
  SignalKind,
} from '../lib/review-tier.ts';
import {
  REVIEW_TIERS,
  classifyReviewTier,
  loadPathMap,
} from '../lib/review-tier.ts';

/** One merged Pull Request, as `gh pr list` returns it. */
interface MergedPullRequest {
  number: number;
  title: string;
  author?: { login?: string } | null;
  files: { path: string; additions: number; deletions: number }[];
  additions: number;
  deletions: number;
  mergedAt: string;
  labels: { name: string }[];
}

/** One replayed row: the tier today's rules would give that Pull Request. */
interface ReplayRow {
  number: number;
  title: string;
  author: string | undefined;
  mergedAt: string;
  labels: string[];
  tier: ReviewTier;
  files: number;
  lines: number;
  projects: number;
  decisive: string[];
  withoutSize: ReviewTier;
  withoutBlast: ReviewTier;
}

const args = process.argv.slice(2);
const opt = (flag: string, fallback?: string): string | undefined => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};
const limit = Number(opt('--limit', '200'));

const prs = ghJson(
  [
    'pr',
    'list',
    '--state',
    'merged',
    '--base',
    'main',
    '--limit',
    String(limit),
    '--json',
    'number,title,author,files,additions,deletions,mergedAt,labels',
  ],
  { maxBuffer: 256 * 1024 * 1024 },
) as MergedPullRequest[];

const graph = loadProjectGraph(opt('--graph'));
const pathMap = loadPathMap();

const rows = prs.map((pr): ReplayRow => {
  const files = pr.files.map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
  }));
  const result = classifyReviewTier({
    files,
    graph,
    pathMap,
    author: pr.author?.login ?? undefined,
  });
  const decisive = result.signals
    .filter((s) => s.tier === result.tier)
    .map((s) => (s.id ? `${s.kind}:${s.id}` : s.kind));
  return {
    number: pr.number,
    title: pr.title,
    author: pr.author?.login ?? undefined,
    mergedAt: pr.mergedAt,
    labels: pr.labels.map((l) => l.name),
    tier: result.tier,
    files: result.size.files,
    lines: result.size.lines,
    projects: result.projects.changed.length + result.projects.reached.length,
    decisive,
    // What the tier would be if only this kind of signal were relaxed: shows
    // which rule is doing the work when tuning thresholds.
    withoutSize: maxExcluding(result, ['size']),
    withoutBlast: maxExcluding(result, ['blast-radius']),
  };
});

function maxExcluding(
  result: ReviewTierResult,
  kinds: readonly SignalKind[],
): ReviewTier {
  return result.signals
    .filter((s) => !kinds.includes(s.kind))
    .reduce<ReviewTier>(
      (acc, s) =>
        REVIEW_TIERS.indexOf(s.tier) > REVIEW_TIERS.indexOf(acc) ? s.tier : acc,
      'auto',
    );
}

const count = (key: 'tier' | 'withoutSize' | 'withoutBlast') =>
  rows.reduce<Record<string, number>>((acc, r) => {
    acc[r[key]] = (acc[r[key]] ?? 0) + 1;
    return acc;
  }, {});
const distribution = count('tier');
const decisiveCounts: Record<string, number> = {};
for (const r of rows)
  for (const d of r.decisive) decisiveCounts[d] = (decisiveCounts[d] ?? 0) + 1;
const percent = (n: number) => `${Math.round((100 * n) / rows.length)}%`;

const md = [
  `# Review Tier replay (${new Date().toISOString().slice(0, 10)})`,
  '',
  `${rows.length} merged Pull Requests into \`main\`, classified with today's graph, tags, and path map.`,
  '',
  '## Distribution',
  '',
  '| Tier | Pull Requests | Share | Without size signal | Without blast-radius signal |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...REVIEW_TIERS.map(
    (t) =>
      `| \`${t}\` | ${distribution[t] ?? 0} | ${percent(distribution[t] ?? 0)} | ${count('withoutSize')[t] ?? 0} | ${count('withoutBlast')[t] ?? 0} |`,
  ),
  '',
  '## Decisive signals',
  '',
  'How often each signal set the final tier (a Pull Request may have several).',
  '',
  '| Signal | Pull Requests |',
  '| --- | ---: |',
  ...Object.entries(decisiveCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `| \`${k}\` | ${n} |`),
  '',
  '## Pull Requests',
  '',
  '| PR | Tier | Files | Lines | Projects | Decisive | Title |',
  '| --- | --- | ---: | ---: | ---: | --- | --- |',
  ...rows.map(
    (r) =>
      `| #${r.number} | \`${r.tier}\` | ${r.files} | ${r.lines} | ${r.projects} | ${r.decisive.map((d) => `\`${d}\``).join(' ')} | ${r.title.replace(/\|/g, '\\|')} |`,
  ),
  '',
].join('\n');

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const outPath = opt('--out');
const jsonPath = opt('--json');
if (outPath) write(outPath, md);
if (jsonPath) write(jsonPath, `${JSON.stringify(rows, null, 2)}\n`);
if (!outPath) process.stdout.write(md);
console.error(
  `review-tier replay: ${rows.length} PRs → ${REVIEW_TIERS.map((t) => `${t} ${distribution[t] ?? 0}`).join(', ')}`,
);

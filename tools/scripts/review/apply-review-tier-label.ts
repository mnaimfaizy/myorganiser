#!/usr/bin/env node
// Applies the Review Tier label the classifier already wrote to
// $GITHUB_OUTPUT. The label is a display of the job output, never the truth
// (ADR 0070 item 3), so a GitHub GraphQL flake here must not fail the
// required Review Tier check. Incident: run 34955049214 on #789 failed
// `gh pr edit` with "GraphQL: Something went wrong while executing your
// query" after the classifier had already emitted `review:agent`.
//
//   node tools/scripts/review/apply-review-tier-label.ts \
//     --pr <n> --label <review:auto|review:agent|review:human> --repo <owner/name>
//
// Exit 0 = applied, already present, or could not apply after retries (the
// job output still stands). Exit 2 = the script could not run (missing args).
import { setTimeout as delay } from 'node:timers/promises';

import { REVIEW_TIER_LABELS, planRelabel } from '../lib/review-tier.ts';
import type { Bail } from './cli.ts';
import { cannotRun, firstLine, gh, ghJson, isMain, parseArgs } from './cli.ts';

export const DEFAULT_ATTEMPTS = 3;

/** Whether the label was applied, and the one-word reason. */
export interface RelabelOutcome {
  applied: boolean;
  reason: string;
}

export async function applyReviewTierLabel({
  pr,
  label,
  repo,
  attempts = DEFAULT_ATTEMPTS,
  ghJsonCall = ghJson,
  ghCall = gh,
  sleep = delay,
  warn = (msg: string) => console.error(`apply-review-tier-label: ${msg}`),
}: {
  pr: string | number;
  label: string;
  repo: string;
  attempts?: number;
  ghJsonCall?: typeof ghJson;
  ghCall?: typeof gh;
  sleep?: (ms: number) => Promise<unknown>;
  warn?: (msg: string) => void;
}): Promise<RelabelOutcome> {
  if (!(REVIEW_TIER_LABELS as readonly string[]).includes(label)) {
    warn(
      `${label} is not a review:* label; the job output still stands (ADR 0070 item 3)`,
    );
    return { applied: false, reason: 'not-a-review-tier-label' };
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const view = ghJsonCall([
        'pr',
        'view',
        String(pr),
        '--repo',
        repo,
        '--json',
        'labels',
      ]) as { labels?: { name: string }[] } | null;
      const current = (view?.labels ?? []).map((item) => item.name);
      const plan = planRelabel(current, label);
      if (!plan) return { applied: true, reason: 'already-labelled' };
      const args = ['pr', 'edit', String(pr), '--repo', repo];
      for (const name of plan.add) args.push('--add-label', name);
      for (const name of plan.remove) args.push('--remove-label', name);
      ghCall(args);
      return { applied: true, reason: 'updated' };
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(attempt * 1000);
    }
  }

  warn(
    `could not apply ${label} after ${attempts} attempts: ${firstLine(lastError)}; the job output still stands (ADR 0070 item 3)`,
  );
  return { applied: false, reason: 'exhausted-retries' };
}

const runCli = async () => {
  const fail: Bail = cannotRun('apply-review-tier-label');
  const { flags } = parseArgs(process.argv.slice(2));
  if (!flags.pr) fail('--pr is required');
  if (!flags.label) fail('--label is required');
  if (!flags.repo) fail('--repo is required');
  await applyReviewTierLabel({
    pr: flags.pr,
    label: flags.label,
    repo: flags.repo,
  });
};

if (isMain(import.meta.url)) {
  runCli().catch((err) => {
    console.error(`apply-review-tier-label: ${firstLine(err)}`);
    process.exit(0);
  });
}

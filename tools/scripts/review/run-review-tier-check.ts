#!/usr/bin/env node
// Shared empty-tier backfill for Review Tier and Code Review (#790).
//
// A crash before check-review-tier.ts finish() used to leave $GITHUB_OUTPUT
// empty, so `--tier` failed the validator and cascaded into Agent Review Ran
// plus Publish Review. Both workflows used to carry matching grep/echo shell
// for that; they already diverge in exit policy, which is why this script
// takes --mode instead of duplicating the grep.
//
// The workflows run `yarn review:tier:check` themselves so the Meta-Gate
// sees the checker by exact script name (ADR 0043). This script only backfills
// and chooses the step's exit code — it does not spawn the classifier:
//
//   node tools/scripts/review/run-review-tier-check.ts \
//     --mode required|advisory --status <classifier-exit>
//
// --mode required  Review Tier: keep the classifier's exit code; a silent
//                  miss (exit 0 and no label=review: line) becomes 2 so the
//                  required check still fails visibly.
// --mode advisory  Code Review: always exit 0 so the reviewer still runs at
//                  review:human.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { cannotRun, isMain, parseArgs } from './cli.ts';

export const HUMAN_OUTPUT = 'tier=human\nlabel=review:human\n';
export const BACKFILL_WARNING =
  '::warning::classifier wrote no tier; defaulting to review:human';

export const hasReviewTierLabel = (text) =>
  /(?:^|\n)label=review:/.test(text ?? '');

export const backfillReviewTierOutput = (text) => {
  if (hasReviewTierLabel(text)) return { text: text ?? '', backfilled: false };
  const body = text ?? '';
  const prefix = body.length === 0 || body.endsWith('\n') ? '' : '\n';
  return { text: `${body}${prefix}${HUMAN_OUTPUT}`, backfilled: true };
};

/**
 * Append `tier=human` / `label=review:human` to $GITHUB_OUTPUT when the
 * classifier wrote nothing. Appends rather than rewriting so other step
 * output GitHub already placed there is kept.
 *
 * @returns {{ backfilled: boolean }}
 */
export const applyGithubOutputBackfill = (
  githubOutputPath,
  {
    read = readFileSync,
    append = appendFileSync,
    exists = existsSync,
    warn = (msg) => console.error(msg),
  } = {},
) => {
  if (!githubOutputPath) return { backfilled: false };
  const current = exists(githubOutputPath)
    ? read(githubOutputPath, 'utf8')
    : '';
  if (hasReviewTierLabel(current)) return { backfilled: false };
  const prefix = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  append(githubOutputPath, `${prefix}${HUMAN_OUTPUT}`);
  warn(BACKFILL_WARNING);
  return { backfilled: true };
};

export const exitStatusAfterBackfill = ({
  mode,
  classifierStatus,
  backfilled,
}) => {
  if (mode === 'advisory') return 0;
  if (backfilled && classifierStatus === 0) return 2;
  return classifierStatus;
};

/**
 * @param {{
 *   mode: 'required' | 'advisory',
 *   classifierStatus: number | null,
 *   githubOutput?: string,
 * }} input
 */
export const runReviewTierCheck = ({
  mode,
  classifierStatus,
  githubOutput,
}) => {
  if (mode !== 'required' && mode !== 'advisory') {
    throw new Error('--mode must be required or advisory');
  }
  const status = classifierStatus ?? 2;
  const { backfilled } = applyGithubOutputBackfill(githubOutput);
  return exitStatusAfterBackfill({
    mode,
    classifierStatus: status,
    backfilled,
  });
};

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const fail = cannotRun('run-review-tier-check');
  if (flags.mode !== 'required' && flags.mode !== 'advisory') {
    fail('--mode required|advisory is required');
  }
  if (flags.status === undefined || flags.status === null) {
    fail('--status <classifier-exit> is required after yarn review:tier:check');
  }
  const classifierStatus = Number.parseInt(flags.status, 10);
  if (!Number.isInteger(classifierStatus)) fail('--status must be an integer');
  process.exit(
    runReviewTierCheck({
      mode: flags.mode,
      classifierStatus,
      githubOutput: process.env.GITHUB_OUTPUT,
    }),
  );
}

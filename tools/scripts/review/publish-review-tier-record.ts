#!/usr/bin/env node
// Publishes the per-commit Review Tier record (#1526): one marker comment on
// the Pull Request naming the full head commit and the tier, edited in place.
//
//   node tools/scripts/review/publish-review-tier-record.ts \
//     --pr <n> --tier <auto|agent|human> --head <sha> --repo <owner/name>
//
// The Merge Train reads it for the head it merges (ADR 0148); the label is
// never read. A publish error never fails the job: it is logged, no record
// then exists for that head, and the train reads that as human. Exit 0 unless
// the arguments are missing (exit 2).
import { isReviewTier } from '../lib/review-tier.ts';
import {
  planReviewTierRecord,
  type RecordComment,
  type RecordWrite,
} from '../lib/review-tier-record.ts';
import type { Bail } from './cli.ts';
import { cannotRun, firstLine, gh, isMain, parseArgs } from './cli.ts';

/** `gh api --paginate`'s `--jq` output: one compact JSON object per line. */
export const parseCommentLines = (text: string): RecordComment[] =>
  text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RecordComment);

export function publishReviewTierRecord({
  pr,
  repo,
  headRefOid,
  tier,
  ghCall = gh,
  warn = (msg: string) => console.error(`publish-review-tier-record: ${msg}`),
}: {
  pr: string;
  repo: string;
  headRefOid: string;
  tier: string;
  ghCall?: typeof gh;
  warn?: (msg: string) => void;
}): { write: RecordWrite['action'] | 'failed' } {
  if (!isReviewTier(tier) || !/^[0-9a-f]{40}$/.test(headRefOid)) {
    warn(`not a tier and a full commit: ${tier} ${headRefOid}`);
    return { write: 'failed' };
  }
  try {
    const comments = parseCommentLines(
      ghCall([
        'api',
        '--paginate',
        `repos/${repo}/issues/${pr}/comments`,
        '--jq',
        '.[] | {id: .id, login: .user.login, body: .body}',
      ]),
    );
    const plan = planReviewTierRecord({ comments, headRefOid, tier });
    if (plan.action === 'create')
      ghCall([
        'api',
        '--method',
        'POST',
        `repos/${repo}/issues/${pr}/comments`,
        '-f',
        `body=${plan.body}`,
      ]);
    if (plan.action === 'update')
      ghCall([
        'api',
        '--method',
        'PATCH',
        `repos/${repo}/issues/comments/${plan.id}`,
        '-f',
        `body=${plan.body}`,
      ]);
    return { write: plan.action };
  } catch (err) {
    warn(
      `could not publish the record for ${headRefOid}: ${firstLine(err)}; the train reads human`,
    );
    return { write: 'failed' };
  }
}

if (isMain(import.meta.url)) {
  const fail: Bail = cannotRun('publish-review-tier-record');
  const { flags } = parseArgs(process.argv.slice(2));
  if (!flags.pr) fail('--pr is required');
  if (!flags.tier) fail('--tier is required');
  if (!flags.head) fail('--head is required');
  if (!flags.repo) fail('--repo is required');
  const { write } = publishReviewTierRecord({
    pr: flags.pr!,
    repo: flags.repo!,
    headRefOid: flags.head!,
    tier: flags.tier!,
  });
  console.log(`review-tier-record: ${write}`);
}

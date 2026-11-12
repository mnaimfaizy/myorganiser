/**
 * The Merge Train's judgments (issue #1376's 2026-11-11 resolution).
 *
 * `main`'s ruleset requires branches to be up to date before merging
 * (strict required status checks), so the exact code that lands has passed.
 * A batch of Standalone Runs breaks that the moment one of them merges: every
 * other branch in the batch is now behind, and merging it through the admin
 * bypass lands a combined tree that no check ever ran on. That is how #1441
 * and #1446 each passed alone and broke Typecheck on `main` together.
 *
 * The train merges a list of Pull Requests one at a time, in the order given:
 * bring the branch up to date, wait for every required check on that new
 * head, merge exactly that head without `--admin`, then move to the next. It
 * stops at the first thing it cannot pass on its own — a red required check,
 * a conflict, a draft, a review it needs — and names it.
 *
 * This module is the decision and nothing else: `decideNext` reads one
 * snapshot of a Pull Request and says what to do with it. The `gh` calls, the
 * polling and the clock live in `tools/scripts/ci/merge-train.ts`, so every
 * branch of the decision is asserted over fixtures.
 *
 * Run the tests with: node --test tools/scripts/lib/merge-train.test.ts
 */

import {
  readTrustedReview,
  type ReviewComment,
  type ReviewOutcome,
  type ReviewRead,
} from '../review/escaped-defects.ts';
import type { Verdict } from '../review/schema.ts';
import { sep } from 'node:path';

import {
  assertPathMap,
  humanRuleFor,
  REVIEW_TIER_PATHS_CONFIG,
  type ReviewTier,
  type ReviewTierPathMap,
} from './review-tier.ts';
import {
  parseReviewTierRecord,
  isReviewTierRecordBody,
} from './review-tier-record.ts';
import { SUMMARY_AUTHOR_LOGIN } from '../review/publish.ts';

/** The branch the train merges into, and whose ruleset it reads. */
export const TRAIN_BASE = 'main';

/** Seconds between two reads of a Pull Request that is still waiting. */
export const DEFAULT_POLL_SECONDS = 30;

/**
 * How long one Pull Request may wait for its checks before the train stops.
 * A PR run's p90 is about 13 minutes; three of those is a run that is stuck,
 * not slow.
 */
export const DEFAULT_TIMEOUT_MINUTES = 45;

/**
 * How many times one Pull Request may be brought up to date. Each update
 * happens only because `main` moved under it — another merge landed between
 * its checks finishing and its own merge. Past this, something else is
 * merging into `main` as fast as the train is, and a person should look.
 */
export const MAX_UPDATES_PER_PULL_REQUEST = 3;

/**
 * Consecutive reads GitHub may report `BLOCKED` while every required check is
 * green. Its merge state lags a check's completion by a few seconds, so one
 * such read is noise; several in a row means something other than the checks
 * is holding the merge — a review, or a rule the train does not know.
 */
export const MAX_BLOCKED_GREEN_READS = 4;

/**
 * How many times GitHub may refuse to merge one Pull Request whose every
 * required check is green. A refusal because `main` moved reads back as
 * `BEHIND` and is updated instead; a refusal that keeps happening on a green,
 * up-to-date head is a rule the train does not know, and retrying it is a
 * loop, not a wait.
 */
export const MAX_MERGE_REFUSALS = 3;

/** The merge methods `main`'s ruleset allows. */
export const MERGE_METHODS = ['merge', 'squash', 'rebase'] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

/** What `gh pr checks --json bucket` reports for one check. */
export type CheckBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';

/** One check run on the Pull Request's head, as `gh pr checks` lists it. */
export interface CheckRun {
  name: string;
  bucket: CheckBucket | string;
  /** When it started; picks the newest of two runs that share a name. */
  startedAt?: string | null;
}

/** One read of one Pull Request: what `gh pr view` and `gh pr checks` say. */
export interface PullRequestSnapshot {
  number: number;
  /** `OPEN`, `MERGED` or `CLOSED`. */
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefOid: string;
  /**
   * GitHub's `mergeStateStatus`: `BEHIND`, `BLOCKED`, `CLEAN`, `DIRTY`,
   * `HAS_HOOKS`, `UNSTABLE` or `UNKNOWN`.
   */
  mergeStateStatus: string;
  /** `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or empty. */
  reviewDecision?: string | null;
  checks: readonly CheckRun[];
  /** The description, where an Auto-merge reads the Merge Danger Door. */
  body?: string | null;
}

/** What the required checks on one head add up to. */
export interface RequiredCheckState {
  /** Required checks that failed or were cancelled, by name. */
  red: string[];
  /** Required checks still running, or not yet reported on this head. */
  waiting: string[];
  /** Required checks that passed or were skipped, by name. */
  green: string[];
}

/** What to do with one Pull Request after one read of it. */
export type TrainStep =
  | { kind: 'merged' }
  | { kind: 'update' }
  /**
   * `blockedGreen` marks the one wait that counts toward
   * `MAX_BLOCKED_GREEN_READS`: `BLOCKED` with every required check green.
   */
  | { kind: 'wait'; reason: string; blockedGreen?: true }
  | { kind: 'merge'; headRefOid: string }
  | { kind: 'stop'; reason: string };

/**
 * The required status checks for `main`, from the branch-rules endpoint
 * (`repos/<slug>/rules/branches/main`), which merges every active ruleset
 * that targets the branch. Read from GitHub rather than kept in a list here,
 * so a check added to the ruleset is waited on the day it is added.
 */
export function requiredChecksFromRules(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  const names = new Set<string>();
  for (const rule of rules as {
    type?: string;
    parameters?: { required_status_checks?: { context?: string }[] };
  }[]) {
    if (rule?.type !== 'required_status_checks') continue;
    for (const check of rule.parameters?.required_status_checks ?? []) {
      if (check?.context) names.add(check.context);
    }
  }
  return [...names].sort();
}

/**
 * Sorts each required check into red, waiting or green.
 *
 * A required check with no run on this head is **waiting**, never green: right
 * after an update the new head has no checks yet, and reading their absence as
 * a pass is exactly the merge of an unchecked tree the train exists to stop.
 * `skipping` is green because GitHub itself counts a skipped required check as
 * passing — the path-gated jobs report that way when their files did not
 * change. When one name has several runs (a re-run), the newest decides.
 */
export function requiredCheckState(
  required: readonly string[],
  checks: readonly CheckRun[],
): RequiredCheckState {
  const newest = new Map<string, CheckRun>();
  for (const check of checks) {
    const seen = newest.get(check.name);
    if (!seen || (check.startedAt ?? '') >= (seen.startedAt ?? '')) {
      newest.set(check.name, check);
    }
  }
  const state: RequiredCheckState = { red: [], waiting: [], green: [] };
  for (const name of required) {
    const bucket = newest.get(name)?.bucket;
    if (bucket === 'fail' || bucket === 'cancel') state.red.push(name);
    else if (bucket === 'pass' || bucket === 'skipping') state.green.push(name);
    else state.waiting.push(name);
  }
  return state;
}

/** Merge states in which GitHub will take the merge as asked. */
const MERGEABLE_STATES = new Set(['CLEAN', 'UNSTABLE', 'HAS_HOOKS']);

/**
 * What to do next with one Pull Request.
 *
 * The order is the decision. A branch that is behind is updated **before**
 * its checks are read, because checks on a stale head say nothing about the
 * tree that would land. A red required check stops the train before anything
 * else is waited on, because no amount of waiting turns it green. And the
 * merge is of `headRefOid` exactly — the head whose checks were just read —
 * so a push that lands between the read and the merge makes the merge fail
 * rather than land an unchecked commit.
 *
 * `blockedGreenReads` is how many reads in a row, before this one, found the
 * Pull Request `BLOCKED` with every required check green.
 */
export function decideNext(
  pr: PullRequestSnapshot,
  required: readonly string[],
  { blockedGreenReads = 0 }: { blockedGreenReads?: number } = {},
): TrainStep {
  if (pr.state === 'MERGED') return { kind: 'merged' };
  if (pr.state !== 'OPEN') {
    return {
      kind: 'stop',
      reason: `#${pr.number} is ${pr.state.toLowerCase()}`,
    };
  }
  if (pr.isDraft) return { kind: 'stop', reason: `#${pr.number} is a draft` };
  if (pr.baseRefName !== TRAIN_BASE) {
    return {
      kind: 'stop',
      reason: `#${pr.number} targets \`${pr.baseRefName}\`, not \`${TRAIN_BASE}\``,
    };
  }
  if (pr.mergeStateStatus === 'DIRTY') {
    return {
      kind: 'stop',
      reason: `#${pr.number} conflicts with \`${TRAIN_BASE}\`; rebase it by hand, then run the train again from it`,
    };
  }
  if (pr.mergeStateStatus === 'BEHIND') return { kind: 'update' };

  const checks = requiredCheckState(required, pr.checks);
  if (checks.red.length > 0) {
    return {
      kind: 'stop',
      reason: `#${pr.number} has a red required check: ${checks.red.join(', ')}`,
    };
  }
  if (checks.waiting.length > 0) {
    return {
      kind: 'wait',
      reason: `waiting on ${checks.waiting.join(', ')}`,
    };
  }

  if (
    pr.reviewDecision === 'CHANGES_REQUESTED' ||
    pr.reviewDecision === 'REVIEW_REQUIRED'
  ) {
    return {
      kind: 'stop',
      reason: `#${pr.number} needs a review (${pr.reviewDecision})`,
    };
  }
  if (MERGEABLE_STATES.has(pr.mergeStateStatus)) {
    return { kind: 'merge', headRefOid: pr.headRefOid };
  }
  if (pr.mergeStateStatus === 'BLOCKED') {
    return blockedGreenReads + 1 >= MAX_BLOCKED_GREEN_READS
      ? {
          kind: 'stop',
          reason:
            `#${pr.number} stays BLOCKED with every required check green; ` +
            'something other than the checks is holding it',
        }
      : {
          kind: 'wait',
          reason: 'GitHub has not yet unblocked the merge',
          blockedGreen: true,
        };
  }
  // UNKNOWN: GitHub is still computing mergeability.
  return { kind: 'wait', reason: `merge state is ${pr.mergeStateStatus}` };
}

/** The train's command line, or the reason it cannot start. */
export interface TrainArgs {
  pullRequests: number[];
  method: MergeMethod;
  pollSeconds: number;
  timeoutMinutes: number;
  dryRun: boolean;
}

/**
 * Parses `<pr>… [--method merge] [--poll 30] [--timeout 45] [--dry-run]`.
 *
 * The order of the Pull Requests is the merge order, so it is kept exactly,
 * and a number given twice is refused rather than silently merged once: it
 * almost always means a list was pasted wrong.
 */
export function parseTrainArgs(
  positional: readonly string[],
  flags: Readonly<Record<string, string | null>>,
): TrainArgs | { error: string } {
  if (positional.length === 0) {
    return { error: 'name at least one pull request, in merge order' };
  }
  const pullRequests: number[] = [];
  for (const raw of positional) {
    const value = raw.replace(/^#/, '');
    if (!/^[1-9]\d*$/.test(value)) {
      return { error: `not a pull request number: ${raw}` };
    }
    const number = Number(value);
    if (pullRequests.includes(number)) {
      return { error: `#${number} is named twice` };
    }
    pullRequests.push(number);
  }

  const method = flags.method ?? 'merge';
  if (!(MERGE_METHODS as readonly string[]).includes(method)) {
    return { error: `--method must be one of ${MERGE_METHODS.join(', ')}` };
  }
  const positive = (name: string, fallback: number): number | string => {
    const raw = flags[name];
    if (raw === undefined) return fallback;
    if (raw === null || !/^[1-9]\d*$/.test(raw)) {
      return `--${name} must be a positive whole number`;
    }
    return Number(raw);
  };
  const pollSeconds = positive('poll', DEFAULT_POLL_SECONDS);
  if (typeof pollSeconds === 'string') return { error: pollSeconds };
  const timeoutMinutes = positive('timeout', DEFAULT_TIMEOUT_MINUTES);
  if (typeof timeoutMinutes === 'string') return { error: timeoutMinutes };

  return {
    pullRequests,
    method: method as MergeMethod,
    pollSeconds,
    timeoutMinutes,
    dryRun: 'dry-run' in flags,
  };
}

/** Everything the train does to the world, so the loop is asserted offline. */
export interface TrainIo {
  /** The required checks for `main`. */
  requiredChecks(): string[];
  /** One fresh read of one Pull Request, or null when it cannot be read. */
  read(pr: number): PullRequestSnapshot | null;
  /** Brings the branch up to date with `main`; false when GitHub refused. */
  update(pr: number, expectedHeadOid: string): boolean;
  /** Merges exactly `headOid`, without `--admin`; false when GitHub refused. */
  merge(pr: number, headOid: string, method: MergeMethod): boolean;
  sleep(seconds: number): Promise<void>;
  /** Milliseconds, for the per-Pull-Request timeout. */
  now(): number;
  log(line: string): void;
}

/** How a whole train ended. */
export interface TrainResult {
  merged: number[];
  /** The Pull Request the train stopped at, and why; null when all merged. */
  stoppedAt: { pr: number; reason: string } | null;
  /** Pull Requests after the stop, never attempted. */
  notReached: number[];
}

/**
 * Runs the train. Each Pull Request is read, decided, acted on, and read
 * again until it merges or the train stops; only then does the next one
 * start, because it is the merge of this one that makes the next one behind.
 *
 * In a dry run nothing is updated or merged: each Pull Request is read once
 * and the step it would take is logged.
 */
export async function runTrain(
  args: Pick<
    TrainArgs,
    'pullRequests' | 'method' | 'pollSeconds' | 'timeoutMinutes' | 'dryRun'
  >,
  io: TrainIo,
): Promise<TrainResult> {
  const required = io.requiredChecks();
  const merged: number[] = [];
  const stop = (index: number, reason: string): TrainResult => {
    io.log(`stop: ${reason}`);
    return {
      merged,
      stoppedAt: { pr: args.pullRequests[index], reason },
      notReached: args.pullRequests.slice(index + 1),
    };
  };
  if (required.length === 0) {
    return stop(0, noRequiredChecksReason());
  }

  for (let index = 0; index < args.pullRequests.length; index += 1) {
    const pr = args.pullRequests[index];
    const outcome = await drivePullRequest(pr, args, io, required);
    if (outcome.kind === 'stopped') return stop(index, outcome.reason);
    if (outcome.kind === 'merged') merged.push(pr);
  }
  return { merged, stoppedAt: null, notReached: [] };
}

const couldNotReadReason = (pr: number): string => `#${pr} could not be read`;

const waitedReason = (pr: number, minutes: number, still: string): string =>
  `#${pr} waited ${minutes} min and is still ${still}`;

const noRequiredChecksReason = (): string =>
  `no required checks could be read for \`${TRAIN_BASE}\`; the train will not merge what it cannot check`;

/** How driving one Pull Request ended. */
type DriveOutcome =
  | { kind: 'merged' }
  /** A dry run read it once and logged the step it would take. */
  | { kind: 'read' }
  | { kind: 'stopped'; reason: string };

/**
 * Drives one Pull Request until it merges or cannot: read, decide, act, read
 * again. Both trains run exactly this loop, so the update and merge writes of
 * an Auto-merge are the hand-started train's own.
 *
 * `beforeMerge` is asked, at the head about to merge, whether anything holds
 * it; a reason it returns ends the drive with no merge.
 */
async function drivePullRequest(
  pr: number,
  args: Pick<TrainArgs, 'method' | 'pollSeconds' | 'timeoutMinutes' | 'dryRun'>,
  io: TrainIo,
  required: readonly string[],
  beforeMerge?: (snapshot: PullRequestSnapshot) => string | null,
): Promise<DriveOutcome> {
  const stopped = (reason: string): DriveOutcome => ({
    kind: 'stopped',
    reason,
  });
  const deadline = io.now() + args.timeoutMinutes * 60_000;
  let updates = 0;
  let refusals = 0;
  let blockedGreenReads = 0;
  let lastWait = '';

  for (;;) {
    const snapshot = io.read(pr);
    if (!snapshot) return stopped(couldNotReadReason(pr));
    const step = decideNext(snapshot, required, { blockedGreenReads });

    if (args.dryRun) {
      io.log(`#${pr}: would ${describe(step)}`);
      if (step.kind === 'stop') return stopped(step.reason);
      return { kind: 'read' };
    }

    if (step.kind === 'merged') {
      io.log(`#${pr}: already merged`);
      return { kind: 'merged' };
    }
    if (step.kind === 'stop') return stopped(step.reason);

    if (step.kind === 'update') {
      if (updates >= MAX_UPDATES_PER_PULL_REQUEST) {
        return stopped(
          `#${pr} fell behind \`${TRAIN_BASE}\` ${updates + 1} times; something else is merging as fast as the train`,
        );
      }
      updates += 1;
      io.log(`#${pr}: behind \`${TRAIN_BASE}\`, updating the branch`);
      if (!io.update(pr, snapshot.headRefOid)) {
        return stopped(`#${pr} could not be brought up to date`);
      }
      blockedGreenReads = 0;
      lastWait = '';
      await io.sleep(args.pollSeconds);
      continue;
    }

    if (step.kind === 'merge') {
      const hold = beforeMerge?.(snapshot) ?? null;
      if (hold) return stopped(hold);
      io.log(
        `#${pr}: required checks green on ${step.headRefOid.slice(0, 8)}, merging`,
      );
      if (io.merge(pr, step.headRefOid, args.method)) {
        return { kind: 'merged' };
      }
      // Refused: most often `main` moved between the read and the merge,
      // and the next read is BEHIND and updates. A refusal that repeats on
      // a green head is bounded twice over: by count and by the deadline.
      refusals += 1;
      if (refusals >= MAX_MERGE_REFUSALS) {
        return stopped(
          `GitHub refused to merge #${pr} ${refusals} times with every required check green`,
        );
      }
      if (io.now() >= deadline) {
        return stopped(
          `#${pr} could not be merged within ${args.timeoutMinutes} min`,
        );
      }
      io.log(`#${pr}: GitHub refused the merge; reading it again`);
      await io.sleep(args.pollSeconds);
      continue;
    }

    // wait
    blockedGreenReads = step.blockedGreen ? blockedGreenReads + 1 : 0;
    if (io.now() >= deadline) {
      return stopped(waitedReason(pr, args.timeoutMinutes, step.reason));
    }
    if (step.reason !== lastWait) io.log(`#${pr}: ${step.reason}`);
    lastWait = step.reason;
    await io.sleep(args.pollSeconds);
  }
}

function describe(step: TrainStep): string {
  switch (step.kind) {
    case 'merged':
      return 'skip it (already merged)';
    case 'update':
      return `update the branch from \`${TRAIN_BASE}\`, then wait for its checks`;
    case 'wait':
      return `wait (${step.reason})`;
    case 'merge':
      return `merge ${step.headRefOid.slice(0, 8)}`;
    case 'stop':
      return `stop: ${step.reason}`;
  }
}

/** The closing lines: what merged, where it stopped, what it never reached. */
export function renderTrainResult(result: TrainResult): string {
  const list = (prs: readonly number[]) =>
    prs.length === 0 ? 'none' : prs.map((pr) => `#${pr}`).join(', ');
  const lines = [`Merged: ${list(result.merged)}.`];
  if (result.stoppedAt) {
    lines.push(
      `Stopped at #${result.stoppedAt.pr}: ${result.stoppedAt.reason}.`,
      `Not reached: ${list(result.notReached)}.`,
    );
  }
  return lines.join('\n');
}

// ------------------------------------------------------------ Auto-merge
//
// ADR 0148: under `--auto` the train decides by itself, per candidate, from
// facts it reads for the exact head it would merge. Every rule below is pure;
// the reads live behind `AutoTrainIo`. Each fact is its own type, read by its
// own reader and judged by its own row of `AUTO_MERGE_RULES`, so the slice
// that gives a fact a real reader changes that fact and nothing else.

/** What `tools/config/merge-train-auto-merge.json` may set. */
export const AUTO_MERGE_MODES = ['off', 'shadow', 'on'] as const;
export type AutoMergeMode = (typeof AUTO_MERGE_MODES)[number];

/**
 * The mode setting, repo-relative. Under `tools/config/**`, which the Review
 * Tier path map makes `human`, so only a Pull Request the Maintainer merges
 * can change it (ADR 0148 decision 4).
 */
export const AUTO_MERGE_MODE_PATH = 'tools/config/merge-train-auto-merge.json';

/**
 * The mode, from the setting file's text (`null` when the file is missing).
 * Anything but `{ "mode": "off" | "shadow" | "on" }` reads as `off`: a broken
 * setting stops Auto-merge rather than guessing at it.
 */
export function parseAutoMergeMode(text: string | null): AutoMergeMode {
  if (text === null) return 'off';
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'off';
  }
  const mode = (value as { mode?: unknown } | null)?.mode;
  return typeof mode === 'string' &&
    (AUTO_MERGE_MODES as readonly string[]).includes(mode)
    ? (mode as AutoMergeMode)
    : 'off';
}

/** A fact the train could not read. It always holds, with this reason. */
export interface MissingFact {
  status: 'missing';
  reason: string;
}

/** The latest completed `push` run of CI on `main`. */
export type MainCiFact =
  | MissingFact
  | { status: 'read'; conclusion: string; headSha: string };

/**
 * The required checks of `main`'s ruleset on the candidate. `gated-at-merge`
 * is the `on` train before it updates the branch: the shared drive loop then
 * gates them on the updated head exactly as a hand-started train does.
 */
export type RequiredChecksFact =
  | { status: 'green' }
  | { status: 'gated-at-merge' }
  | { status: 'held'; reason: string };

/** The Review Tiers of ADR 0070, from the classifier that computes them. */
export type { ReviewTier };

/** The Review Tier recorded for the head. */
export type ReviewTierFact = MissingFact | { status: 'read'; tier: ReviewTier };

/**
 * The fact for `gh pr view --json comments` output: the record the Review
 * Tier workflow posted for `head` (#1526). Only a comment its own login wrote
 * counts, an outdated (minimised) one does not, and the latest wins. No
 * record, one for another commit, or one that does not parse is `missing`,
 * which holds like human with the reason named. The label is never read.
 */
export function reviewTierFromView(
  view: { comments?: ReviewComment[] } | null,
  head: string,
): ReviewTierFact {
  if (!view)
    return {
      status: 'missing',
      reason: 'the Review Tier record could not be read',
    };
  const own = (view.comments ?? []).filter(
    (c) =>
      c.author?.login === SUMMARY_AUTHOR_LOGIN &&
      !c.isMinimized &&
      isReviewTierRecordBody(c.body),
  );
  const latest = own.at(-1);
  if (!latest)
    return {
      status: 'missing',
      reason: 'there is no Review Tier record for this Pull Request',
    };
  const record = parseReviewTierRecord(latest.body);
  if (!record)
    return {
      status: 'missing',
      reason: 'the Review Tier record is malformed',
    };
  if (record.headRefOid !== head)
    return {
      status: 'missing',
      reason: `the Review Tier record is for \`${record.headRefOid.slice(0, 8)}\`, not the head \`${head.slice(0, 8)}\``,
    };
  return { status: 'read', tier: record.tier };
}

/** One file of a Pull Request, as `gh api pulls/N/files` returns it. */
export interface ChangedFile {
  filename: string;
  previous_filename?: string | null;
}

/**
 * The path guard (#1526, at the human's direction): the Review Tier record
 * comes from the Pull Request's own tree, so a Pull Request that edits the
 * path map, the classifier or the workflow could classify itself. The train
 * therefore checks the changed files against the human rules of `main`'s own
 * path map, which that Pull Request has not changed. `unreadable` is a map or
 * file list the train could not read.
 */
export type PathGuardFact =
  | { status: 'clear' }
  | { status: 'matched'; path: string; rule: string }
  | { status: 'unreadable'; reason: string };

/** `gh api --paginate pulls/N/files --jq '.[] | {…}'` output as the fact reads it; null when it failed or does not parse. */
export function changedFilesFromGh(result: {
  status: number;
  stdout: string;
}): ChangedFile[] | null {
  if (result.status !== 0) return null;
  try {
    return result.stdout
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ChangedFile);
  } catch {
    return null;
  }
}

/** What one `git` call returned; a spawn that never produced a status is 1. */
export interface GitResult {
  status: number | null;
  stdout: string | null;
}

/**
 * `main`'s path map, read from `main` itself and never from the working
 * tree: fetch, then `git show origin/main:<the map>`. A failed fetch (no show
 * is run), a failed show, or a map that does not validate is null, which
 * holds every candidate. `git` is injected so the branches are testable.
 */
export function readPathMapFromGit(
  git: (args: string[]) => GitResult,
): ReviewTierPathMap | null {
  const ok = (result: GitResult) => (result.status ?? 1) === 0;
  if (!ok(git(['fetch', '--quiet', 'origin', TRAIN_BASE]))) return null;
  // The config constant is already repo-relative (git wants a posix path).
  const path = REVIEW_TIER_PATHS_CONFIG.split(sep).join('/');
  const shown = git(['show', `origin/${TRAIN_BASE}:${path}`]);
  if (!ok(shown)) return null;
  try {
    return assertPathMap(
      JSON.parse(shown.stdout ?? ''),
      `origin/${TRAIN_BASE}`,
    );
  } catch {
    return null;
  }
}

/** GitHub lists at most this many files of a Pull Request. */
export const PULL_FILES_LIMIT = 3000;

/**
 * The fact from the Pull Request's files and `main`'s path map. A renamed
 * file counts under both its new and its old path.
 */
export function pathGuardFrom(
  files: readonly ChangedFile[] | null,
  map: ReviewTierPathMap | null,
): PathGuardFact {
  if (!map)
    return {
      status: 'unreadable',
      reason: `the path map of \`${TRAIN_BASE}\` could not be read`,
    };
  if (!files)
    return {
      status: 'unreadable',
      reason: "the Pull Request's changed files could not be read",
    };
  if (files.length >= PULL_FILES_LIMIT)
    return {
      status: 'unreadable',
      reason: `the Pull Request changes ${PULL_FILES_LIMIT} files or more, more than GitHub lists`,
    };
  for (const file of files) {
    for (const path of [file.filename, file.previous_filename]) {
      if (!path) continue;
      const rule = humanRuleFor(map, path);
      if (rule) return { status: 'matched', path, rule: rule.id };
    }
  }
  return { status: 'clear' };
}

/**
 * The Agent Verdict from the code-review summary comment. `read` carries the
 * verdict and the full commit that summary reviewed (`null` when the comment
 * does not name one in full); no comment, a no-verdict heading, or one nothing
 * recognises is `missing`.
 */
export type AgentVerdictFact =
  | MissingFact
  | { status: 'read'; verdict: Verdict; reviewedOid: string | null };

/**
 * Why each verdict that is not `approve` holds (ADR 0148 decision 3; ADR
 * 0053). `approve` has no row: it holds only when it reviewed another commit.
 */
export const AGENT_VERDICT_HOLDS = {
  approve: null,
  comment: 'the Agent Verdict is comment, not approve',
  'request-changes': 'the Agent Verdict is request-changes',
} as const satisfies Record<Verdict, string | null>;

/** The fact when `gh` could not read the Pull Request's comments at all. */
export const AGENT_VERDICT_UNREADABLE: AgentVerdictFact = {
  status: 'missing',
  reason:
    'the Agent Verdict could not be read (no code-review summary comment)',
};

/**
 * Why a summary with no verdict holds, per outcome (ADR 0053). `passed` and
 * `blocked` always carry a verdict, so they never reach this table.
 */
const NO_VERDICT_REASONS = {
  passed: 'the code-review summary carries a verdict',
  blocked: 'the code-review summary carries a verdict',
  'no-verdict': 'the code-review summary has no verdict',
  unrecognised: 'the code-review summary heading is not recognised',
  unreviewed: 'there is no code-review summary comment',
} as const satisfies Record<ReviewOutcome, string>;

/** The fact for what the review reader found (`readTrustedReview`). */
export function agentVerdictFrom(read: ReviewRead): AgentVerdictFact {
  if (read.verdict !== null)
    return {
      status: 'read',
      verdict: read.verdict,
      reviewedOid: read.reviewedOid,
    };
  return { status: 'missing', reason: NO_VERDICT_REASONS[read.outcome] };
}

/**
 * The fact for `gh pr view --json comments` output: `null` (the call failed)
 * is unreadable, and only the publisher's own, unminimised summary counts.
 */
export function agentVerdictFromView(
  view: { comments?: ReviewComment[] } | null,
): AgentVerdictFact {
  if (!view) return AGENT_VERDICT_UNREADABLE;
  return agentVerdictFrom(readTrustedReview(view.comments ?? []));
}

const agentVerdictHold = (
  fact: AgentVerdictFact,
  head: string,
): string | null => {
  if (fact.status === 'missing') return fact.reason;
  const hold = AGENT_VERDICT_HOLDS[fact.verdict];
  if (hold) return hold;
  if (fact.reviewedOid === head) return null;
  return fact.reviewedOid === null
    ? 'the Agent Verdict does not name the commit it reviewed'
    : `the Agent Verdict approved \`${fact.reviewedOid.slice(0, 8)}\`, not the head \`${head.slice(0, 8)}\``;
};

/** The QA Report for the head. No reader yet, so always missing. */
export type QaReportFact = MissingFact;

/**
 * The Merge Danger Door line, read exactly as PrAuthor writes it. `absent`
 * (no `## Merge danger` section, or no `**Door:**` line in it) changes
 * nothing; a `**Door:**` line in another form, or a line in that section
 * that is a Door field written any other way (bulleted, `**Door**:`, another
 * case), is `unreadable` and holds. Prose that merely starts with "Door" is
 * not a Door field.
 */
export type DoorFact =
  | { status: 'one-way' }
  | { status: 'two-way' }
  | { status: 'absent' }
  | { status: 'unreadable'; line: string };

/** Every fact one Auto-merge decision reads, for one head. */
export interface AutoMergeFacts {
  /** The head these facts were read for, and the one that would merge. */
  headRefOid: string;
  mainCi: MainCiFact;
  requiredChecks: RequiredChecksFact;
  reviewTier: ReviewTierFact;
  pathGuard: PathGuardFact;
  agentVerdict: AgentVerdictFact;
  qaReport: QaReportFact;
  door: DoorFact;
}

export type AutoMergeFactName = Exclude<keyof AutoMergeFacts, 'headRefOid'>;

/** Readers for the facts with no reader yet. Each one holds. */
export const UNREAD_REVIEW_TIER: ReviewTierFact = {
  status: 'missing',
  reason: 'the Review Tier is not read yet (no per-head record)',
};
export const UNREAD_AGENT_VERDICT: AgentVerdictFact = {
  status: 'missing',
  reason: 'the Agent Verdict is not read yet',
};
export const UNREAD_QA_REPORT: QaReportFact = {
  status: 'missing',
  reason: 'the QA Report is not read yet',
};

/** The held reason a `**Door:**` line in any other form gets. */
export const DOOR_UNREADABLE_REASON = 'Door line unreadable';

const DOOR_LINE = '**Door:**';
const DOOR_VALUE_RE = /^(one-way|two-way)(?:\s+—\s+.*)?$/;
const DOOR_NEAR_MISS_RE = /^(?:[-*+]\s+)?[*_]*\s*door[*_]*\s*:/i;

/** Reads the Door from a Pull Request description. */
export function readDoor(body: string | null | undefined): DoorFact {
  const lines = (body ?? '').split(/\r?\n/);
  const section = lines.findIndex((line) =>
    /^##\s+Merge danger\s*$/i.test(line.trim()),
  );
  if (section === -1) return { status: 'absent' };
  for (const raw of lines.slice(section + 1)) {
    const line = raw.trim();
    if (/^##?\s/.test(line)) break;
    if (!line.startsWith(DOOR_LINE)) {
      // A Door field in any other form — bulleted, the colon outside the
      // bold, another case — is a Door the train cannot read, never a Door
      // that is not there.
      if (DOOR_NEAR_MISS_RE.test(line)) return { status: 'unreadable', line };
      continue;
    }
    const value = DOOR_VALUE_RE.exec(line.slice(DOOR_LINE.length).trim());
    if (!value) return { status: 'unreadable', line };
    return { status: value[1] as 'one-way' | 'two-way' };
  }
  return { status: 'absent' };
}

/** `main`'s latest run, from `gh run list --json conclusion,headSha`. */
export function mainCiFromRuns(runs: unknown): MainCiFact {
  const run = Array.isArray(runs)
    ? (runs[0] as { conclusion?: unknown; headSha?: unknown } | undefined)
    : undefined;
  if (
    !run ||
    typeof run.conclusion !== 'string' ||
    !run.conclusion ||
    typeof run.headSha !== 'string'
  ) {
    return {
      status: 'missing',
      reason: `the latest CI run on \`${TRAIN_BASE}\` could not be read`,
    };
  }
  return { status: 'read', conclusion: run.conclusion, headSha: run.headSha };
}

/**
 * One row per fact: the reason it holds the merge, or null. The insertion
 * order is the order held reasons are listed in.
 */
export const AUTO_MERGE_RULES = {
  mainCi: (fact: MainCiFact): string | null =>
    fact.status === 'missing'
      ? fact.reason
      : fact.conclusion === 'success'
        ? null
        : `the latest CI run on \`${TRAIN_BASE}\` is ${fact.conclusion} (${fact.headSha.slice(0, 8)})`,
  requiredChecks: (fact: RequiredChecksFact): string | null =>
    fact.status === 'held' ? fact.reason : null,
  reviewTier: (fact: ReviewTierFact): string | null =>
    fact.status === 'missing'
      ? fact.reason
      : fact.tier === 'human'
        ? 'the Review Tier is human'
        : null,
  pathGuard: (fact: PathGuardFact): string | null =>
    fact.status === 'unreadable'
      ? fact.reason
      : fact.status === 'matched'
        ? `\`${fact.path}\` matches the human rule "${fact.rule}" in the path map of \`${TRAIN_BASE}\``
        : null,
  agentVerdict: (fact: AgentVerdictFact, head: string): string | null =>
    agentVerdictHold(fact, head),
  qaReport: (fact: QaReportFact): string | null => fact.reason,
  door: (fact: DoorFact): string | null =>
    fact.status === 'one-way'
      ? 'the Merge Danger Door is one-way'
      : fact.status === 'unreadable'
        ? DOOR_UNREADABLE_REASON
        : null,
} as const satisfies {
  [K in AutoMergeFactName]: (
    fact: AutoMergeFacts[K],
    head: string,
  ) => string | null;
};

/** The held reason every candidate gets while the setting is `off`. */
export const AUTO_MERGE_OFF_REASON = `Auto-merge is off (\`${AUTO_MERGE_MODE_PATH}\`)`;

/**
 * What each mode does in a pass, one row per mode (ADR 0053): whether it
 * reads and decides the candidates at all, the action for a candidate held or
 * allowed, whether it drives an allowed one through the train's own update
 * and merge loop, and the verb a dry run logs.
 */
export const AUTO_MERGE_MODE_PASS = {
  off: {
    decides: false,
    heldAction: 'skip',
    allowedAction: 'skip',
    drives: false,
    dryRunVerb: 'decide',
  },
  shadow: {
    decides: true,
    heldAction: 'shadow-comment',
    allowedAction: 'shadow-comment',
    drives: false,
    dryRunVerb: 'comment',
  },
  on: {
    decides: true,
    heldAction: 'skip',
    allowedAction: 'merge',
    drives: true,
    dryRunVerb: 'decide',
  },
} as const satisfies Record<
  AutoMergeMode,
  {
    decides: boolean;
    heldAction: AutoMergeDecision['action'];
    allowedAction: AutoMergeDecision['action'];
    drives: boolean;
    dryRunVerb: string;
  }
>;

/** What an Auto-merge does with one candidate. */
export interface AutoMergeDecision {
  action: 'merge' | 'shadow-comment' | 'skip';
  /** True when any fact holds the merge (always, under `off`). */
  held: boolean;
  /** Every held reason in rule order, joined; or why it would merge. */
  reason: string;
  /** A `one-way` Door on an `auto` or `agent` Pull Request; else null. */
  mismatch: string | null;
}

/** The reasons, in rule order, that any fact holds the merge. */
export function autoMergeHolds(facts: AutoMergeFacts): string[] {
  const holds: string[] = [];
  const judge = <K extends AutoMergeFactName>(name: K) => {
    const rule = AUTO_MERGE_RULES[name] as (
      fact: AutoMergeFacts[K],
      head: string,
    ) => string | null;
    const reason = rule(facts[name], facts.headRefOid);
    if (reason) holds.push(reason);
  };
  for (const name of Object.keys(AUTO_MERGE_RULES) as AutoMergeFactName[]) {
    judge(name);
  }
  return holds;
}

/**
 * The Auto-merge decision for one candidate (ADR 0148 decision 3). Every
 * fact can hold a merge back and none can allow one alone: it merges only
 * when no rule holds.
 */
export function decideAutoMerge(
  facts: AutoMergeFacts,
  mode: AutoMergeMode,
): AutoMergeDecision {
  const tier = facts.reviewTier;
  const mismatch =
    facts.door.status === 'one-way' &&
    tier.status === 'read' &&
    tier.tier !== 'human'
      ? `the Merge Danger Door is one-way but the Review Tier is ${tier.tier}`
      : null;
  const pass = AUTO_MERGE_MODE_PASS[mode];
  if (!pass.decides) {
    return {
      action: pass.heldAction,
      held: true,
      reason: AUTO_MERGE_OFF_REASON,
      mismatch,
    };
  }
  const holds = autoMergeHolds(facts);
  const held = holds.length > 0;
  const reason = held
    ? holds.join('; ')
    : `every fact holds for ${facts.headRefOid}`;
  return {
    action: held ? pass.heldAction : pass.allowedAction,
    held,
    reason,
    mismatch,
  };
}

/** The hidden marker of the one shadow comment on each candidate. */
export const SHADOW_COMMENT_MARKER = '<!-- merge-train:auto-merge -->';
/** The lead of the shadow comment's decision line. */
export const SHADOW_COMMENT_LEAD = '**Merge Train Auto-merge (shadow):**';
/** The shadow comment's two text forms (ADR 0148 decision 4). */
export const SHADOW_WOULD_MERGE = 'would auto-merge at';
export const SHADOW_HELD = 'held:';

/**
 * The shadow comment's body: the marker, then `would auto-merge at \`<sha>\``
 * or `held: <reason>` with the head it was decided for, then any mismatch.
 */
export function renderShadowComment(
  decision: AutoMergeDecision,
  headRefOid: string,
): string {
  const lines = [SHADOW_COMMENT_MARKER];
  if (decision.held) {
    lines.push(
      `${SHADOW_COMMENT_LEAD} ${SHADOW_HELD} ${decision.reason}`,
      '',
      `Head: \`${headRefOid}\``,
    );
  } else {
    lines.push(
      `${SHADOW_COMMENT_LEAD} ${SHADOW_WOULD_MERGE} \`${headRefOid}\``,
    );
  }
  if (decision.mismatch) lines.push('', `Mismatch: ${decision.mismatch}`);
  return lines.join('\n');
}

/**
 * The required checks of one read, judged without writing anything: a branch
 * that is behind is judged on its current head, since only the `on` train may
 * update it.
 */
export function checksOnCurrentHead(
  pr: PullRequestSnapshot,
  required: readonly string[],
  { blockedGreenReads = 0 }: { blockedGreenReads?: number } = {},
):
  | { kind: 'green' }
  | { kind: 'held'; reason: string }
  | { kind: 'wait'; reason: string; blockedGreen?: true } {
  const judged =
    pr.mergeStateStatus === 'BEHIND'
      ? { ...pr, mergeStateStatus: 'CLEAN' }
      : pr;
  const step = decideNext(judged, required, { blockedGreenReads });
  switch (step.kind) {
    case 'merge':
      return { kind: 'green' };
    case 'wait':
      return step.blockedGreen
        ? { kind: 'wait', reason: step.reason, blockedGreen: true }
        : { kind: 'wait', reason: step.reason };
    case 'stop':
      return { kind: 'held', reason: step.reason };
    case 'merged':
      return { kind: 'held', reason: `#${pr.number} is already merged` };
    // Unreachable, since a behind branch was judged as up to date above; kept
    // so the switch stays exhaustive over every TrainStep.
    case 'update':
      return {
        kind: 'held',
        reason: `#${pr.number} is behind \`${TRAIN_BASE}\``,
      };
  }
}

/** The train's IO, plus the reads and the one write an Auto-merge needs. */
export interface AutoTrainIo extends TrainIo {
  /** The latest completed `push` run of CI on `main`. */
  mainCi(): MainCiFact;
  reviewTier(pr: number, headRefOid: string): ReviewTierFact;
  /** The Pull Request's changed files; null when `gh` could not list them. */
  changedFiles(pr: number): ChangedFile[] | null;
  /** The path map as `main` has it, not the working tree's; null when unreadable. */
  mainPathMap(): ReviewTierPathMap | null;
  agentVerdict(pr: number, headRefOid: string): AgentVerdictFact;
  qaReport(pr: number, headRefOid: string): QaReportFact;
  /** Posts the shadow comment, or edits the one already there; false on failure. */
  upsertShadowComment(pr: number, body: string): boolean;
}

/** How one `--auto` pass ended. */
export interface AutoTrainResult {
  mode: AutoMergeMode;
  dryRun: boolean;
  merged: number[];
  /** Candidates every fact allowed, under `shadow` or a dry run. */
  wouldMerge: { pr: number; headRefOid: string }[];
  held: { pr: number; reason: string }[];
  mismatches: { pr: number; reason: string }[];
  /** Candidates whose shadow comment GitHub would not take. */
  commentFailures: number[];
}

/**
 * One `--auto` pass over the candidates, in the order given. Unlike the
 * hand-started train it never stops at a candidate: one that fails a rule is
 * held with its reason and the next is decided (ADR 0148 decision 1).
 *
 * `main`'s CI is read once, at the start: a red `main` holds every candidate
 * in the pass, and the pass's own merges do not hold the candidates after
 * them — each is still gated by its own required checks on its updated head.
 *
 * - `off`: reads and writes nothing; every candidate is held.
 * - a candidate that cannot be read, or is no longer open, is held with no
 *   comment written on it.
 * - `shadow`: reads only, waiting for running checks as the train does, and
 *   writes one marker comment per candidate.
 * - `on`: judges the facts before updating, drives the candidate through the
 *   hand-started train's own loop, and judges them again at the merge head.
 * - a dry run writes nothing and logs what each candidate would get.
 */
export async function runAutoTrain(
  args: Pick<
    TrainArgs,
    'pullRequests' | 'method' | 'pollSeconds' | 'timeoutMinutes' | 'dryRun'
  > & { mode: AutoMergeMode },
  io: AutoTrainIo,
): Promise<AutoTrainResult> {
  const result: AutoTrainResult = {
    mode: args.mode,
    dryRun: args.dryRun,
    merged: [],
    wouldMerge: [],
    held: [],
    mismatches: [],
    commentFailures: [],
  };
  const hold = (pr: number, reason: string) => {
    io.log(`#${pr}: held: ${reason}`);
    result.held.push({ pr, reason });
  };
  const pass = AUTO_MERGE_MODE_PASS[args.mode];
  if (!pass.decides) {
    for (const pr of args.pullRequests) hold(pr, AUTO_MERGE_OFF_REASON);
    return result;
  }
  const required = io.requiredChecks();
  if (required.length === 0) {
    for (const pr of args.pullRequests) hold(pr, noRequiredChecksReason());
    return result;
  }
  const mainCi = io.mainCi();
  const mainPathMap = io.mainPathMap();
  const factsFor = (
    pr: number,
    snapshot: PullRequestSnapshot,
    requiredChecks: RequiredChecksFact,
  ): AutoMergeFacts => ({
    headRefOid: snapshot.headRefOid,
    mainCi,
    requiredChecks,
    reviewTier: io.reviewTier(pr, snapshot.headRefOid),
    pathGuard: pathGuardFrom(io.changedFiles(pr), mainPathMap),
    agentVerdict: io.agentVerdict(pr, snapshot.headRefOid),
    qaReport: io.qaReport(pr, snapshot.headRefOid),
    door: readDoor(snapshot.body),
  });

  for (const pr of args.pullRequests) {
    const first = io.read(pr);
    if (!first) {
      hold(pr, couldNotReadReason(pr));
      continue;
    }
    // A Pull Request no longer open is not a candidate: it is listed, and
    // nothing is written on it.
    if (first.state !== 'OPEN') {
      hold(pr, `#${pr} is ${first.state.toLowerCase()}`);
      continue;
    }

    if (pass.drives && !args.dryRun) {
      const decision = decideAutoMerge(
        factsFor(pr, first, { status: 'gated-at-merge' }),
        args.mode,
      );
      if (decision.mismatch)
        result.mismatches.push({ pr, reason: decision.mismatch });
      if (decision.held) {
        hold(pr, decision.reason);
        continue;
      }
      const outcome = await drivePullRequest(
        pr,
        args,
        io,
        required,
        (snapshot) => {
          const atHead = decideAutoMerge(
            factsFor(pr, snapshot, { status: 'green' }),
            args.mode,
          );
          return atHead.held ? atHead.reason : null;
        },
      );
      if (outcome.kind === 'merged') result.merged.push(pr);
      else if (outcome.kind === 'stopped') hold(pr, outcome.reason);
      continue;
    }

    const { snapshot, checks } = await judgeChecksWithoutWriting(
      pr,
      first,
      required,
      args,
      io,
    );
    const decision = decideAutoMerge(factsFor(pr, snapshot, checks), args.mode);
    if (decision.mismatch)
      result.mismatches.push({ pr, reason: decision.mismatch });
    if (decision.held) {
      result.held.push({ pr, reason: decision.reason });
    } else {
      result.wouldMerge.push({ pr, headRefOid: snapshot.headRefOid });
    }
    const line = decision.held
      ? `${SHADOW_HELD} ${decision.reason}`
      : `${SHADOW_WOULD_MERGE} ${snapshot.headRefOid}`;
    if (args.dryRun) {
      io.log(`#${pr}: would ${pass.dryRunVerb} "${line}"`);
      continue;
    }
    io.log(`#${pr}: ${line}`);
    if (
      !io.upsertShadowComment(
        pr,
        renderShadowComment(decision, snapshot.headRefOid),
      )
    ) {
      io.log(`#${pr}: the shadow comment could not be written`);
      result.commentFailures.push(pr);
    }
  }
  return result;
}

/**
 * Reads one candidate until its required checks settle, writing nothing. A
 * dry run reads once, so a check still running holds with that reason.
 */
async function judgeChecksWithoutWriting(
  pr: number,
  first: PullRequestSnapshot,
  required: readonly string[],
  args: Pick<TrainArgs, 'pollSeconds' | 'timeoutMinutes' | 'dryRun'>,
  io: TrainIo,
): Promise<{ snapshot: PullRequestSnapshot; checks: RequiredChecksFact }> {
  const deadline = io.now() + args.timeoutMinutes * 60_000;
  let snapshot = first;
  let blockedGreenReads = 0;
  for (;;) {
    const judged = checksOnCurrentHead(snapshot, required, {
      blockedGreenReads,
    });
    if (judged.kind === 'green')
      return { snapshot, checks: { status: 'green' } };
    if (judged.kind === 'held') {
      return { snapshot, checks: { status: 'held', reason: judged.reason } };
    }
    if (args.dryRun || io.now() >= deadline) {
      const reason = args.dryRun
        ? `#${pr} is still ${judged.reason}`
        : waitedReason(pr, args.timeoutMinutes, judged.reason);
      return { snapshot, checks: { status: 'held', reason } };
    }
    blockedGreenReads = judged.blockedGreen ? blockedGreenReads + 1 : 0;
    await io.sleep(args.pollSeconds);
    const next = io.read(pr);
    if (!next) {
      return {
        snapshot,
        checks: { status: 'held', reason: couldNotReadReason(pr) },
      };
    }
    snapshot = next;
  }
}

/** The closing lines of an `--auto` pass. */
export function renderAutoTrainResult(result: AutoTrainResult): string {
  const list = (prs: readonly number[]) =>
    prs.length === 0 ? 'none' : prs.map((pr) => `#${pr}`).join(', ');
  const lines = [
    `Auto-merge mode: ${result.mode}${result.dryRun ? ' (dry run)' : ''}.`,
    `Merged: ${list(result.merged)}.`,
    `Would merge: ${
      result.wouldMerge.length === 0
        ? 'none'
        : result.wouldMerge
            .map(({ pr, headRefOid }) => `#${pr} at ${headRefOid.slice(0, 8)}`)
            .join(', ')
    }.`,
  ];
  lines.push(
    result.held.length === 0 ? 'Held: none.' : 'Held:',
    ...result.held.map(({ pr, reason }) => `- #${pr}: ${reason}`),
  );
  if (result.mismatches.length > 0) {
    lines.push(
      'Mismatches:',
      ...result.mismatches.map(({ pr, reason }) => `- #${pr}: ${reason}`),
    );
  }
  if (result.commentFailures.length > 0) {
    lines.push(`Shadow comment not written: ${list(result.commentFailures)}.`);
  }
  return lines.join('\n');
}

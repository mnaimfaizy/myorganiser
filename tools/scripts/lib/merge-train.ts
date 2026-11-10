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
    return stop(
      0,
      `no required checks could be read for \`${TRAIN_BASE}\`; the train will not merge what it cannot check`,
    );
  }

  for (let index = 0; index < args.pullRequests.length; index += 1) {
    const pr = args.pullRequests[index];
    const deadline = io.now() + args.timeoutMinutes * 60_000;
    let updates = 0;
    let refusals = 0;
    let blockedGreenReads = 0;
    let lastWait = '';

    for (;;) {
      const snapshot = io.read(pr);
      if (!snapshot) return stop(index, `#${pr} could not be read`);
      const step = decideNext(snapshot, required, { blockedGreenReads });

      if (args.dryRun) {
        io.log(`#${pr}: would ${describe(step)}`);
        if (step.kind === 'stop') return stop(index, step.reason);
        break;
      }

      if (step.kind === 'merged') {
        io.log(`#${pr}: already merged`);
        merged.push(pr);
        break;
      }
      if (step.kind === 'stop') return stop(index, step.reason);

      if (step.kind === 'update') {
        if (updates >= MAX_UPDATES_PER_PULL_REQUEST) {
          return stop(
            index,
            `#${pr} fell behind \`${TRAIN_BASE}\` ${updates + 1} times; something else is merging as fast as the train`,
          );
        }
        updates += 1;
        io.log(`#${pr}: behind \`${TRAIN_BASE}\`, updating the branch`);
        if (!io.update(pr, snapshot.headRefOid)) {
          return stop(index, `#${pr} could not be brought up to date`);
        }
        blockedGreenReads = 0;
        lastWait = '';
        await io.sleep(args.pollSeconds);
        continue;
      }

      if (step.kind === 'merge') {
        io.log(
          `#${pr}: required checks green on ${step.headRefOid.slice(0, 8)}, merging`,
        );
        if (io.merge(pr, step.headRefOid, args.method)) {
          merged.push(pr);
          break;
        }
        // Refused: most often `main` moved between the read and the merge,
        // and the next read is BEHIND and updates. A refusal that repeats on
        // a green head is bounded twice over: by count and by the deadline.
        refusals += 1;
        if (refusals >= MAX_MERGE_REFUSALS) {
          return stop(
            index,
            `GitHub refused to merge #${pr} ${refusals} times with every required check green`,
          );
        }
        if (io.now() >= deadline) {
          return stop(
            index,
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
        return stop(
          index,
          `#${pr} waited ${args.timeoutMinutes} min and is still ${step.reason}`,
        );
      }
      if (step.reason !== lastWait) io.log(`#${pr}: ${step.reason}`);
      lastWait = step.reason;
      await io.sleep(args.pollSeconds);
    }
  }
  return { merged, stoppedAt: null, notReached: [] };
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

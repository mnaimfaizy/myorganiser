#!/usr/bin/env node
// The golden set's tier filter (ADR 0072), and the only implementation of it.
//
//   node tools/scripts/review/golden-tiers.ts [--tier guard|frontier|all]
//   node tools/scripts/review/golden-tiers.ts --matrix --tier <tier> --event <event> [--cases <id,id>]
//   node tools/scripts/review/golden-tiers.ts --scheduled
//
// Prints the case ids of one tier as a JSON array. `all`, or no `--tier`,
// prints every case. `--matrix` prints the replay workflow's matrix instead:
// one `{case, repetition}` entry per reviewer session, three per frontier
// case when the event is `schedule` and one otherwise (ADR 0116).
// `--cases` replaces the tier with the named cases, still one repetition
// each: a dispatch-only bake-off over the cases it is about (issue #1140).
// `--scheduled` prints the tier this week's scheduled replay runs, or an
// empty line for none, from the git history of the reviewer's inputs
// (ADR 0109).
//
// A case's tier is where it stands, not only what the set declares: its
// catch rate over its last ten scored runs in the results record moves it,
// and the declared tier holds until the record has ten (ADR 0116,
// golden-standing.ts).
//
// This file exists because the filter was briefly written twice: once as a
// jq expression in review-golden-replay.yml and once as `--list --tier` in
// score-golden-case.ts, and they disagreed about the word "all". The jq
// version was there because the workflow's `cases` job installs nothing and
// the scorer reaches schema.ts, which imports zod. So the constraint is
// real: whatever the workflow calls must have no third-party imports.
//
// Nothing here imports anything but Node built-ins. Keep it that way, and keep
// this the single place that decides which cases a tier contains.
//
// Exit 0 = printed. Exit 2 = could not run.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { parseResultsFile } from './golden-results.ts';
import { caseStandings } from './golden-standing.ts';

export const GOLDEN_SET_PATH = 'tools/config/review-golden-set.json';
export const GOLDEN_RESULTS_PATH = 'docs/review/golden-replay-results.jsonl';

/** The results record, or no records when nothing has been recorded yet. */
export const loadGoldenRecords = (path = GOLDEN_RESULTS_PATH) =>
  existsSync(path) ? parseResultsFile(readFileSync(path, 'utf8')) : [];

/** The tiers a case may declare, plus the pseudo-tier meaning "every case". */
export const CASE_TIERS = ['guard', 'frontier'];
export const ALL_TIERS = 'all';

const standingsInTier = (set, tier, records) => {
  if (tier && tier !== ALL_TIERS && !CASE_TIERS.includes(tier))
    throw new Error(
      `tier must be one of ${[...CASE_TIERS, ALL_TIERS].join(', ')}, got ${tier}`,
    );
  return caseStandings(set, records).filter(
    (s) => !tier || tier === ALL_TIERS || s.tier === tier,
  );
};

/**
 * @param {{cases: {id: string, tier: string}[]}} set
 * @param {string} [tier] one of CASE_TIERS, or ALL_TIERS / undefined for every case
 * @param {{case: string, outcome: string}[]} [records] the results record;
 *   a case stands where its last ten scored runs put it (ADR 0116), and at
 *   its declared tier when the record holds fewer
 * @returns {string[]} case ids, in the set's own order
 */
export const caseIdsInTier = (set, tier, records = []) =>
  standingsInTier(set, tier, records).map((s) => s.id);

/**
 * How many times the weekly scheduled replay runs each frontier case
 * (ADR 0116): one run of a stochastic reviewer decides nothing, and three a
 * week fill a ten-run window in a month. A label or a dispatch stays one
 * repetition (ADR 0072 item 8), and so does a guard on any event.
 */
export const SCHEDULED_FRONTIER_REPETITIONS = 3;
export const SCHEDULE_EVENT = 'schedule';

/**
 * The replay workflow's matrix: one entry per reviewer session, case by
 * case so a case's repetitions sit together in the record.
 *
 * `cases`, when it names any, replaces the tier: a dispatch that asks for
 * three cases replays those three, from whichever tier they stand at, in the
 * set's order (issue #1140). It never buys repetitions; a dispatch stays one
 * repetition per case (ADR 0072 item 8, ADR 0116).
 *
 * @param {string[]} [options.cases] case ids to replay instead of a tier
 * @returns {{case: string, repetition: number}[]}
 */
export const replayMatrix = (
  set,
  tier,
  { records = [], event, cases = [] } = {},
) => {
  const ids = new Set(set.cases.map((c) => c.id));
  for (const id of cases)
    if (!ids.has(id)) throw new Error(`no golden case "${id}"`);
  const standings = cases.length
    ? standingsInTier(set, ALL_TIERS, records).filter((s) =>
        cases.includes(s.id),
      )
    : standingsInTier(set, tier, records);
  return standings.flatMap((s) => {
    const repetitions =
      event === SCHEDULE_EVENT && s.tier === 'frontier'
        ? SCHEDULED_FRONTIER_REPETITIONS
        : 1;
    return Array.from({ length: repetitions }, (_, i) => ({
      case: s.id,
      repetition: i + 1,
    }));
  });
};

/**
 * What a replay measures, as git pathspecs: the paths that produce a review.
 * The scheduled replay runs only when one of these moved (ADR 0109). A path
 * left off here is a reviewer change that waits up to a month to be measured.
 *
 * `.claude`, the Copilot hooks and the upstream-brief Skill are deliberately
 * not here (#925), though the replay lays them over each case tree (ADR
 * 0102): the one way they broke a replay, a permission rule refusing an
 * instructed command, is review:allowlist:check's to catch (ADR 0099), and
 * `.claude` moves most weeks, so watching it would make the gate always true.
 */
export const REPLAY_INPUT_PATHS = [
  '.agents/skills/code-review',
  'tools/scripts/review',
  '.github/actions/code-reviewer',
  '.github/workflows/code-review.yml',
  '.github/workflows/review-golden-replay.yml',
  'tools/config/review-golden-set.json',
  'tools/config/review-obligations.json',
  'tools/config/review-rules.json',
];

/** How far back each scheduled tier looks for a changed input (ADR 0109). */
export const FRONTIER_LOOKBACK_DAYS = 7;
export const GUARD_LOOKBACK_DAYS = 31;

export const isFirstWeekOfMonth = (date) => date.getUTCDate() <= 7;

/**
 * The tier a weekly scheduled replay runs, or null for none (ADR 0109).
 * Frontier weekly when an input moved that week; every case in the first week
 * of a month in which an input moved; nothing when the reviewer did not move,
 * because re-measuring an untouched reviewer is the spend the schedule removes.
 */
export const scheduledTier = ({
  changedInWeek,
  changedInMonth,
  firstWeekOfMonth,
}) => {
  if (firstWeekOfMonth && changedInMonth) return ALL_TIERS;
  if (changedInWeek) return 'frontier';
  return null;
};

const inputsChangedSince = (days, now) => {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const out = execFileSync(
    'git',
    [
      'log',
      `--since=${since}`,
      '--format=%H',
      'HEAD',
      '--',
      ...REPLAY_INPUT_PATHS,
    ],
    { encoding: 'utf8' },
  );
  return out.trim() !== '';
};

const scheduledMain = (now) => {
  const tier = scheduledTier({
    changedInWeek: inputsChangedSince(FRONTIER_LOOKBACK_DAYS, now),
    changedInMonth: inputsChangedSince(GUARD_LOOKBACK_DAYS, now),
    firstWeekOfMonth: isFirstWeekOfMonth(now),
  });
  process.stdout.write(`${tier ?? ''}\n`);
};

const main = (argv) => {
  if (argv.includes('--scheduled')) {
    try {
      scheduledMain(new Date());
    } catch (err) {
      process.stderr.write(`golden-tiers: ${err.message}\n`);
      process.exit(2);
    }
    return;
  }
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const tier = value('--tier');
  try {
    const set = JSON.parse(readFileSync(GOLDEN_SET_PATH, 'utf8'));
    const records = loadGoldenRecords();
    const out = argv.includes('--matrix')
      ? replayMatrix(set, tier, {
          records,
          event: value('--event'),
          cases: (value('--cases') ?? '')
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean),
        })
      : caseIdsInTier(set, tier, records);
    process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`golden-tiers: ${err.message}\n`);
    process.exit(2);
  }
};

// `isMain` lives in cli.ts, which reaches schema.ts and zod; this file
// cannot import it, so the check is inlined against the builtin URL helper
// rather than by comparing basenames, which two same-named scripts would
// both satisfy.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));

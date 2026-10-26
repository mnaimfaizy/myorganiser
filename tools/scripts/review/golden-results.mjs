/**
 * The golden replay results record (issue #932): one JSON line per case run,
 * including voids, which are recorded as voids and never as misses or
 * catches (ADR 0101). Every replay run appends a line for every case it
 * ran; the ledger's Runs table is generated from the accumulated lines by
 * `renderRunsTable`, and `check-review-golden-results.ts` fails when the
 * two disagree.
 *
 * Everything here is pure except `appendResultLine`, which is the one write
 * the workflow needs; `record-golden-result.mjs` is its thin CLI.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The terms file, not run-ladder.mjs: this module is read before any
// dependency is installed, and the ladder reaches zod.
import { RUN_FAILURES } from './run-ladder-terms.mjs';

export class GoldenResultError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GoldenResultError';
  }
}

/**
 * A pattern case's run either caught the expected findings, missed them, or
 * measured nothing (ADR 0101). A clean case (issue #933) has no findings to
 * catch or miss — it passed or failed on whether a Blocking finding
 * appeared — so it is recorded as `clean-pass` or `clean-fail`, never folded
 * into `caught`/`missed`: those two carry a recall number and a clean case
 * has none, which is the whole distinction `scoreCase` in golden.mjs draws
 * and this record exists to preserve, not collapse, on the way to disk.
 */
export const OUTCOMES = Object.freeze([
  'caught',
  'missed',
  'clean-pass',
  'clean-fail',
  'void',
]);

/** The two clean-case outcomes: scored, but never carrying a recall number. */
const CLEAN_OUTCOMES = Object.freeze(['clean-pass', 'clean-fail']);

/**
 * Every reason a case run can measure nothing, matched to what
 * `.github/actions/code-reviewer/action.yml` and `review-golden-replay.yml`
 * already distinguish: the subscription rate limit (including a transcript
 * that could not be read for rate-limit events — `unknown` is not read as
 * "no lockout"), the turn ceiling on a genuinely hard case, the harness
 * refusing a permission the reviewer's own instructions told it to use —
 * at the turn ceiling, or on a write to its own report or answer sheet
 * (`prevented`, classified by `classify-reviewer-run.mjs`), the obligation
 * answer sheet failing `review:obligations:check` (ADR 0101), the run
 * facts that fail `Agent Review Ran` in production (ADR 0123 item 7, ADR
 * 0126: `RUN_FAILURES` in run-ladder-terms.mjs — no sub-agent read an axis's
 * brief, a reported finding was not one a sub-agent returned, or a finding's
 * executed evidence is not in the transcript), and a residual
 * `unknown` for a run that produced no valid report for a reason none of the
 * above names.
 */
export const VOID_REASONS = Object.freeze([
  'rate-limit',
  'turn-ceiling',
  'prevented',
  'answer-sheet-check-failed',
  ...RUN_FAILURES,
  'unknown',
]);

/**
 * The run facts a result line carries beside its outcome (ADR 0123 item 7):
 * the three that tighten a tier in production. A replay has no tier to
 * tighten, so they are recorded here, and a miss can be read as "the
 * reviewer skipped the index" without anyone downloading a transcript.
 * `null` is "not known": no report was validated, or the line was written
 * before these were recorded.
 */
const RUN_FACT_FLAGS = Object.freeze([
  ['index_opened', 'indexOpened'],
  ['dispatch_on_template', 'dispatchOnTemplate'],
  ['shape_readable', 'shapeReadable'],
]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isFiniteNonNegative = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Validates and normalizes one result record. Throws `GoldenResultError` on
 * anything that would let a void be read back as a miss or a catch, or that
 * otherwise does not fit the schema.
 *
 * @returns the record with fixed key order, ready for `formatResultLine`.
 */
export function buildResultRecord({
  date,
  runId,
  commit,
  caseId,
  outcome,
  voidReason = null,
  recall = null,
  totalCostUsd = null,
  turns = null,
  model,
  cliVersion = null,
  indexOpened = null,
  dispatchOnTemplate = null,
  shapeReadable = null,
} = {}) {
  const err = (msg) => {
    throw new GoldenResultError(msg);
  };

  if (!DATE.test(date ?? ''))
    err(`date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
  if (!isNonEmptyString(runId)) err('run_id is required');
  if (!isNonEmptyString(commit)) err('commit is required');
  if (!isNonEmptyString(caseId)) err('case is required');
  if (!isNonEmptyString(model)) err('model is required');
  if (!OUTCOMES.includes(outcome))
    err(
      `outcome must be one of ${OUTCOMES.join(', ')}, got ${JSON.stringify(outcome)}`,
    );

  if (outcome === 'void') {
    if (!VOID_REASONS.includes(voidReason))
      err(
        `a void record's void_reason must be one of ${VOID_REASONS.join(', ')}, got ${JSON.stringify(voidReason)}`,
      );
    if (recall !== null)
      err(
        'a void record carries no recall — it was not scored (ADR 0101), never as a miss or a catch',
      );
  } else if (CLEAN_OUTCOMES.includes(outcome)) {
    // clean-pass / clean-fail: scored, but on whether a Blocking finding
    // appeared, not on a recall fraction — there is nothing here to recall.
    if (voidReason !== null) err(`a ${outcome} record carries no void_reason`);
    if (recall !== null)
      err(
        `a ${outcome} record carries no recall — a clean case is scored clean-pass or clean-fail, never a recall number`,
      );
  } else {
    if (voidReason !== null) err(`a ${outcome} record carries no void_reason`);
    if (
      typeof recall !== 'number' ||
      !Number.isFinite(recall) ||
      recall < 0 ||
      recall > 1
    )
      err(
        `a ${outcome} record's recall must be a number between 0 and 1, got ${JSON.stringify(recall)}`,
      );
  }

  for (const [key, value] of [
    ['total_cost_usd', totalCostUsd],
    ['turns', turns],
  ]) {
    if (value !== null && !isFiniteNonNegative(value))
      err(
        `${key} must be a non-negative number or null, got ${JSON.stringify(value)}`,
      );
  }

  if (cliVersion !== null && !isNonEmptyString(cliVersion))
    err(
      `cli_version must be a non-empty string or null, got ${JSON.stringify(cliVersion)}`,
    );
  const flags = { indexOpened, dispatchOnTemplate, shapeReadable };
  for (const [key, field] of RUN_FACT_FLAGS) {
    if (flags[field] !== null && typeof flags[field] !== 'boolean')
      err(
        `${key} must be true, false, or null, got ${JSON.stringify(flags[field])}`,
      );
  }

  return {
    date,
    run_id: runId,
    commit,
    case: caseId,
    outcome,
    void_reason: voidReason,
    recall,
    total_cost_usd: totalCostUsd,
    turns,
    model,
    cli_version: cliVersion,
    index_opened: indexOpened,
    dispatch_on_template: dispatchOnTemplate,
    shape_readable: shapeReadable,
  };
}

/**
 * The run-fact fields of a result line, read from a normalized report.
 *
 * Each flag is `true`, `false`, or `null` for "cannot tell" — an unreadable
 * transcript says nothing about whether the index was opened, and recording
 * `false` there would be a claim. `dispatchOnTemplate` is false when any
 * dispatch carried text beyond the template.
 *
 * @param {unknown} normalized a normalized report, or null when none was written
 */
export const runFactFields = (normalized) => {
  const facts =
    normalized?.runFactsFrom === 'transcript' ? normalized.runFacts : null;
  if (!facts)
    return {
      cliVersion: null,
      indexOpened: null,
      dispatchOnTemplate: null,
      shapeReadable: null,
    };
  const readable = facts.shape === 'readable';
  const dispatched = readable
    ? Object.values(facts.axes).filter((a) => a.dispatched)
    : [];
  return {
    cliVersion: facts.cliVersion ?? null,
    indexOpened: readable ? facts.indexOpened : null,
    dispatchOnTemplate: !readable
      ? null
      : facts.unattributedDispatches > 0
        ? false
        : dispatched.length > 0
          ? dispatched.every((a) => a.onTemplate)
          : null,
    shapeReadable: readable && facts.repliesParsed !== false,
  };
};

/** One JSON line, in the record's fixed key order. */
export const formatResultLine = (record) => JSON.stringify(record);

/**
 * Parses the results record: one JSON object per non-blank line, each
 * re-validated through `buildResultRecord` so a hand-edited or corrupted
 * line is caught here rather than by whatever reads the parsed records.
 * Throws `GoldenResultError` naming the offending line.
 */
export function parseResultsFile(text) {
  const records = [];
  const lines = (text ?? '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new GoldenResultError(
        `line ${i + 1}: not valid JSON: ${err.message}`,
      );
    }

    try {
      records.push(
        buildResultRecord({
          date: parsed.date,
          runId: parsed.run_id,
          commit: parsed.commit,
          caseId: parsed.case,
          outcome: parsed.outcome,
          voidReason: parsed.void_reason ?? null,
          recall: parsed.recall ?? null,
          totalCostUsd: parsed.total_cost_usd ?? null,
          turns: parsed.turns ?? null,
          model: parsed.model,
          cliVersion: parsed.cli_version ?? null,
          indexOpened: parsed.index_opened ?? null,
          dispatchOnTemplate: parsed.dispatch_on_template ?? null,
          shapeReadable: parsed.shape_readable ?? null,
        }),
      );
    } catch (err) {
      if (err instanceof GoldenResultError)
        throw new GoldenResultError(`line ${i + 1}: ${err.message}`);
      throw err;
    }
  }
  return records;
}

/**
 * Builds, validates, and appends one line to the results record at `path`,
 * creating its directory if needed. The one write in this module; every
 * other export is pure.
 */
export function appendResultLine(path, fields) {
  const record = buildResultRecord(fields);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${formatResultLine(record)}\n`);
  return record;
}

/**
 * Groups records by `run_id` — one replay dispatch, in the order each run
 * id first appears in the file. A run's records must agree on date, model,
 * and commit; disagreement means the file was hand-edited into something
 * that never actually ran, which is a fact worth failing on rather than
 * silently picking the first value seen.
 */
export function groupRuns(records) {
  const order = [];
  const byRun = new Map();

  for (const r of records) {
    let group = byRun.get(r.run_id);
    if (!group) {
      group = {
        runId: r.run_id,
        date: r.date,
        model: r.model,
        commit: r.commit,
        records: [],
      };
      byRun.set(r.run_id, group);
      order.push(r.run_id);
    }
    for (const [field, value, seen] of [
      ['date', r.date, group.date],
      ['model', r.model, group.model],
      ['commit', r.commit, group.commit],
    ]) {
      if (value !== seen)
        throw new GoldenResultError(
          `run ${r.run_id} has records with different ${field} values (${JSON.stringify(seen)} and ${JSON.stringify(value)}) — the record is corrupt`,
        );
    }
    group.records.push(r);
  }

  return order.map((id) => byRun.get(id));
}

/**
 * Counts and the `X of Y` phrasing the ledger's narrative sections already
 * use. A clean-pass counts alongside a caught pattern case and a clean-fail
 * alongside a missed one: both pairs are "the reviewer got this one right"
 * and "the reviewer got this one wrong" for the run-level tally, even though
 * `buildResultRecord` never lets the two carry the same shape of evidence
 * (one a recall number, the other none) — collapsing them here would lose
 * nothing the raw `outcome` field on each record does not still say.
 */
export function summarizeRun(group, { seeded = new Set() } = {}) {
  const tally = (records) => {
    const caught = records.filter(
      (r) => r.outcome === 'caught' || r.outcome === 'clean-pass',
    ).length;
    const missed = records.filter(
      (r) => r.outcome === 'missed' || r.outcome === 'clean-fail',
    ).length;
    return { caught, missed, scorable: caught + missed };
  };
  const { caught, missed, scorable } = tally(group.records);
  const voided = group.records.filter((r) => r.outcome === 'void').length;
  // A Seeded Case shows the reviewer can catch a defect shape; an attributed
  // one, that it would have caught a defect that shipped. The two are never
  // pooled (ADR 0130 item 4). A run with no seeded case reads as it always has.
  const seededRecords = group.records.filter((r) => seeded.has(r.case));
  const counts =
    seededRecords.length === 0
      ? `${caught} of ${scorable}`
      : (() => {
          const a = tally(group.records.filter((r) => !seeded.has(r.case)));
          const z = tally(seededRecords);
          return `attributed ${a.caught} of ${a.scorable} · seeded ${z.caught} of ${z.scorable}`;
        })();
  const result = voided === 0 ? counts : `${counts} scorable, ${voided} void`;
  return {
    caught,
    missed,
    voided,
    scorable,
    total: group.records.length,
    result,
  };
}

/** The ids of a raw golden set's Seeded Cases. Read without validating, so
 * the ledger check stays installable-free like the rest of this module. */
export const seededCaseIds = (set) =>
  new Set(
    (set?.cases ?? []).filter((c) => c.origin === 'seeded').map((c) => c.id),
  );

/** The markers `docs/review/golden-replay-results.md` wraps the generated
 * Runs section in. Historical rows above them are hand-written and untouched
 * — the generated section starts from the first recorded line. */
export const GENERATED_START = '<!-- GENERATED:golden-runs:START -->';
export const GENERATED_END = '<!-- GENERATED:golden-runs:END -->';

/** Renders the generated Runs section from `records` — one row per replay
 * dispatch (grouped by `run_id`), newest last, matching the historical
 * table's own convention. */
export function renderRunsTable(records, { seeded = new Set() } = {}) {
  const groups = groupRuns(records);
  if (groups.length === 0) return '_No recorded runs yet._';

  const header =
    '| Date | Run ID | Model | Cases | Result | Commit |\n' +
    '| --- | --- | --- | --- | --- | --- |';
  const rows = groups.map((g) => {
    const s = summarizeRun(g, { seeded });
    return `| ${g.date} | \`${g.runId}\` | \`${g.model}\` | ${s.total} | ${s.result} | \`${g.commit.slice(0, 7)}\` |`;
  });
  return [header, ...rows].join('\n');
}

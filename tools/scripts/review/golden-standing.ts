/**
 * A golden case's standing: its catch rate over its last ten scored runs,
 * read from the replay results record (issue #937, ADR 0116). It replaces
 * the streak rule of ADR 0072 item 2 — three consecutive catches to promote,
 * one miss to demote — under which `export-envelope-drops-tasks`, caught 19
 * times and missed 19, changed tier four times on what was a coin flip.
 *
 * Nothing here imports anything: golden-tiers.ts calls it from the replay
 * workflow's `cases` job, which installs nothing.
 */

/** How many scored runs a standing is read over. */
export const STANDING_WINDOW = 10;
/** At or above this many catches in the window, a case stands at `guard`. */
export const PROMOTE_AT = 8;
/** At or below this many catches in the window, a case stands at `frontier`. */
export const DEMOTE_AT = 5;

// A clean case (issue #933) passes by staying quiet, so its pass counts as a
// catch and its fail as a miss. A void is neither: it measured nothing
// (ADR 0101) and is not a scored run.
const CATCHES = ['caught', 'clean-pass'];
const MISSES = ['missed', 'clean-fail'];

/**
 * One case's standing, folded over the record in file order.
 *
 * The tier starts at the one the set declares and moves only on a full
 * window: 8 or more catches of the last ten scored runs make it `guard`, 5
 * or fewer make it `frontier`, and 6 or 7 leave it where it was. The band in
 * between is what stops a case flickering: with one cut-off at 8, a case the
 * reviewer catches nine times in ten would be demoted in about one window in
 * fourteen. Under ten scored runs nothing moves.
 *
 * @param {{case: string, outcome: string}[]} records the results record
 * @param {string} caseId
 * @param {string} declaredTier the case's `tier` in the golden set
 */
export function caseStanding(records, caseId, declaredTier) {
  let tier = declaredTier;
  const scored = [];
  for (const r of records) {
    if (r.case !== caseId) continue;
    if (CATCHES.includes(r.outcome)) scored.push(true);
    else if (MISSES.includes(r.outcome)) scored.push(false);
    else continue;
    if (scored.length < STANDING_WINDOW) continue;
    const caught = scored.slice(-STANDING_WINDOW).filter(Boolean).length;
    if (caught >= PROMOTE_AT) tier = 'guard';
    else if (caught <= DEMOTE_AT) tier = 'frontier';
  }
  const window = scored.slice(-STANDING_WINDOW);
  return {
    id: caseId,
    declaredTier,
    tier,
    scoredRuns: scored.length,
    windowRuns: window.length,
    caught: window.filter(Boolean).length,
    decided: scored.length >= STANDING_WINDOW,
    heldAtFrontier: false,
  };
}

/**
 * Every case's standing, in the set's own order.
 *
 * Promotion may not empty the frontier (ADR 0072, amended 2026-09-17): the
 * weekly replay runs the frontier, so a set standing all-guard is measured
 * once a month and no sooner. When the record would leave no case at
 * `frontier`, the promoted case with the fewest catches in its window — the
 * first in set order on a tie — stays there and says so.
 *
 * @param {{cases: {id: string, tier: string}[]}} set
 * @param {{case: string, outcome: string}[]} records
 */
export function caseStandings(set, records) {
  const standings = (set?.cases ?? []).map((c) =>
    caseStanding(records, c.id, c.tier),
  );
  if (standings.length === 0 || standings.some((s) => s.tier === 'frontier'))
    return standings;
  const promoted = standings.filter((s) => s.declaredTier === 'frontier');
  if (promoted.length === 0) return standings;
  const held = promoted.reduce((a, b) => (b.caught < a.caught ? b : a));
  held.tier = 'frontier';
  held.heldAtFrontier = true;
  return standings;
}

/** The markers the ledger wraps the generated standing table in. */
export const STANDING_START = '<!-- GENERATED:golden-standing:START -->';
export const STANDING_END = '<!-- GENERATED:golden-standing:END -->';

const standingNote = (s) => {
  if (!s.decided)
    return `declared; under ${STANDING_WINDOW} scored runs, so nothing moves`;
  if (s.heldAtFrontier)
    return 'earned `guard`, held here so the frontier is not empty';
  if (s.caught >= PROMOTE_AT) return `${PROMOTE_AT} or more of ten`;
  if (s.caught <= DEMOTE_AT) return `${DEMOTE_AT} or fewer of ten`;
  return 'between the thresholds, so it stays where it was';
};

/**
 * The ledger's standing table: each case's rate and number of scored runs.
 * Rendered from the set and the record, and asserted against the ledger by
 * check-review-golden-results.ts.
 */
export function renderStandingTable(set, records) {
  const header =
    '| Case | Declared tier | Scored runs | Caught of last ten | Rate | Stands at | Why |\n' +
    '| --- | --- | --- | --- | --- | --- | --- |';
  const rows = caseStandings(set, records).map((s) => {
    const rate =
      s.windowRuns === 0
        ? '—'
        : `${Math.round((s.caught / s.windowRuns) * 100)}%`;
    return `| \`${s.id}\` | \`${s.declaredTier}\` | ${s.scoredRuns} | ${s.caught} of ${s.windowRuns} | ${rate} | \`${s.tier}\` | ${standingNote(s)} |`;
  });
  return [header, ...rows].join('\n');
}

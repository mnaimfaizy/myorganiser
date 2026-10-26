/**
 * Whether a finished slice run is clean enough to close (ADR 0111).
 *
 * In PRD mode a slice that produced commits is always integrated and marked
 * `status:done` (ADR 0045) — that is what keeps a re-run from dispatching it
 * twice. Closing it, and unblocking the slices that depend on it, is a stronger
 * claim: that the slice is finished. Mobile v1 made that claim for every slice
 * that committed anything, while the agents' own output said otherwise —
 * "## Not delivered — keep-awake", a last review verdict of request-changes, a
 * run that never signalled completion. This module reads that output and
 * decides.
 *
 * Pure: it takes the log text and returns a verdict, so the rules are tested
 * without a sandbox, a network, or GitHub.
 */

import { RUN_START_MARKER } from './sandcastle-resume.mjs';

/** What an agent prints when it has stopped working on the slice. */
export const COMPLETION_PROMISE = '<promise>COMPLETE</promise>';

/**
 * What an agent prints, one per line, for anything it did not do or could not
 * verify: an unresolved blocking review finding, an acceptance criterion it did
 * not deliver, a device-only check, a source it could not read.
 */
export const OUTSTANDING_MARKER = 'OUTSTANDING:';

/**
 * The label a held slice takes in place of `ready-for-agent`: the triage state
 * role for work that needs a person next.
 */
export const NEEDS_HUMAN_LABEL = 'ready-for-human';

// Iterations after the first are cold restarts with the same prompt (ADR 0035),
// so only the last one's output describes the branch as it was left.
const ITERATION_LINE = /^Iteration \d+\/\d+\s*$/m;

// A marker line, optionally as a list item or in bold: the agent writes
// Markdown, and `- OUTSTANDING:` or `**OUTSTANDING:**` is the same statement.
const OUTSTANDING_LINE =
  /^\s*(?:[-*]\s+)?(?:\*\*)?OUTSTANDING:(?:\*\*)?\s*(.*?)\s*$/;

// "None" is a way of saying there is nothing outstanding, not an item.
const NOTHING = /^(?:none|n\/a|nothing|-)?\.?$/i;

// Agents justify the "none" — `OUTSTANDING: none — all criteria verified` — and
// #1326 was held on exactly that line. A "none" set off from its explanation by
// punctuation still says nothing is outstanding; "none of the device checks ran"
// has no separator and stays an item.
const NOTHING_WITH_REASON =
  /^(?:none|n\/a|nothing)(?:\.\s|\s*[—–:;,(]|\s+-\s)(.*)$/i;

// When in doubt the slice is held: a false hold costs a person one look, a false
// clean closes a slice with work left in it. So a reason clears the line only if
// it affirms the work was checked, and names no exception. A deny-list alone let
// "none — device check skipped" through, because no listed word was in it.
// Bare "fails" is not an exception: a gate that fails on drift is the behaviour
// a slice here verifies, and #1326's own line says "Meta-Gate fails/accepts".
const AFFIRMS =
  /\b(?:verified|re-verified|passed|passes|pass|green|clean|done|fixed|complete|completed|met|delivered|checked|confirmed)\b/i;

const EXCEPTION =
  /\b(?:but|except|however|unless|although|though|yet|still|pending|remaining|remains|left|skipped|skip|deferred|later|follow-up|todo|tbd|needs?|missing|partial|partly|failed|failing|blocked|unable|unverified|unchecked|not|never|no|could not|cannot|\w+n['’]t)\b/i;

const saysNothing = (text) => {
  if (NOTHING.test(text)) return true;
  const reason = NOTHING_WITH_REASON.exec(text);
  if (reason === null) return false;
  return AFFIRMS.test(reason[1]) && !EXCEPTION.test(reason[1]);
};

/**
 * The output of the last iteration of the last run in a slice log.
 *
 * @param {string} contents the whole log file
 * @returns {string}
 */
export function lastIterationOutput(contents) {
  const text = String(contents ?? '');
  const lastRunStart = text.lastIndexOf(RUN_START_MARKER);
  const run = lastRunStart === -1 ? text : text.slice(lastRunStart);
  const iterations = run.split(ITERATION_LINE);
  return iterations[iterations.length - 1];
}

/**
 * Judge a slice run from its log.
 *
 * Clean means both: the agent signalled completion, and it listed nothing
 * outstanding. Anything else holds the slice for a person, with every reason.
 *
 * The `/code-review` verdict is deliberately not read. The review runs once,
 * before its findings are fixed, so its handoff says request-changes on a slice
 * that went on to fix everything (#912's read "request-changes (10 findings …,
 * all addressed)") exactly as it does on one that left a blocker open (#913).
 * Which of the two happened is only in what the agent says next — so the prompt
 * requires every unresolved blocking finding to be printed as an OUTSTANDING
 * line, and this reads those.
 *
 * @param {string} contents the whole slice log
 * @returns {{ clean: boolean, outstanding: string[] }}
 */
export function judgeRunOutcome(contents) {
  const output = lastIterationOutput(contents);
  const outstanding = [];
  const seen = new Set();
  const add = (item) => {
    if (seen.has(item)) return;
    seen.add(item);
    outstanding.push(item);
  };

  if (!output.includes(COMPLETION_PROMISE)) {
    add(
      `The agent did not signal completion (${COMPLETION_PROMISE}); the run may have stopped part-way.`,
    );
  }

  for (const line of output.split('\n')) {
    const marker = OUTSTANDING_LINE.exec(line);
    if (marker && !saysNothing(marker[1])) add(marker[1]);
  }

  return { clean: outstanding.length === 0, outstanding };
}

/**
 * The comment a held slice gets: why it was not closed, and what it needs.
 *
 * @param {{ outstanding: string[], integrationBranch: string, commits: number }} held
 * @returns {string}
 */
export function formatHeldComment({ outstanding, integrationBranch, commits }) {
  return [
    `Agent finished with ${commits} commit(s), integrated into the local \`${integrationBranch}\` and marked \`status:done\` so a re-run will not dispatch it again.`,
    ``,
    `**Not closed: the run did not end clean** (ADR 0111). It stays open as \`${NEEDS_HUMAN_LABEL}\`, and the slices that depend on it stay blocked until a person resolves the items below and closes it.`,
    ``,
    ...outstanding.map((item) => `- ${item}`),
  ].join('\n');
}

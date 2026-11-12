/**
 * The QA Report the Merge Train reads (ADR 0148 decision 7): the header the
 * `finish-standalone-runs` Skill prints, and the staleness rule.
 *
 * Pure: no `gh`, no clock. The train's IO fetches the comments and the commit
 * graph; this file only reads them.
 *
 * Run the tests with: node --test tools/scripts/lib/qa-report.test.ts
 */

/** The first line of a QA Report comment. */
export const QA_REPORT_MARKER = '<!-- qa-report -->';

/** What a QA Report says happened. `none-needed` is "no manual QA needed". */
export type QaResult = 'passed' | 'failed' | 'none-needed';

/** The header of a QA Report: the result, the commit it names, the count left for a person. */
export interface QaHeader {
  result: QaResult;
  /** The full, lowercase 40-character SHA QA ran on. */
  commit: string;
  /** Items under "Left for a person"; 0 for `none-needed`. */
  leftForPerson: number;
}

// The two fixed forms the Skill prints. Strict on purpose: a short SHA, an
// extra field, another order or another case is a header the train cannot
// trust, so it does not parse.
const REPORT_HEADER_RE =
  /^QA Report: result=(passed|failed); commit=([0-9a-f]{40}); left-for-person=(0|[1-9]\d{0,5})$/;
const NONE_NEEDED_HEADER_RE =
  /^QA Report: no manual QA needed; commit=([0-9a-f]{40})$/;

/**
 * Reads a QA Report comment. The marker must be the comment's first line (a
 * comment that merely quotes it is not a report) and the header the first
 * non-blank line after it. Anything else is `null`.
 */
export function parseQaReport(
  body: string | null | undefined,
): QaHeader | null {
  const lines = (body ?? '').split(/\r?\n/);
  if (lines[0]?.trim() !== QA_REPORT_MARKER) return null;
  const header = lines
    .slice(1)
    .find((line) => line.trim() !== '')
    ?.trim();
  if (header === undefined) return null;
  const report = REPORT_HEADER_RE.exec(header);
  if (report) {
    return {
      result: report[1] as 'passed' | 'failed',
      commit: report[2],
      leftForPerson: Number(report[3]),
    };
  }
  const none = NONE_NEEDED_HEADER_RE.exec(header);
  return none
    ? { result: 'none-needed', commit: none[1], leftForPerson: 0 }
    : null;
}

/** One commit of a Pull Request, as `gh api pulls/N/commits` returns it. */
export interface PrCommit {
  sha: string;
  parents: string[];
}

/** Whether a QA Report's commit is still the work that would merge. */
export type QaStaleness =
  | { status: 'current' }
  | { status: 'stale'; byCommit: string }
  | { status: 'unknown'; reason: string };

const ancestorsOf = (
  start: string,
  bySha: Map<string, PrCommit>,
): Set<string> => {
  const seen = new Set<string>();
  const pending = [start];
  for (let sha = pending.pop(); sha !== undefined; sha = pending.pop()) {
    const commit = bySha.get(sha);
    if (!commit || seen.has(sha)) continue;
    seen.add(sha);
    pending.push(...commit.parents);
  }
  return seen;
};

/**
 * A report is stale only when a commit written on the branch follows the
 * commit it names. Those are the commits reachable from `head` that are not
 * the named commit or one of its ancestors, less each merge whose second
 * parent is on `main`: the train's own update, which the required checks on
 * the updated head cover. A merge of any other branch has two parents too and
 * is a change, which is why "has two parents" is not the test.
 *
 * `isOnMain` answers for a second parent; null (the question failed) is
 * unknown, which holds. A named commit the branch no longer has (a
 * force-push) or a `head` the list does not hold is unknown as well.
 */
export function qaStaleness(
  named: string,
  head: string,
  commits: readonly PrCommit[],
  isOnMain: (sha: string) => boolean | null,
): QaStaleness {
  if (named === head) return { status: 'current' };
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  if (!bySha.has(head))
    return {
      status: 'unknown',
      reason: `the head \`${head.slice(0, 8)}\` is not among the Pull Request's commits`,
    };
  if (!bySha.has(named))
    return {
      status: 'unknown',
      reason: `the QA Report names \`${named.slice(0, 8)}\`, which is no longer on the branch`,
    };
  const namedAndAncestors = ancestorsOf(named, bySha);
  const reachable = ancestorsOf(head, bySha);
  for (const commit of commits) {
    if (!reachable.has(commit.sha) || namedAndAncestors.has(commit.sha))
      continue;
    const secondParent = commit.parents.length >= 2 ? commit.parents[1] : null;
    if (secondParent === null) return { status: 'stale', byCommit: commit.sha };
    const onMain = isOnMain(secondParent);
    if (onMain === null)
      return {
        status: 'unknown',
        reason: `it could not be checked whether \`${secondParent.slice(0, 8)}\` is on \`main\``,
      };
    if (!onMain) return { status: 'stale', byCommit: commit.sha };
  }
  return { status: 'current' };
}

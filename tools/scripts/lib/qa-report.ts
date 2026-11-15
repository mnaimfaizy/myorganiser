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

/** Where a Person Check can be made (CONTEXT.md, ADR 0151). */
export const PERSON_CHECK_PLACES = ['local', 'staging', 'production'] as const;
export type PersonCheckPlace = (typeof PERSON_CHECK_PLACES)[number];

/** One Person Check line under "Left for a person". */
export interface PersonCheck {
  place: PersonCheckPlace;
  /** The line after `- [<place>] `, trimmed. Never blank. */
  text: string;
}

/**
 * The header of a QA Report: the result, the commit it names, and the Person
 * Checks left for a person.
 */
export interface QaHeader {
  result: QaResult;
  /** The full, lowercase 40-character SHA QA ran on. */
  commit: string;
  /**
   * `local` Person Checks only; 0 for `none-needed`. This is the count an
   * auto-merge holds on (ADR 0151).
   */
  leftForPerson: number;
  /** `staging` plus `production` Person Checks; never holds. 0 for a legacy header. */
  deferred: number;
  /**
   * The parsed Person Check lines. EMPTY for a legacy header (no `deferred=`)
   * and for `none-needed`: a legacy report's items carry no Place, are read as
   * all `local`, and are not synthesised into entries, so a consumer copying
   * deferred checks from an old report finds none.
   */
  checks: PersonCheck[];
}

// The two fixed forms the Skill prints. Strict on purpose: a short SHA, an
// extra field, another order or another case is a header the train cannot
// trust, so it does not parse.
const REPORT_HEADER_RE =
  /^QA Report: result=(passed|failed); commit=([0-9a-f]{40}); left-for-person=(0|[1-9]\d{0,5})(?:; deferred=(0|[1-9]\d{0,5}))?$/;
const NONE_NEEDED_HEADER_RE =
  /^QA Report: no manual QA needed; commit=([0-9a-f]{40})$/;

const SECTION_HEADING_RE = /^#{3}\s+Left for a person\s*$/;
const ANY_HEADING_RE = /^#{1,6}\s/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
// A top-level list item: a bullet or number in column 0. Any indented line is a continuation.
const LIST_ITEM_RE = /^(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
// The one accepted Person Check line: `- [<place>] <text>`, single space each side.
const PERSON_CHECK_RE = new RegExp(
  `^- \\[(${PERSON_CHECK_PLACES.join('|')})\\] (\\S.*)$`,
);

/**
 * The Person Checks under the first `### Left for a person` heading, outside
 * code fences, up to the next heading. Allow-list: a top-level list item that
 * is not exactly `- [local|staging|production] <text>` makes the section
 * unreadable (`null`), as does a second such heading. Indented lines and
 * non-list prose are ignored; a missing section is no checks.
 */
function parsePersonChecks(lines: string[]): PersonCheck[] | null {
  const checks: PersonCheck[] = [];
  let state: 'before' | 'in' | 'after' = 'before';
  let fenced = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (FENCE_RE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (SECTION_HEADING_RE.test(line)) {
      if (state !== 'before') return null;
      state = 'in';
      continue;
    }
    if (state === 'in' && ANY_HEADING_RE.test(line)) {
      state = 'after';
      continue;
    }
    if (state !== 'in' || !LIST_ITEM_RE.test(line)) continue;
    const m = PERSON_CHECK_RE.exec(line);
    if (!m) return null;
    checks.push({ place: m[1] as PersonCheckPlace, text: m[2].trim() });
  }
  return checks;
}

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
    const result = report[1] as 'passed' | 'failed';
    const left = Number(report[3]);
    // No `deferred=`: a legacy header. Every counted check is `local`; the
    // lines carry no Place and are not read.
    if (report[4] === undefined)
      return {
        result,
        commit: report[2],
        leftForPerson: left,
        deferred: 0,
        checks: [],
      };
    const checks = parsePersonChecks(lines);
    if (!checks) return null;
    const local = checks.filter((c) => c.place === 'local').length;
    const deferred = Number(report[4]);
    if (local !== left || checks.length - local !== deferred) return null;
    return {
      result,
      commit: report[2],
      leftForPerson: left,
      deferred,
      checks,
    };
  }
  const none = NONE_NEEDED_HEADER_RE.exec(header);
  return none
    ? {
        result: 'none-needed',
        commit: none[1],
        leftForPerson: 0,
        deferred: 0,
        checks: [],
      }
    : null;
}

/** The fields of a Pull Request comment the QA Report selection reads. */
export interface QaReportCandidate {
  body?: string | null;
  author?: { login?: string | null } | null;
  isMinimized?: boolean | null;
}

/**
 * The QA Report the train trusts among a Pull Request's comments: the latest
 * one the trusted login wrote, not outdated (minimised), whose first line is
 * the marker. A QA session posts as the Maintainer, so a report from anyone
 * else is a forgery. The latest is returned even when it does not parse, so a
 * caller never falls back to an older report.
 */
export function latestTrustedQaReport<T extends QaReportCandidate>(
  comments: readonly T[] | null | undefined,
  trustedLogin: string,
): T | undefined {
  return (comments ?? [])
    .filter(
      (c) =>
        c.author?.login === trustedLogin &&
        !c.isMinimized &&
        c.body?.split(/\r?\n/, 1)[0]?.trim() === QA_REPORT_MARKER,
    )
    .at(-1);
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

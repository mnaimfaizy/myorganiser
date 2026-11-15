/**
 * The Sign-off Issue (`CONTEXT.md`, ADR 0151 decision 6): the one open issue,
 * labelled `qa`, that gathers the `staging` and `production` Person Checks of
 * merged work for the next Cut. The Merge Train adds a Pull Request's
 * `staging` and `production` Person Checks to it when, and only when, it
 * actually merges that Pull Request.
 *
 * The body is text any collaborator can edit, so it is read by allow-list:
 * a top-level list item in the checks section that is not exactly a line this
 * module renders makes the body unparseable, and an unparseable body is never
 * written to. An edit only inserts lines; every other line of the body (the
 * Maintainer's prose, ticks, indented notes) is kept as it was.
 *
 * Each line carries a hidden key — the Pull Request and a hash of the Person
 * Check's Place and text — so a re-run never adds the same check twice, even
 * after the Maintainer edits the visible text.
 *
 * A tick is parsed as a raw fact here. Whose tick counts, waivers and the
 * production gate are ADR 0151 decisions 8 and 9, and live in
 * `tools/scripts/lib/signoff-gate.ts`. The frozen line is rendered and parsed here; writing it
 * at the Cut, and the retitle, are decision 7 and live elsewhere.
 *
 * Pure apart from the `SignOffIo` it is handed: the `gh` calls live in
 * `tools/scripts/ci/merge-train.ts`.
 *
 * Run the tests with: node --test tools/scripts/lib/signoff-issue.test.ts
 */

import { createHash } from 'node:crypto';

import {
  PERSON_CHECK_PLACES,
  latestTrustedQaReport,
  parseQaReport,
  qaStaleness,
  type PersonCheckPlace,
  type PrCommit,
  type QaReportCandidate,
} from './qa-report.ts';

/** The first line of a Sign-off Issue body. */
export const SIGNOFF_ISSUE_MARKER = '<!-- signoff-issue -->';

/** The label the Sign-off Issue wears, and is found by. */
export const SIGNOFF_ISSUE_LABEL = 'qa';

/**
 * The title a new Sign-off Issue is created with. Nothing reads it back: the
 * issue is found by its label, author and marker, so the Cut may retitle it.
 */
export const SIGNOFF_ISSUE_TITLE = 'Sign-off: Person Checks for the next Cut';

/** The heading of the section that holds the checks. */
export const SIGNOFF_SECTION_HEADING = '### Person Checks';

/** The Places a Sign-off Issue holds: every Place but `local`. */
export type SignOffPlace = Exclude<PersonCheckPlace, 'local'>;
// Derived, not listed again: a new Place reaches the Sign-off Issue unless it is `local`.
const SIGNOFF_PLACES = PERSON_CHECK_PLACES.filter(
  (place): place is SignOffPlace => place !== 'local',
);

/** One Person Check to add: where it came from, and what it says. */
export interface SignOffEntry {
  pr: number;
  place: SignOffPlace;
  text: string;
  /** The QA Report comment's URL. */
  reportUrl: string;
}

/** One line of a Sign-off Issue as read back. */
export interface SignOffCheck extends SignOffEntry {
  key: string;
  /** A raw fact: who ticked it is not known here, so it is trusted nowhere yet. */
  checked: boolean;
}

/** A parsed Sign-off Issue body. */
export interface SignOffIssueBody {
  checks: SignOffCheck[];
  /** The Cut the issue was frozen at, from its frozen line; null while it gathers for the next Cut. */
  frozen: { version: string } | null;
}

/** A release version, `vX.Y.Z`: what a Cut is named by. */
const RELEASE_VERSION = 'v\\d+\\.\\d+\\.\\d+';
export const isReleaseVersion = (version: string): boolean =>
  new RegExp(`^${RELEASE_VERSION}$`).test(version);

const FROZEN_PREFIX = '<!-- signoff-frozen';
const FROZEN_RE = new RegExp(
  `^${FROZEN_PREFIX} version=(${RELEASE_VERSION}) -->$`,
);

/**
 * The fixed line that marks a Sign-off Issue frozen at the Cut `version`
 * (`vX.Y.Z`). It goes between the marker and the `### Person Checks`
 * section; the Cut writes it (ADR 0151 decision 7), and the production gate
 * finds the Cut's issue by it (decision 8).
 */
export function renderSignOffFrozen(version: string): string {
  if (!isReleaseVersion(version))
    throw new Error(`not a release version: ${version}`);
  return `${FROZEN_PREFIX} version=${version} -->`;
}

/**
 * The key of a Person Check within its Pull Request: the first 12 hex
 * characters of sha256 over its Place and text. The Pull Request is the
 * other half of the line's key.
 */
export function signOffKey(place: SignOffPlace, text: string): string {
  return createHash('sha256')
    .update(`${place}\n${text}`)
    .digest('hex')
    .slice(0, 12);
}

const trailer = (pr: number, key: string): string =>
  `<!-- signoff-check pr=${pr} key=${key} -->`;

/** The checkbox line for one entry, unticked. */
export function renderSignOffLine(entry: SignOffEntry): string {
  return `- [ ] [${entry.place}] ${entry.text} · #${entry.pr} · [QA Report](${entry.reportUrl}) ${trailer(entry.pr, signOffKey(entry.place, entry.text))}`;
}

/** The body of a new Sign-off Issue holding `entries`. */
export function renderSignOffIssue(entries: readonly SignOffEntry[]): string {
  return [
    SIGNOFF_ISSUE_MARKER,
    'The `staging` and `production` Person Checks of merged work, gathered by the Merge Train for the next Cut (ADR 0151). Only the Maintainer ticks a check, or waives one with a `waive: <check> — <reason>` comment. An agent never does.',
    '',
    SIGNOFF_SECTION_HEADING,
    '',
    ...entries.map(renderSignOffLine),
    '',
  ].join('\n');
}

const ANY_HEADING_RE = /^#{1,6}\s/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
// A top-level list item: a bullet or number in column 0. Any indented line is a continuation.
const LIST_ITEM_RE = /^(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const CHECK_LINE_RE = new RegExp(
  `^- \\[( |x|X)\\] \\[(${SIGNOFF_PLACES.join('|')})\\] (\\S.*?) · #([1-9]\\d*) · \\[QA Report\\]\\((https://[^\\s()]+)\\) <!-- signoff-check pr=([1-9]\\d*) key=([0-9a-f]{12}) -->$`,
);

interface ParsedLines {
  lines: string[];
  eol: string;
  checks: SignOffCheck[];
  /** Where a new line goes: after the section's last non-blank line. */
  insertAt: number;
  /** Whether the section so far holds only its heading. */
  sectionEmpty: boolean;
  frozen: { version: string } | null;
}

function parseLines(body: string | null | undefined): ParsedLines | null {
  const text = body ?? '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== SIGNOFF_ISSUE_MARKER) return null;
  const checks: SignOffCheck[] = [];
  let state: 'before' | 'in' | 'after' = 'before';
  let fenced = false;
  let lastInSection = -1;
  let heading = -1;
  let frozen: { version: string } | null = null;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    // Fenced lines are content of whatever section holds them, never checks.
    if (FENCE_RE.test(line) || fenced) {
      if (FENCE_RE.test(line)) fenced = !fenced;
      if (state === 'in' && line !== '') lastInSection = index;
      continue;
    }
    // The frozen line, by allow-list: exactly one, in the fixed form, before the section.
    if (line.trimStart().startsWith(FROZEN_PREFIX)) {
      const f = FROZEN_RE.exec(line);
      if (!f || state !== 'before' || frozen) return null;
      frozen = { version: f[1] };
      continue;
    }
    if (line === SIGNOFF_SECTION_HEADING) {
      if (state !== 'before') return null;
      state = 'in';
      heading = index;
      lastInSection = index;
      continue;
    }
    if (state === 'in' && ANY_HEADING_RE.test(line)) {
      state = 'after';
      continue;
    }
    if (state === 'in' && line !== '') lastInSection = index;
    if (state !== 'in' || !LIST_ITEM_RE.test(line)) continue;
    const m = CHECK_LINE_RE.exec(line);
    if (!m || m[4] !== m[6]) return null;
    checks.push({
      checked: m[1] !== ' ',
      place: m[2] as SignOffPlace,
      text: m[3],
      pr: Number(m[4]),
      reportUrl: m[5],
      key: m[7],
    });
  }
  // A body with the marker but no checks section is not one this module wrote.
  if (heading === -1 || fenced) return null;
  return {
    lines,
    eol,
    checks,
    insertAt: lastInSection + 1,
    sectionEmpty: lastInSection === heading,
    frozen,
  };
}

/**
 * Reads a Sign-off Issue body, or `null` when it is not one in the fixed
 * form: the marker not on the first line, no `### Person Checks` section, a
 * second one, an unclosed code fence, a top-level list item in the section
 * that is not exactly a rendered check line (a `local` Place, another
 * trailer, a Pull Request number that differs from its key's), or a line
 * starting `<!-- signoff-frozen` that is not exactly one frozen line before
 * the section.
 */
export function parseSignOffIssue(
  body: string | null | undefined,
): SignOffIssueBody | null {
  const parsed = parseLines(body);
  return parsed ? { checks: parsed.checks, frozen: parsed.frozen } : null;
}

/**
 * A check line's id, `<pr>:<key>`: what keeps a re-run from adding a line
 * twice, and what a waiver names (ADR 0151 decision 9).
 */
export const signOffCheckId = (pr: number, key: string): string =>
  `${pr}:${key}`;
const lineKey = signOffCheckId;
const entryKey = (entry: SignOffEntry): string =>
  lineKey(entry.pr, signOffKey(entry.place, entry.text));

/**
 * Adds the entries whose key the body does not already hold, after the
 * section's last line, keeping every other line as it was. `null` when the
 * body is not in the fixed form, so nothing is written over it. `added` is
 * empty, and `body` unchanged, when every entry is already there.
 */
export function addToSignOffIssue(
  body: string,
  entries: readonly SignOffEntry[],
): { body: string; added: SignOffEntry[] } | null {
  const parsed = parseLines(body);
  if (!parsed) return null;
  const seen = new Set(parsed.checks.map((c) => lineKey(c.pr, c.key)));
  const added: SignOffEntry[] = [];
  for (const entry of entries) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(entry);
  }
  if (added.length === 0) return { body, added };
  const inserted = [
    ...(parsed.sectionEmpty ? [''] : []),
    ...added.map(renderSignOffLine),
  ];
  const lines = [
    ...parsed.lines.slice(0, parsed.insertAt),
    ...inserted,
    ...parsed.lines.slice(parsed.insertAt),
  ];
  return { body: lines.join(parsed.eol), added };
}

/** Whether an entry's text could forge or break a line's hidden trailer. */
export const unsafeSignOffText = (text: string): boolean =>
  text.includes('<!--') || text.includes('-->');

// --------------------------------------------------------------- reads

/** An open issue as `gh issue list --json number,body,author` returns it. */
export interface SignOffIssueCandidate {
  number: number;
  body?: string | null;
  author?: { login?: string | null } | null;
}

/** Which open issue is the Sign-off Issue. */
export type SignOffIssueLookup =
  | { status: 'none' }
  | { status: 'found'; number: number; body: string }
  | { status: 'unreadable'; reason: string };

/**
 * The open Sign-off Issue among open `qa` issues: one the trusted login (the
 * viewer the train runs as) wrote, whose first line is the marker. An issue
 * anyone else wrote is not the train's, however it is labelled, so it is
 * never written to. Two or more is unreadable, naming them: the train writes
 * to none rather than guess.
 */
export function findSignOffIssue(
  candidates: readonly SignOffIssueCandidate[] | null,
  trustedLogin: string | null,
): SignOffIssueLookup {
  if (!candidates || !trustedLogin)
    return {
      status: 'unreadable',
      reason: 'the open `qa` issues could not be read',
    };
  const own = candidates.filter(
    (issue) =>
      issue.author?.login === trustedLogin &&
      (issue.body ?? '').split(/\r?\n/, 1)[0]?.trim() === SIGNOFF_ISSUE_MARKER,
  );
  if (own.length === 0) return { status: 'none' };
  if (own.length > 1)
    return {
      status: 'unreadable',
      reason: `more than one Sign-off Issue is open (${own.map((i) => `#${i.number}`).join(', ')})`,
    };
  return { status: 'found', number: own[0].number, body: own[0].body ?? '' };
}

/** A Pull Request comment as `gh pr view --json comments` returns it. */
export interface QaReportComment extends QaReportCandidate {
  url?: string | null;
}

/** The `staging` and `production` Person Checks of a merged Pull Request's trusted QA Report. */
export type SignOffChecksRead =
  | { status: 'missing'; reason: string }
  | {
      status: 'read';
      /** `staging` and `production` lines only. */
      checks: { place: SignOffPlace; text: string }[];
      reportUrl: string;
      /** Why the report copied might not describe what merged; null when it does. */
      caveat: string | null;
    };

const REPORT_URL_RE = /^https:\/\/[^\s()]+$/;

/**
 * The `staging` and `production` Person Checks to copy, read from the QA Report the train
 * trusts (the same selection the Auto-merge fact makes). This is read after a
 * merge, only to copy lines, so it holds nothing: no report, or a latest one
 * that does not parse, is `missing` and nothing is copied. A legacy header
 * carries no Places and copies nothing (ADR 0151 decision 4).
 *
 * A report that records a failure, or that a later branch commit made stale,
 * is still copied — a `staging` or `production` Person Check is still work to do — with a caveat that
 * says so. `commits` and `isOnMain` are asked only when there is something to
 * copy and the report names another commit than `head`.
 *
 * This runs after the merge, so a merge the author made from another branch
 * is by then on `main` and reads as the train's own update: such a report is
 * copied with no stale caveat. The caveat is a note only, so this never
 * changes what is copied or merged.
 */
export function signOffChecksFromView(
  view: { comments?: QaReportComment[] } | null,
  trustedLogin: string | null,
  head: string,
  commits: () => PrCommit[] | null,
  isOnMain: (sha: string) => boolean | null,
): SignOffChecksRead {
  if (!view || !trustedLogin)
    return { status: 'missing', reason: 'the QA Report could not be read' };
  const latest = latestTrustedQaReport(view.comments, trustedLogin);
  if (!latest)
    return {
      status: 'missing',
      reason: 'there is no QA Report for this Pull Request',
    };
  const header = parseQaReport(latest.body);
  if (!header)
    return {
      status: 'missing',
      reason: 'the QA Report header is missing or not in the fixed form',
    };
  const checks = header.checks.flatMap((c) =>
    c.place === 'local' ? [] : [{ place: c.place, text: c.text }],
  );
  if (checks.length === 0)
    return { status: 'read', checks, reportUrl: '', caveat: null };
  const reportUrl = latest.url ?? '';
  if (!REPORT_URL_RE.test(reportUrl))
    return {
      status: 'missing',
      reason: "the QA Report's link could not be read",
    };
  const caveats: string[] = [];
  if (header.result === 'failed')
    caveats.push('the QA Report copied records a failure');
  if (header.commit !== head) {
    const list = commits();
    const staleness = list
      ? qaStaleness(header.commit, head, list, isOnMain)
      : {
          status: 'unknown' as const,
          reason: "the Pull Request's commits could not be read",
        };
    if (staleness.status === 'stale')
      caveats.push(
        `the QA Report copied is for \`${header.commit.slice(0, 8)}\`, and the branch commit \`${staleness.byCommit.slice(0, 8)}\` came after it`,
      );
    else if (staleness.status === 'unknown')
      caveats.push(
        `it could not be told whether the QA Report copied is current: ${staleness.reason}`,
      );
  }
  return {
    status: 'read',
    checks,
    reportUrl,
    caveat: caveats.length > 0 ? caveats.join('; ') : null,
  };
}

// --------------------------------------------------------------- write

/** What the train's IO gives the Sign-off Issue write. */
export interface SignOffIo {
  /** The merged Pull Request's `staging` and `production` Person Checks, for the head it merged. */
  signOffChecks(pr: number, headRefOid: string): SignOffChecksRead;
  /** A fresh read of which open issue is the Sign-off Issue. */
  findSignOffIssue(): SignOffIssueLookup;
  /**
   * The one write: creates the Sign-off Issue (`number` null), labelled
   * `qa` and titled `SIGNOFF_ISSUE_TITLE`, or replaces the body of `number`.
   * Returns the issue's number, or null when GitHub refused.
   *
   * GitHub's REST API has no conditional update for an issue body, so this
   * replace is blind: a tick the Maintainer makes in the second between the
   * read before it and the write itself is lost. The train narrows that
   * window by reading just before writing, and checks its own lines after,
   * but cannot close it. Two trains creating the issue at once make two;
   * the next write finds both, reports them, and writes to neither. Both
   * are accepted because the train is run by hand, one at a time.
   */
  writeSignOffIssue(number: number | null, body: string): number | null;
}

/** What the Sign-off Issue write left in a train's result. */
export interface SignOffReport {
  /** Merged Pull Requests whose Person Checks were added. */
  signOff: { pr: number; issue: number; created: boolean; added: number }[];
  /** Writes that failed; the merge stands. `unwritten` is the exact lines to paste by hand. */
  signOffFailures: { pr: number; reason: string; unwritten: string[] }[];
  /** Why nothing was copied for a merge, or why what was copied may not describe it. */
  signOffNotes: { pr: number; reason: string }[];
}

/** An empty report, for a result to start from. */
export const emptySignOffReport = (): SignOffReport => ({
  signOff: [],
  signOffFailures: [],
  signOffNotes: [],
});

/** One write, plus the one retry after a read-back that lacks a line. */
const MAX_SIGNOFF_WRITES = 2;

/**
 * Adds a merged Pull Request's `staging` and `production` Person Checks to the Sign-off Issue,
 * creating it when none is open, and records the outcome in `report`. Called
 * only after a merge GitHub accepted. Nothing here can undo or hold that
 * merge: every failure is recorded, with the exact lines that were not
 * written, and the train goes on.
 */
export function recordSignOff(
  pr: number,
  headRefOid: string,
  io: SignOffIo,
  report: SignOffReport,
): void {
  const read = io.signOffChecks(pr, headRefOid);
  if (read.status === 'missing') {
    report.signOffNotes.push({
      pr,
      reason: `no Person Check added to the Sign-off Issue: ${read.reason}`,
    });
    return;
  }
  if (read.checks.length === 0) return;
  if (read.caveat) report.signOffNotes.push({ pr, reason: read.caveat });

  const all: SignOffEntry[] = read.checks.map((c) => ({
    pr,
    ...c,
    reportUrl: read.reportUrl,
  }));
  const fail = (reason: string, entries: readonly SignOffEntry[]) =>
    report.signOffFailures.push({
      pr,
      reason,
      unwritten: entries.map(renderSignOffLine),
    });
  const unsafe = all.filter((e) => unsafeSignOffText(e.text));
  if (unsafe.length > 0)
    fail(
      'a Person Check whose text holds `<!--` or `-->` is not written, since it could forge another line',
      unsafe,
    );
  const entries = all.filter((e) => !unsafeSignOffText(e.text));
  if (entries.length === 0) return;

  let lookup = io.findSignOffIssue();
  if (lookup.status === 'unreadable') {
    fail(lookup.reason, entries);
    return;
  }
  if (lookup.status === 'none') {
    const created = io.writeSignOffIssue(null, renderSignOffIssue(entries));
    if (created !== null) {
      report.signOff.push({
        pr,
        issue: created,
        created: true,
        added: entries.length,
      });
      return;
    }
    // A create GitHub took whose number could not be read still made the
    // issue; read back before asking the Maintainer to paste lines a second
    // time.
    const back = io.findSignOffIssue();
    const held = new Set(
      back.status === 'found'
        ? (parseSignOffIssue(back.body)?.checks ?? []).map((c) =>
            lineKey(c.pr, c.key),
          )
        : [],
    );
    if (
      back.status === 'found' &&
      entries.every((e) => held.has(entryKey(e)))
    ) {
      report.signOff.push({
        pr,
        issue: back.number,
        created: true,
        added: entries.length,
      });
      return;
    }
    fail(
      back.status === 'unreadable'
        ? `the Sign-off Issue may have been created, but could not be read back: ${back.reason}`
        : 'the Sign-off Issue could not be created',
      entries,
    );
    return;
  }

  const issue = lookup.number;
  let added = 0;
  const finish = () => {
    if (added > 0) report.signOff.push({ pr, issue, created: false, added });
  };
  for (let writes = 0; ; writes += 1) {
    const next = addToSignOffIssue(lookup.body, entries);
    if (!next) {
      fail(
        `the Sign-off Issue #${issue} is not in the fixed form, so nothing was written over it`,
        entries,
      );
      return finish();
    }
    if (next.added.length === 0) return finish();
    if (writes >= MAX_SIGNOFF_WRITES) {
      fail(
        `the Sign-off Issue #${issue} did not keep the lines written to it`,
        next.added,
      );
      return finish();
    }
    if (io.writeSignOffIssue(issue, next.body) === null) {
      fail(`the Sign-off Issue #${issue} could not be edited`, next.added);
      return finish();
    }
    // Read back: another writer may have replaced the body in between. A
    // line it dropped is inserted again from the fresh body, once.
    lookup = io.findSignOffIssue();
    if (lookup.status !== 'found' || lookup.number !== issue) {
      fail(
        `the Sign-off Issue #${issue} could not be read back after the write`,
        next.added,
      );
      return finish();
    }
    const present = new Set(
      (parseSignOffIssue(lookup.body)?.checks ?? []).map((c) =>
        lineKey(c.pr, c.key),
      ),
    );
    added += next.added.filter((e) => present.has(entryKey(e))).length;
  }
}

/** The result lines the Sign-off Issue write adds to a train's closing report. */
export function renderSignOffReport(report: SignOffReport): string[] {
  const plural = (n: number) => `${n} Person Check${n === 1 ? '' : 's'}`;
  return [
    ...report.signOff.map(
      ({ pr, issue, created, added }) =>
        `Sign-off Issue #${issue}: added ${plural(added)} from #${pr}${created ? ' (created)' : ''}.`,
    ),
    ...report.signOffNotes.map(
      ({ pr, reason }) => `Note for #${pr}: ${reason}.`,
    ),
    ...report.signOffFailures.flatMap(({ pr, reason, unwritten }) => [
      `Sign-off Issue not written for #${pr} (merged; the merge stands): ${reason}. Add these lines by hand:`,
      ...unwritten,
    ]),
  ];
}

/**
 * Decision logic for the npm audit issue (ADR 0124, issue #977).
 *
 * `Secure Install Review` in `.github/workflows/ci.yml` audits every push to
 * `main` against the live advisory database, so `main` goes red the day an
 * advisory is published against a dependency already in the tree. Report
 * Audit Failure turns that red check into one issue titled
 * `AUDIT_ISSUE_TITLE` and comments on it while the audit keeps failing.
 * Report Audit Success is the other half: the first green push records the
 * recovery on that same issue.
 *
 * What recovery does with the issue is `automation-issue.ts`'s rule, the one
 * every fixed-title automation issue shares, imported rather than restated:
 * no triage state label and the issue is the
 * automation talking to itself, so recovery closes it; any one of them —
 * including `needs-triage`, which a newly created audit issue wears — and it
 * stays open for whoever owns it.
 *
 * Unlike the nightly, this reports per push, and `main` takes several pushes
 * a day. Every report therefore carries a marker naming the state it
 * reported, and `lastReportedState` reads the newest one, so a recovery is
 * recorded once and not again on every green push that follows it.
 *
 * The workflow jobs import this module. A second copy of the title or the
 * label list in YAML would be the drift this file exists to prevent.
 *
 * Run the tests with: node --test tools/scripts/lib/npm-audit-issue.test.ts
 */

import {
  issueStateMarker,
  type ReportedStateInput,
} from './issue-state-marker.ts';
import {
  AUTOMATION_ISSUE_CREATE_LABELS,
  findOpenAutomationIssue,
  recoveryAction,
  recoveryOutcomeSentence,
  type AutomationIssueCandidate,
  type RecoveryAction,
} from './automation-issue.ts';

export { recoveryAction };

export const AUDIT_ISSUE_TITLE = '[automation] npm audit is failing on main';

/**
 * Applied only when Report Audit Failure creates the issue. `needs-triage`
 * is also a state label, so a green push comments instead of closing it.
 */
export const AUDIT_ISSUE_CREATE_LABELS = AUTOMATION_ISSUE_CREATE_LABELS;

/** Rows the failure report prints before it counts the rest. */
export const AUDIT_ADVISORY_LIMIT = 50;

/** Which of the two states a report on the issue recorded. */
export type ReportedState = 'failing' | 'recovered';

// An issue with no report at all — opened by hand under the title — is
// `failing`: it is open and waiting to hear that the audit passed.
const state = issueStateMarker<ReportedState>({
  prefix: 'npm-audit-issue',
  states: ['failing', 'recovered'],
  fallback: 'failing',
});

const marker = state.marker;

/**
 * The open issue this automation owns.
 */
export function findOpenAuditIssue<T extends AutomationIssueCandidate>(
  issues: readonly T[],
): T | undefined {
  return findOpenAutomationIssue(issues, AUDIT_ISSUE_TITLE);
}

/** One advisory `yarn npm audit --json` reported against the tree. */
export interface AuditAdvisory {
  package: string;
  /** Versions of the package in the tree. */
  installed: string[];
  /** The GHSA id, or the registry's numeric id. */
  advisoryId: string;
  url: string;
  severity: string;
  vulnerableRange: string;
  title: string;
}

/**
 * Reads `yarn npm audit --json`: one JSON object per line, each
 * `{ value: <package>, children: { ID, Issue, URL, Severity,
 * "Vulnerable Versions", "Tree Versions" } }`. Anything else on a line —
 * a blank, a Yarn warning, a truncated object — is skipped, not thrown on:
 * the caller is already reporting a failure and must still report it.
 *
 * Yarn reports the vulnerable range and not a patched one, so that is what
 * this carries; the first version outside it is the fix.
 */
export function parseAuditAdvisories(
  ndjson: string | null | undefined,
): AuditAdvisory[] {
  const text = (value: unknown) => (value == null ? '' : String(value));
  const advisories: AuditAdvisory[] = [];

  for (const line of (ndjson ?? '').split(/\r?\n/)) {
    // One audit line is third-party JSON of no declared shape: every field is
    // read through a guard below rather than trusted, so `unknown` is what it
    // honestly is.
    let entry: { value?: unknown; children?: Record<string, unknown> };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    const detail = entry?.children;
    if (typeof entry?.value !== 'string' || !detail || detail.ID == null) {
      continue;
    }

    const url = text(detail.URL);
    const ghsa = url.match(/GHSA(?:-[0-9a-z]{4}){3}/i);
    const versions = detail['Tree Versions'];
    advisories.push({
      package: entry.value as string,
      installed: Array.isArray(versions) ? versions.map(text) : [],
      advisoryId: ghsa ? ghsa[0] : text(detail.ID),
      url,
      severity: text(detail.Severity),
      vulnerableRange: text(detail['Vulnerable Versions']),
      title: text(detail.Issue),
    });
  }

  return advisories.sort(
    (a, b) =>
      a.package.localeCompare(b.package) ||
      a.advisoryId.localeCompare(b.advisoryId),
  );
}

// Advisory text is written by whoever published the advisory. In a table it
// must not end the cell, and as prose it must not open an HTML comment or tag
// or mention anyone. A code span is inert, so a range keeps its `<` and `>`.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const inCell = (value: string) =>
  value.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const cell = (value: string) =>
  inCell(value.replace(/[<>]/g, '').replace(/@/g, `@${ZERO_WIDTH_SPACE}`));
const code = (value: string) =>
  value ? `\`${inCell(value.replace(/`/g, "'"))}\`` : '';
const ADVISORY_URL = /^https:\/\/[^\s()<>]+$/;

/** What a failure report names: the run, when, which commit, and what it found. */
export interface FailureReportInput {
  runUrl: string;
  date: string;
  sha: string;
  advisories: readonly AuditAdvisory[];
}

/**
 * Issue body on creation, comment body afterwards.
 */
export function failureReport({
  runUrl,
  date,
  sha,
  advisories,
}: FailureReportInput): string {
  const shown = advisories.slice(0, AUDIT_ADVISORY_LIMIT);
  const hidden = advisories.length - shown.length;

  const findings =
    shown.length === 0
      ? [
          'The advisories could not be read from the audit output. Read the',
          '`Run Yarn npm audit` step of the run above: it lists them, or shows',
          'that the audit itself could not reach the registry.',
        ]
      : [
          '| Package | Installed | Advisory | Severity | Vulnerable range | Summary |',
          '| --- | --- | --- | --- | --- | --- |',
          ...shown.map((advisory) =>
            [
              '',
              code(advisory.package),
              advisory.installed.map(code).join(', '),
              ADVISORY_URL.test(advisory.url)
                ? `[${cell(advisory.advisoryId)}](${advisory.url})`
                : cell(advisory.advisoryId),
              cell(advisory.severity),
              code(advisory.vulnerableRange),
              cell(advisory.title),
              '',
            ]
              .join(' | ')
              .trim(),
          ),
          ...(hidden > 0 ? ['', `…and ${hidden} more, in the run log.`] : []),
        ];

  return [
    marker('failing'),
    `\`yarn npm audit --all --recursive --severity high\` failed on \`main\` at ${sha} on ${date}.`,
    '',
    `Run: ${runUrl}`,
    '',
    ...findings,
    '',
    'A new advisory against a dependency already in the tree is the expected',
    'way this fails: the audit runs on every push to `main` and only on pull',
    'requests that change dependencies (ADR 0124). Until it passes, every push',
    'to `main` fails at this step and the jobs after it are skipped.',
    '',
    'To clear it, bump each package past its vulnerable range on a branch and',
    'run the `dep-sync` Skill; the pull request is audited because it changes',
    'dependencies. The first green push to `main` records the recovery here.',
  ].join('\n');
}

/**
 * What a recovery comment names: what it does with the issue, the run, when,
 * and which commit was green.
 */
export interface RecoveryCommentInput {
  action: RecoveryAction;
  runUrl: string;
  date: string;
  sha: string;
}

/**
 * Comment body for the first green push after a failure. Both outcomes name
 * the run; only `close` is followed by an issues.update in the workflow.
 */
export function recoveryComment({
  action,
  runUrl,
  date,
  sha,
}: RecoveryCommentInput): string {
  const outcome = recoveryOutcomeSentence(action);
  return [
    marker('recovered'),
    `The npm audit passed on \`main\` at ${sha} on ${date}.`,
    '',
    `Run: ${runUrl}`,
    '',
    outcome,
  ].join('\n');
}

export type { ReportedStateInput };

/**
 * The state the newest report on the issue recorded. The marker's own rules —
 * body first, then comments oldest to newest, anchored to the start of a
 * body — are `issueStateMarker`'s, shared with the PR CI duration watch.
 */
export const lastReportedState = state.lastReportedState;

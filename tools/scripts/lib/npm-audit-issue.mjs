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
 * What recovery does with the issue is the nightly E2E rot issue's rule,
 * imported rather than restated: no triage state label and the issue is the
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
 * Run the tests with: yarn npm-audit:issue:test
 */

import { findOpenRotIssue, recoveryAction } from './nightly-e2e-rot-issue.ts';

export { recoveryAction };

export const AUDIT_ISSUE_TITLE = '[automation] npm audit is failing on main';

/**
 * Applied only when Report Audit Failure creates the issue. `needs-triage`
 * is also a state label, so a green push comments instead of closing it.
 */
export const AUDIT_ISSUE_CREATE_LABELS = ['needs-triage', 'github-actions'];

/** Rows the failure report prints before it counts the rest. */
export const AUDIT_ADVISORY_LIMIT = 50;

// Anchored to the start of a body: every report opens with its marker, and
// advisory text further down a report can never be read as one.
const STATE_MARKER = /^<!-- npm-audit-issue:(failing|recovered) -->/;
const marker = (state) => `<!-- npm-audit-issue:${state} -->`;

/**
 * The open issue this automation owns.
 *
 * @param {Array<{ title?: string, state?: string, pull_request?: unknown }>} issues
 */
export function findOpenAuditIssue(issues) {
  return findOpenRotIssue(issues, AUDIT_ISSUE_TITLE);
}

/**
 * @typedef {object} AuditAdvisory
 * @property {string} package
 * @property {string[]} installed Versions of the package in the tree.
 * @property {string} advisoryId The GHSA id, or the registry's numeric id.
 * @property {string} url
 * @property {string} severity
 * @property {string} vulnerableRange
 * @property {string} title
 */

/**
 * Reads `yarn npm audit --json`: one JSON object per line, each
 * `{ value: <package>, children: { ID, Issue, URL, Severity,
 * "Vulnerable Versions", "Tree Versions" } }`. Anything else on a line —
 * a blank, a Yarn warning, a truncated object — is skipped, not thrown on:
 * the caller is already reporting a failure and must still report it.
 *
 * Yarn reports the vulnerable range and not a patched one, so that is what
 * this carries; the first version outside it is the fix.
 *
 * @param {string | null | undefined} ndjson
 * @returns {AuditAdvisory[]}
 */
export function parseAuditAdvisories(ndjson) {
  const text = (value) => (value == null ? '' : String(value));
  const advisories = [];

  for (const line of (ndjson ?? '').split(/\r?\n/)) {
    let entry;
    try {
      entry = JSON.parse(line);
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
      package: entry.value,
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
const inCell = (value) => value.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const cell = (value) =>
  inCell(value.replace(/[<>]/g, '').replace(/@/g, `@${ZERO_WIDTH_SPACE}`));
const code = (value) =>
  value ? `\`${inCell(value.replace(/`/g, "'"))}\`` : '';
const ADVISORY_URL = /^https:\/\/[^\s()<>]+$/;

/**
 * Issue body on creation, comment body afterwards.
 *
 * @param {{ runUrl: string, date: string, sha: string, advisories: AuditAdvisory[] }} input
 */
export function failureReport({ runUrl, date, sha, advisories }) {
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
 * Comment body for the first green push after a failure. Both outcomes name
 * the run; only `close` is followed by an issues.update in the workflow.
 *
 * @param {{ action: 'close' | 'comment', runUrl: string, date: string, sha: string }} input
 */
export function recoveryComment({ action, runUrl, date, sha }) {
  const outcome =
    action === 'close'
      ? 'This issue had no triage state label, so this recovery closes it.'
      : 'This issue carries a triage state label, so it stays open for the triaged work.';
  return [
    marker('recovered'),
    `The npm audit passed on \`main\` at ${sha} on ${date}.`,
    '',
    `Run: ${runUrl}`,
    '',
    outcome,
  ].join('\n');
}

/**
 * The state the newest report on the issue recorded, reading the body and
 * then the comments in the order the API returns them (oldest first). An
 * issue with no report at all — opened by hand under the title — is
 * `failing`: it is open and waiting to hear that the audit passed.
 *
 * @param {{ body?: string | null, comments?: Array<{ body?: string | null }> | null }} issue
 * @returns {'failing' | 'recovered'}
 */
export function lastReportedState({ body, comments }) {
  const states = [body, ...(comments ?? []).map((comment) => comment?.body)]
    .map((text) => (text ?? '').match(STATE_MARKER)?.[1])
    .filter(Boolean);
  return states.at(-1) ?? 'failing';
}

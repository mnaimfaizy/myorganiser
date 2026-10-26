/**
 * Decision logic for the nightly E2E rot issue (ADR 0050, issue #883).
 *
 * The Report Failure job in `.github/workflows/nightly-e2e.yml` opens one
 * issue titled `ROT_ISSUE_TITLE` and comments on it while the suite stays
 * red. Report Success is the other half: a later green scheduled run has to
 * act on that same issue, or it stays open through every recovery (#858).
 *
 * Triage state is the triage skill's state roles. None of them, and the
 * issue is the automation talking to itself, so recovery closes it. Any one
 * of them, and someone has already put the issue in a queue — including
 * `needs-triage`, which is what a newly created rot issue wears — so
 * recovery comments and leaves the work where it is. Area labels such as
 * `github-actions` are not state and do not keep the issue open.
 *
 * The workflow jobs import this module. A second copy of the label list in
 * YAML would be the drift this file exists to prevent.
 *
 * Run the tests with: yarn nightly-e2e:rot:test
 */

export const ROT_ISSUE_TITLE = '[automation] Nightly E2E suite is failing';

/** Triage skill state roles. Presence of any one keeps the rot issue open. */
export const TRIAGE_STATE_LABELS = [
  'needs-triage',
  'needs-info',
  'ready-for-agent',
  'ready-for-human',
  'wontfix',
];

/**
 * Applied only when Report Failure creates the issue. `needs-triage` is also
 * a state label, so the next green nightly comments instead of closing it.
 */
export const ROT_ISSUE_CREATE_LABELS = ['needs-triage', 'github-actions'];

export type IssueLabel = string | { name?: string };

/**
 * Issue list payloads use `{ name }` label objects. A caller that already
 * mapped them to strings is accepted too.
 */
export function labelNames(
  labels: readonly IssueLabel[] | null | undefined,
): string[] {
  return (labels ?? []).flatMap((label) => {
    if (typeof label === 'string') return [label];
    if (label && typeof label.name === 'string') return [label.name];
    return [];
  });
}

export type RecoveryAction = 'close' | 'comment';

/** What a green scheduled nightly does with the open rot issue. */
export function recoveryAction(
  labels: readonly IssueLabel[] | null | undefined,
): RecoveryAction {
  const names = new Set(labelNames(labels));
  const triaged = TRIAGE_STATE_LABELS.some((name) => names.has(name));
  return triaged ? 'comment' : 'close';
}

export interface RotIssueCandidate {
  title?: string;
  state?: string;
  pull_request?: unknown;
  [key: string]: unknown;
}

/**
 * The open issue this automation owns. Pull requests are issues in the
 * list API, and a PR that happens to share the title is not the rot report.
 */
export function findOpenRotIssue<T extends RotIssueCandidate>(
  issues: readonly T[],
  title: string = ROT_ISSUE_TITLE,
): T | undefined {
  return issues.find(
    (issue) =>
      issue.state !== 'closed' && !issue.pull_request && issue.title === title,
  );
}

export interface RecoveryCommentInput {
  action: RecoveryAction;
  runUrl: string;
  date: string;
}

/**
 * Comment body for a green run. Both outcomes name the run; only `close`
 * is followed by an issues.update in the workflow.
 */
export function recoveryComment({
  action,
  runUrl,
  date,
}: RecoveryCommentInput): string {
  const outcome =
    action === 'close'
      ? 'This issue had no triage state label, so this recovery closes it.'
      : 'This issue carries a triage state label, so it stays open for the triaged work.';
  return [
    `The nightly Playwright run succeeded on ${date}.`,
    '',
    `Run: ${runUrl}`,
    '',
    outcome,
  ].join('\n');
}

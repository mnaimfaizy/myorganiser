/**
 * What every Automation Issue shares (`CONTEXT.md`): the rules common to each
 * automation that reports on its own fixed-title issue.
 *
 * Three of them do: the nightly E2E rot issue (ADR 0050), the npm audit
 * issue (ADR 0124), and the PR CI duration watch (PRD #1387). Each opens one
 * issue under a title it owns, comments on it while the thing it watches
 * stays broken, and records the recovery once when it comes back. The titles
 * and the report bodies differ, and they belong to each automation. What
 * does not differ is this module: which labels a newly created issue wears,
 * which labels mean a person has taken the issue over, what a recovery
 * therefore does with it, and how that decision is explained to a reader.
 *
 * It lives here rather than in any one automation's module because a rule
 * three callers read is not the nightly suite's rule, or the audit's. It was
 * the nightly module until this file existed, which meant that file changed
 * both when the nightly report changed and when any other watch needed
 * something — and left the create-label list copied three times, once per
 * automation, each copy carrying the same reasoning in its own comment.
 *
 * Each automation still names its own issue and writes its own bodies. The
 * only thing it takes from here is the part that must be the same in all
 * three, so that "a triaged issue stays open" is one fact rather than three
 * that agree for now.
 *
 * The workflow jobs reach these through their automation's module. A second
 * copy of the label list in YAML would be the drift this file exists to
 * prevent.
 *
 * This module has no suite of its own, because each rule here is read
 * through the automation that depends on it, and that is where a break would
 * be felt: all three suites below exercise `recoveryAction`, the triage
 * labels, the create labels and the recovery sentence against their own
 * automation's issue. They passed unmodified when this file was extracted,
 * which is what said the extraction changed no behaviour.
 *
 * Run the tests with: node --test tools/scripts/lib/nightly-e2e-rot-issue.test.ts
 *                     node --test tools/scripts/lib/npm-audit-issue.test.ts
 *                     node --test tools/scripts/lib/ci-duration-watch-issue.test.ts
 */

/**
 * The labels an automation applies when it *creates* its issue.
 *
 * `needs-triage` is also a triage state label, which is what makes a
 * recovery comment on a freshly created issue rather than close it: the
 * issue is in somebody's queue from the moment it opens. `github-actions` is
 * an area label and has no bearing on that.
 */
export const AUTOMATION_ISSUE_CREATE_LABELS = [
  'needs-triage',
  'github-actions',
];

/** Triage skill state roles. Presence of any one keeps the issue open. */
export const TRIAGE_STATE_LABELS = [
  'needs-triage',
  'needs-info',
  'ready-for-agent',
  'ready-for-human',
  'wontfix',
];

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

/**
 * What a run that finds the watched thing healthy does with the open issue.
 *
 * No triage state label and the issue is the automation talking to itself,
 * so the recovery closes it. Any one of them and someone has already put the
 * issue in a queue — including the `needs-triage` a newly created issue
 * wears — so the recovery comments and leaves the work where it is. Area
 * labels such as `github-actions` are not state and do not keep it open.
 */
export function recoveryAction(
  labels: readonly IssueLabel[] | null | undefined,
): RecoveryAction {
  const names = new Set(labelNames(labels));
  const triaged = TRIAGE_STATE_LABELS.some((name) => names.has(name));
  return triaged ? 'comment' : 'close';
}

export interface AutomationIssueCandidate {
  title?: string;
  state?: string;
  pull_request?: unknown;
  [key: string]: unknown;
}

/**
 * The open issue an automation owns, by its fixed title. Pull requests are
 * issues in the list API, and a pull request that happens to share the title
 * is not the automation's report.
 */
export function findOpenAutomationIssue<T extends AutomationIssueCandidate>(
  issues: readonly T[],
  title: string,
): T | undefined {
  return issues.find(
    (issue) =>
      issue.state !== 'closed' && !issue.pull_request && issue.title === title,
  );
}

/**
 * The sentence a recovery report ends on, explaining what it did with the
 * issue. One sentence because `recoveryAction` is one rule: an automation
 * that worded its own outcome would eventually word it differently from the
 * decision it describes.
 */
export function recoveryOutcomeSentence(action: RecoveryAction): string {
  return action === 'close'
    ? 'This issue had no triage state label, so this recovery closes it.'
    : 'This issue carries a triage state label, so it stays open for the triaged work.';
}

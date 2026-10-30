/**
 * Decision logic for the nightly E2E rot issue (ADR 0050, issue #883).
 *
 * The Report Failure job in `.github/workflows/nightly-e2e.yml` opens one
 * issue titled `ROT_ISSUE_TITLE` and comments on it while the suite stays
 * red. Report Success is the other half: a later green scheduled run has to
 * act on that same issue, or it stays open through every recovery (#858).
 *
 * What this module holds is the nightly half: its title, the labels its own
 * issue is created with, and the comment a green run leaves. The rules it
 * shares with every other automation reporting on a fixed-title issue — the
 * triage state labels, what a recovery does about them, and the sentence
 * explaining that outcome — are `automation-issue.ts`, because three
 * automations read them and a rule three callers read is not this file's.
 *
 * The shared names are re-exported here on purpose: the workflow jobs import
 * them from this path by file URL, and the nightly's own vocabulary
 * (`findOpenRotIssue`) is what that YAML and this module's suite ask for. A
 * second copy of the label list in YAML would be the drift this file exists
 * to prevent.
 *
 * Run the tests with: node --test tools/scripts/lib/nightly-e2e-rot-issue.test.ts
 */

import {
  AUTOMATION_ISSUE_CREATE_LABELS,
  findOpenAutomationIssue,
  recoveryOutcomeSentence,
  type AutomationIssueCandidate,
  type RecoveryAction,
} from './automation-issue.ts';

export {
  labelNames,
  recoveryAction,
  recoveryOutcomeSentence,
  TRIAGE_STATE_LABELS,
  type IssueLabel,
  type RecoveryAction,
} from './automation-issue.ts';

export const ROT_ISSUE_TITLE = '[automation] Nightly E2E suite is failing';

/**
 * Applied only when Report Failure creates the issue. `needs-triage` is also
 * a state label, so the next green nightly comments instead of closing it.
 */
export const ROT_ISSUE_CREATE_LABELS = AUTOMATION_ISSUE_CREATE_LABELS;

/**
 * The candidate shape an issue listing hands this module. Named for the rot
 * issue because that is what the nightly's callers are looking for; it is
 * the shared `AutomationIssueCandidate`.
 */
export type RotIssueCandidate = AutomationIssueCandidate;

/**
 * The open issue this automation owns. Pull requests are issues in the
 * list API, and a PR that happens to share the title is not the rot report.
 */
export function findOpenRotIssue<T extends RotIssueCandidate>(
  issues: readonly T[],
  title: string = ROT_ISSUE_TITLE,
): T | undefined {
  return findOpenAutomationIssue(issues, title);
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
  const outcome = recoveryOutcomeSentence(action);
  return [
    `The nightly Playwright run succeeded on ${date}.`,
    '',
    `Run: ${runUrl}`,
    '',
    outcome,
  ].join('\n');
}

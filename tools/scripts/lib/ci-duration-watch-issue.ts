/**
 * Decision logic for the PR CI duration watch issue (PRD #1387, issue
 * #1393).
 *
 * `.github/workflows/pr-ci-duration-watch.yml` runs
 * `yarn ci:duration:measure` on `main` once a week and reports through one
 * fixed-title issue, `WATCH_ISSUE_TITLE`. The shape is the nightly E2E rot
 * issue's (ADR 0050) with the npm audit issue's state marker (ADR 0124):
 * comment on the open issue while the target keeps slipping, create one when
 * there is none, and record the recovery once when the window comes back
 * clean.
 *
 * The marker is what makes "once" true. The watch runs weekly, so without it
 * every quiet week would comment again on an issue somebody is still working
 * through. `lastReportedState` reads the newest marker on the issue — body
 * first, then comments oldest to newest — and the recovery is written only
 * when that marker says the last thing reported was a breach.
 *
 * What recovery *does* with the issue is not restated here either: it is
 * `recoveryAction` from `automation-issue.ts`, the rule every fixed-title
 * automation issue shares. No triage state label and the
 * issue is the automation talking to itself, so recovery closes it; any one
 * of them — including the `needs-triage` a newly created watch issue wears —
 * and it stays open for whoever owns the work.
 *
 * **A window with too little data reports nothing.** `watchAction` returns
 * `none` for `not-enough-data`, so a quiet week neither opens an issue nor
 * records a recovery; the measurement still prints to the run's step summary,
 * which is where "not enough data" is said out loud.
 *
 * The workflow imports this module. A second copy of the title or the label
 * list in YAML would be the drift this file exists to prevent.
 *
 * Run the tests with: node --test tools/scripts/lib/ci-duration-watch-issue.test.ts
 */

import {
  notEnoughDataSentence,
  renderCiDurationMeasurement,
  signalLine,
  targetSentence,
  type CiDurationSummary,
} from './ci-duration.ts';
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

export const WATCH_ISSUE_TITLE =
  '[automation] PR CI is over its five-minute target';

/**
 * Applied only when the watch creates the issue. `needs-triage` is also a
 * state label, so a recovery comments instead of closing it.
 */
export const WATCH_ISSUE_CREATE_LABELS = AUTOMATION_ISSUE_CREATE_LABELS;

/** Which of the two states a report on the issue recorded. */
export type ReportedState = 'breached' | 'recovered';

// An issue with no report at all — opened by hand under the title — is
// `breached`: it is open and waiting to hear that the target is met.
const state = issueStateMarker<ReportedState>({
  prefix: 'pr-ci-duration-watch',
  states: ['breached', 'recovered'],
  fallback: 'breached',
});

const marker = state.marker;

/** The open issue this automation owns. */
export function findOpenWatchIssue<T extends AutomationIssueCandidate>(
  issues: readonly T[],
): T | undefined {
  return findOpenAutomationIssue(issues, WATCH_ISSUE_TITLE);
}

/** What one weekly run does about the issue. */
export type WatchAction = 'report' | 'recover' | 'none';

/**
 * Whether this week's measurement is something to report, a recovery to
 * record, or neither.
 *
 * `none` is the sparse week: fewer than `MIN_SINGLE_LIBRARY_RUNS` Single
 * Library runs in the window measured nothing, so it is neither evidence of
 * a breach nor evidence of a recovery, and touching the issue on it would
 * make the issue's history a record of how busy the repository was.
 */
export function watchAction(summary: CiDurationSummary): WatchAction {
  if (summary.verdict === 'not-enough-data') return 'none';
  return summary.verdict === 'over-target' ? 'report' : 'recover';
}

/**
 * The opening every report shares: its state marker, what happened, the run,
 * and the Single-Library figure against the target. Written once, because
 * the breach and the recovery differ in their headline and in nothing else.
 */
function reportHead({
  state: reported,
  headline,
  summary,
  runUrl,
}: {
  state: ReportedState;
  headline: string;
  summary: CiDurationSummary;
  runUrl: string;
}): string[] {
  return [
    marker(reported),
    headline,
    '',
    `Run: ${runUrl}`,
    '',
    targetSentence(summary),
  ];
}

/** The measurement every report ends on, rendered exactly as the CLI prints it. */
const measurementTail = (summary: CiDurationSummary): string[] => [
  '',
  '## Measurement',
  '',
  renderCiDurationMeasurement(summary).trimEnd(),
];

/** What a report names: the run, when, and the measurement behind it. */
export interface WatchReportInput {
  summary: CiDurationSummary;
  runUrl: string;
  date: string;
}

/**
 * Issue body on creation, comment body afterwards.
 *
 * The signal list comes first, because the one thing a reader needs is which
 * decision to reopen; the full measurement follows it verbatim, so the issue
 * and a local `yarn ci:duration:measure` say the same thing.
 */
export function breachReport({
  summary,
  runUrl,
  date,
}: WatchReportInput): string {
  const signals = summary.signals.map(signalLine);

  return [
    ...reportHead({
      state: 'breached',
      headline:
        `The weekly PR CI duration watch tripped ${summary.signals.length} signal(s) on ${date}, ` +
        `over ${summary.window.since} → ${summary.window.until}.`,
      summary,
      runUrl,
    }),
    '',
    '## Signals that tripped',
    '',
    ...(signals.length > 0
      ? signals
      : [
          'No signal is listed, which should not happen on a breach report —',
          'read the measurement below and the run log.',
        ]),
    '',
    'A signal names the decision whose reasoning is now in doubt, not a fix.',
    'Reopen that issue and start from what it recorded; the five-minute target',
    'and the decisions behind it are PRD #1387.',
    '',
    'Reproduce this locally with `yarn ci:duration:measure --days 14`.',
    ...measurementTail(summary),
  ].join('\n');
}

/** What a recovery comment names, beside what it does with the issue. */
export interface WatchRecoveryInput extends WatchReportInput {
  action: RecoveryAction;
}

/**
 * Comment body for the first clean window after a breach. Both outcomes name
 * the run; only `close` is followed by an issues.update in the workflow.
 */
export function recoveryComment({
  action,
  summary,
  runUrl,
  date,
}: WatchRecoveryInput): string {
  return [
    ...reportHead({
      state: 'recovered',
      headline:
        `The weekly PR CI duration watch found no tripped signal on ${date}, ` +
        `over ${summary.window.since} → ${summary.window.until}.`,
      summary,
      runUrl,
    }),
    '',
    recoveryOutcomeSentence(action),
    ...measurementTail(summary),
  ].join('\n');
}

/**
 * The state the newest report on the issue recorded. The marker's own rules —
 * body first, then comments oldest to newest, anchored to the start of a
 * body — are `issueStateMarker`'s, shared with the npm audit issue.
 */
export type { ReportedStateInput };

export const lastReportedState = state.lastReportedState;

/**
 * The line a sparse window writes to the run's step summary instead of to
 * the issue.
 */
export function notEnoughDataNote(summary: CiDurationSummary): string {
  return `${notEnoughDataSentence(summary)} The issue was not touched.`;
}

/**
 * What the CI review workflow posts, decided as pure functions so the
 * contract tests never touch GitHub (ADR 0071 item 8: a script posts, the
 * reviewer never holds a token). `publish-review-report.ts` is the only
 * file that calls `gh`.
 *
 * The publisher behaves like a human reviewer would, not like a dashboard:
 *
 *   1. Every run posts a new summary comment. The previous run's summary is
 *      never deleted or rewritten; it is marked outdated (GitHub's
 *      "minimize" with classifier OUTDATED), so the history of what the
 *      reviewer said about each head stays readable in the thread.
 *   2. Inline comments go on blocking findings that carry a location, once
 *      per finding id while a thread for that id is still open. A finding
 *      that disappears from the report resolves its thread; a finding that
 *      comes back after being resolved gets a fresh comment. Both readings
 *      are scoped to the report schema version that minted the id, so a
 *      change to how ids are derived orphans old threads rather than
 *      resolving them (issue #718).
 *   3. The label. ADR 0070 item 1: a blocking finding relabels an `auto` or
 *      `agent` Pull Request to `review:human`; no spec source does the same
 *      (`effectiveTier`). The label never loosens here — only the classifier
 *      lowers a tier, and only on a fresh run.
 */

import type { RelabelPlan } from '../lib/review-tier.ts';
import { planRelabel } from '../lib/review-tier.ts';

import { evidenceText } from './evidence.ts';
import type { NormalizedFinding, ReviewTierLabel, Verdict } from './schema.ts';
import {
  AXIS_TITLES,
  REPORT_SCHEMA_VERSION,
  VERDICT_VALUES,
} from './schema.ts';

export { planRelabel };

/** One inline comment, as the poster will create it. */
export interface InlineComment {
  id: string;
  path: string;
  line: number;
  startLine: number | undefined;
  body: string;
}

/** A review thread the publisher may resolve or reply to. */
export interface OpenThread {
  id: string;
  body: string;
}

/** An existing issue comment, as the publisher reads it. */
export interface ExistingComment {
  nodeId: string;
  body?: string;
  minimized?: boolean;
}

/**
 * What a plan reads of a normalized report: the verdict it publishes, the
 * tier it labels from, and the findings it comments on. Narrower than
 * `NormalizedReport` because nothing else of a report reaches a comment, and
 * the publisher is handed a report read back off disk.
 */
export interface PublishableReport {
  verdict: Verdict;
  effectiveTier: ReviewTierLabel | null;
  findings: readonly NormalizedFinding[];
}

/** Everything the poster will do, in one object. */
export interface PublicationPlan {
  outcome: 'rejected' | 'published';
  verdict: Verdict | null;
  summary: string;
  outdate: string[];
  inline: InlineComment[];
  resolve: string[];
  relabel: RelabelPlan | null;
  failCheck: boolean;
}

export const SUMMARY_MARKER = '<!-- code-review-report -->';
/**
 * The heading a summary carries when the reviewer produced nothing usable.
 * Named rather than inlined for the same reason `verdictHeading` is: the
 * escaped-defect measurement reads this line back out of a merged Pull
 * Request's comments to tell a review that produced no verdict from one that
 * passed, and those two must never be the same guess.
 */
export const NO_VERDICT_HEADING = '## Code review — no verdict';
/**
 * A thread marker carries the report schema version that minted the id inside
 * it, because an id only means anything within a version (issue #718). A
 * thread from an earlier version reads as somebody else's here: this run does
 * not recognise its id, so it neither reuses nor resolves it. Without the
 * version, the run that changed how ids are derived would resolve every open
 * thread on every Pull Request at once — the mass auto-resolve the bump exists
 * to prevent, arriving through the publisher instead of the strip.
 */
export const findingMarker = (id: string): string =>
  `<!-- code-review:finding:v${REPORT_SCHEMA_VERSION}:${id} -->`;
/** Marks the one reply a thread gets when its finding is gone but the token cannot resolve it. */
export const STALE_MARKER = '<!-- code-review:stale -->';
const FINDING_MARKER_RE = new RegExp(
  `<!-- code-review:finding:v${REPORT_SCHEMA_VERSION}:([0-9a-f]+) -->`,
  'g',
);

/**
 * The finding ids this run can act on: those minted at this schema version.
 * A marker from another version yields nothing, which is what leaves its
 * thread alone.
 */
export const findingIdsIn = (body: string | null | undefined): string[] =>
  [...(body ?? '').matchAll(FINDING_MARKER_RE)].map((m) => m[1]);

/**
 * The label the Pull Request should wear after this run. A blocking
 * verdict is human regardless of tier; otherwise the validator's
 * effective tier (which is the job's tier, or human when no spec was
 * found). `null` when the run carried no tier at all.
 */
export const targetTierLabel = ({
  tier,
  effectiveTier,
  verdict,
}: {
  tier?: ReviewTierLabel | null;
  effectiveTier?: ReviewTierLabel | null;
  verdict?: Verdict;
}): ReviewTierLabel | null => {
  if (verdict !== undefined && !VERDICT_VALUES.includes(verdict))
    throw new Error(`unknown verdict ${verdict}`);
  if (verdict === 'request-changes') return 'review:human';
  return effectiveTier ?? tier ?? null;
};

const header = ({
  headSha,
  runUrl,
}: {
  headSha: string;
  runUrl: string;
}): string =>
  [
    SUMMARY_MARKER,
    `<sub>Automated code review of \`${headSha.slice(0, 7)}\` · [run](${runUrl}) · findings are JSON validated by \`tools/scripts/review/schema.ts\`; the verdict below is computed, never written (ADR 0071).</sub>`,
    '',
  ].join('\n');

/** The summary comment for a validated report. */
export const summaryBody = ({
  rendered,
  headSha,
  runUrl,
}: {
  rendered: string;
  headSha: string;
  runUrl: string;
}): string => `${header({ headSha, runUrl })}${rendered.trimEnd()}\n`;

/**
 * The summary comment when the reviewer produced nothing usable. The Pull
 * Request goes to a human (ADR 0070 item 5); the reason is the validator's
 * output or the workflow's, never a guess.
 */
export const rejectedBody = ({
  reason,
  headSha,
  runUrl,
}: {
  reason: string;
  headSha: string;
  runUrl: string;
}): string =>
  [
    header({ headSha, runUrl }),
    NO_VERDICT_HEADING,
    '',
    'The reviewer did not produce a report that meets the finding contract, so there is no verdict and this Pull Request is `review:human`. Nothing was downgraded to make it pass.',
    '',
    '```text',
    reason.trim().slice(0, 4000),
    '```',
    '',
  ].join('\n');

/**
 * Inline comments for blocking findings with a location, skipping any id
 * that still has an open thread.
 *
 */
export const inlineComments = ({
  findings,
  openThreadBodies = [],
}: {
  findings: readonly NormalizedFinding[];
  openThreadBodies?: readonly string[];
}): InlineComment[] => {
  const open = new Set(openThreadBodies.flatMap(findingIdsIn));
  return findings
    .filter((f) => f.severity === 'blocking' && f.location && !open.has(f.id))
    .map((f) => ({
      id: f.id,
      path: f.location!.file,
      line: f.location!.endLine ?? f.location!.startLine,
      startLine:
        f.location!.endLine && f.location!.endLine !== f.location!.startLine
          ? f.location!.startLine
          : undefined,
      body: [
        findingMarker(f.id),
        `**Blocking · ${AXIS_TITLES[f.axis]}** — ${f.summary}`,
        '',
        `Rule: \`${f.ruleId}\` — ${f.rule} (${f.source})`,
        `Evidence: ${evidenceText(f)}`,
        ...(f.remedy ? ['', `Suggested: ${f.remedy}`] : []),
      ].join('\n'),
    }));
};

/**
 * Open threads whose finding is no longer reported. A thread with no finding
 * marker this run recognises is a human's — or an earlier schema version's,
 * which amounts to the same thing here — and is never touched.
 *
 */
export const threadsToResolve = ({
  findings,
  openThreads,
}: {
  findings: readonly { id: string }[];
  openThreads: readonly OpenThread[];
}): string[] => {
  const current = new Set(findings.map((f) => f.id));
  return openThreads
    .filter((t) => {
      const ids = findingIdsIn(t.body);
      return ids.length > 0 && ids.every((id) => !current.has(id));
    })
    .map((t) => t.id);
};

/**
 * Previous summary comments to mark outdated: every unminimized comment
 * carrying the summary marker. Nothing is deleted.
 *
 */
export const summariesToOutdate = (
  comments: readonly ExistingComment[],
): string[] =>
  comments
    .filter((c) => (c.body ?? '').includes(SUMMARY_MARKER) && !c.minimized)
    .map((c) => c.nodeId);

/**
 * Everything the poster will do, in one object, so a test can read it and
 * the CLI can only execute it.
 */
export const planPublication = ({
  normalized,
  rendered,
  rejectedReason,
  tier,
  headSha,
  runUrl,
  currentLabels,
  existingComments = [],
  openThreads = [],
}: {
  normalized?: PublishableReport;
  rendered?: string;
  rejectedReason?: string;
  tier?: ReviewTierLabel | null;
  headSha: string;
  runUrl: string;
  currentLabels: readonly string[];
  existingComments?: readonly ExistingComment[];
  openThreads?: readonly OpenThread[];
}): PublicationPlan => {
  const outdate = summariesToOutdate(existingComments);
  if (rejectedReason !== undefined) {
    return {
      outcome: 'rejected',
      verdict: null,
      summary: rejectedBody({ reason: rejectedReason, headSha, runUrl }),
      outdate,
      inline: [],
      // Nothing is known about the findings, so no thread is resolved.
      resolve: [],
      relabel: planRelabel(currentLabels, tier ? 'review:human' : null),
      failCheck: true,
    };
  }
  // Neither is optional on this path: a run with no rejection reason has a
  // validated report and the Markdown rendered from it.
  const report = normalized!;
  const target = targetTierLabel({
    tier,
    effectiveTier: report.effectiveTier,
    verdict: report.verdict,
  });
  return {
    outcome: 'published',
    verdict: report.verdict,
    summary: summaryBody({ rendered: rendered!, headSha, runUrl }),
    outdate,
    inline: inlineComments({
      findings: report.findings,
      openThreadBodies: openThreads.map((t) => t.body),
    }),
    resolve: threadsToResolve({ findings: report.findings, openThreads }),
    relabel: planRelabel(currentLabels, target),
    failCheck: report.verdict === 'request-changes',
  };
};

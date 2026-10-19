import { PrismaClient, createPrismaClient } from '../prisma';
import {
  FEEDBACK_RELEASE_TAG_REFUSAL_MESSAGE,
  FEEDBACK_REPORT_KIND_RULES,
  FeedbackReportStatus,
  TRACKING_ISSUE_LINKED_STATUS,
  parseReleaseTag,
} from './feedbackReportConstants';
import feedbackFixNoticeService, {
  FixNoticeOutcome,
} from './FeedbackFixNoticeService';

/** The most Tracking Issues one Release-marking call names (ADR 0133). */
const MAX_ISSUE_NUMBERS = 500;

/** Counts returned to the Production deploy once a Release has been marked. */
export interface FeedbackReleaseMarkCounts {
  reportsMarked: number;
  fixNoticesSent: number;
  fixNoticesSkipped: number;
  fixNoticesFailed: number;
}

/** The counter a Fix Notice outcome adds one to in the response. */
type FixNoticeTallyKey = Exclude<
  keyof FeedbackReleaseMarkCounts,
  'reportsMarked'
>;

/** Each Fix Notice outcome falls into one of three tallies the response reports. */
const FIX_NOTICE_TALLY = {
  sent: 'fixNoticesSent',
  skipped_not_opted_in: 'fixNoticesSkipped',
  skipped_reporter_deleted: 'fixNoticesSkipped',
  skipped_already_sent: 'fixNoticesSkipped',
  failed: 'fixNoticesFailed',
} as const satisfies Record<FixNoticeOutcome, FixNoticeTallyKey>;

export interface MarkReleaseInput {
  releaseTag: unknown;
  issueNumbers: unknown;
}

/**
 * Service result for Release-marking. The backend tsconfig does not enable
 * strictNullChecks, so `result.ok === false` tests are used to narrow it.
 */
type FeedbackReleaseServiceResult =
  | { ok: true; status: 200; body: FeedbackReleaseMarkCounts }
  | { ok: false; status: 400; body: { message: string } };

function refuse(message: string): FeedbackReleaseServiceResult {
  return { ok: false, status: 400, body: { message } };
}

/**
 * Parses the issue list the deploy sends: an array of at most 500 positive
 * integers, deduplicated. Returns null when the input is not acceptable.
 */
function parseIssueNumbers(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_ISSUE_NUMBERS) return null;
  const unique = new Set<number>();
  for (const item of value) {
    if (!Number.isInteger(item) || item <= 0) return null;
    unique.add(item);
  }
  return [...unique];
}

/**
 * Marks every Planned Feedback Report on a Release's Tracking Issues as Fixed
 * (Bug Report) or Shipped (Suggestion), then sends each newly marked report its
 * Fix Notice (ADR 0133, issue #1214).
 *
 * The status change is guarded on `status: planned`, so a report another run
 * already moved is neither counted nor notified. A Fix Notice failure never
 * rolls back the status change: `sendFixNoticeForReport` does not throw.
 */
export class FeedbackReleaseService {
  constructor(private readonly prisma: PrismaClient = createPrismaClient()) {}

  async markRelease(
    input: MarkReleaseInput,
  ): Promise<FeedbackReleaseServiceResult> {
    const releaseTag = parseReleaseTag(input.releaseTag);
    if (releaseTag === null) {
      return refuse(FEEDBACK_RELEASE_TAG_REFUSAL_MESSAGE);
    }

    const issueNumbers = parseIssueNumbers(input.issueNumbers);
    if (issueNumbers === null) {
      return refuse(
        'Name up to 500 Tracking Issue numbers as positive whole numbers.',
      );
    }

    const zeroCounts: FeedbackReleaseMarkCounts = {
      reportsMarked: 0,
      fixNoticesSent: 0,
      fixNoticesSkipped: 0,
      fixNoticesFailed: 0,
    };
    if (issueNumbers.length === 0) {
      return { ok: true, status: 200, body: zeroCounts };
    }

    const reports = await this.prisma.feedbackReport.findMany({
      where: {
        tracking_issue_number: { in: issueNumbers },
        status: TRACKING_ISSUE_LINKED_STATUS,
      },
      select: { id: true, kind: true },
    });

    const body = { ...zeroCounts };

    for (const report of reports) {
      const status: FeedbackReportStatus =
        FEEDBACK_REPORT_KIND_RULES[report.kind].deliveredStatus;

      const { count } = await this.prisma.feedbackReport.updateMany({
        where: { id: report.id, status: TRACKING_ISSUE_LINKED_STATUS },
        data: {
          status,
          release_tag: releaseTag,
          status_changed_at: new Date(),
        },
      });
      if (count !== 1) continue;

      body.reportsMarked += 1;
      const outcome = await feedbackFixNoticeService.sendFixNoticeForReport(
        report.id,
      );
      body[FIX_NOTICE_TALLY[outcome]] += 1;
    }

    return { ok: true, status: 200, body };
  }
}

const feedbackReleaseService = new FeedbackReleaseService();
export default feedbackReleaseService;

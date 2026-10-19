import { PrismaClient, createPrismaClient } from '../prisma';
import {
  FEEDBACK_REPORT_TEXT_MAX_LENGTH,
  FEEDBACK_REPORT_STATUS_RULES,
  FEEDBACK_REPORT_STATUSES,
  FEEDBACK_REPORT_KIND_RULES,
  FEEDBACK_RELEASE_TAG_REFUSAL_MESSAGE,
  TRACKING_ISSUE_LINKED_STATUS,
  REOPENED_STATUS,
  isFeedbackReportStatus,
  parseReleaseTag,
  isFeedbackReportKind,
  FeedbackReportStatus,
  FeedbackReportKind,
  FeedbackReportStatusRule,
} from './feedbackReportConstants';
import { AdminAuditAction } from '../types';
import type { Prisma } from '@prisma/client';
import feedbackFixNoticeService from './FeedbackFixNoticeService';

/**
 * Admin Feedback Report list item: header view without description.
 */
export interface AdminFeedbackReportListItemDto {
  id: string;
  kind: FeedbackReportKind;
  status: FeedbackReportStatus;
  title: string;
  /** Report Context platform, the inbox filters on it. */
  platform: string;
  trackingIssueNumber: number | null;
  /** Null once the sender has been removed by User Deletion. */
  reporterUserId: string | null;
  /** Sender identity for the inbox. Null once the sender has been removed by User Deletion. */
  reporter: AdminFeedbackReporterDto | null;
  statusChangedAt: string | null;
  createdAt: string;
}

/**
 * Admin Feedback Reporter identity.
 */
export interface AdminFeedbackReporterDto {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Admin Feedback Report Context details.
 */
export interface AdminFeedbackReportContextDto {
  platform: string;
  appVersion: string;
  browser: string;
  operatingSystem: string;
  path: string;
  sentAt: string;
}

/**
 * Admin Feedback Report detail: full report with all fields and reporter info.
 */
export interface AdminFeedbackReportDetailDto extends AdminFeedbackReportListItemDto {
  description: string;
  expectedOutcome: string | null;
  context: AdminFeedbackReportContextDto;
  followUp: string | null;
  statusNote: string | null;
  releaseTag: string | null;
  fixNoticeOptIn: boolean;
  /** Null means the sender was removed by User Deletion — every report is sent by a signed-in User. */
  reporter: AdminFeedbackReporterDto | null;
}

/**
 * Service result for admin feedback operations. The backend tsconfig does not
 * enable strictNullChecks, so `result.ok === false` tests are used instead of
 * falsy checks to properly narrow the discriminated union.
 */
type AdminServiceResult<T> =
  | { ok: true; status: 200; body: T }
  | { ok: false; status: 400 | 404; body: { message: string } };

/**
 * Input for filtering admin feedback reports. All fields are optional.
 */
interface AdminFeedbackReportFilters {
  status?: unknown;
  kind?: unknown;
  platform?: unknown;
  trackingIssueNumber?: unknown;
  limit?: unknown;
}

/**
 * Input for changing a report's status.
 */
interface ChangeStatusInput {
  status: unknown;
  statusNote?: unknown;
}

/**
 * Input for linking a tracking issue.
 */
interface LinkTrackingIssueInput {
  trackingIssueNumber: unknown;
}

/**
 * Input for marking a report delivered.
 */
interface MarkDeliveredInput {
  releaseTag: unknown;
}

/**
 * Input for reopening a wrongly delivered report.
 */
interface ReopenReportInput {
  statusNote?: unknown;
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read a Status Note from admin input. Required notes refuse when blank; every
 * note refuses when over the text cap. Shared by changeStatus and reopenReport.
 */
function parseStatusNote(
  raw: unknown,
  required: boolean,
): AdminServiceResult<{ note: string }> {
  const note = trimString(raw);

  if (required && !note) {
    return {
      ok: false,
      status: 400,
      body: { message: 'Write a status note explaining why.' },
    };
  }

  if (note.length > FEEDBACK_REPORT_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      status: 400,
      body: {
        message: `The status note must be ${FEEDBACK_REPORT_TEXT_MAX_LENGTH.toLocaleString('en-US')} characters or fewer.`,
      },
    };
  }

  return { ok: true, status: 200, body: { note } };
}

/**
 * The reader's word for a Report Status, taken from the pinned table rather
 * than spelled out again here (ADR 0053). Every refusal below names a status
 * through this, so the copy and the rules cannot drift apart.
 */
/**
 * Prisma include object for fetching a report with its reporter's identity.
 * Used across five methods; extracting it ensures the projection never drifts.
 */
const REPORT_WITH_REPORTER = {
  reporter: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
};

function statusLabel(status: FeedbackReportStatus): string {
  return FEEDBACK_REPORT_STATUS_RULES[status].label;
}

/**
 * Fixed and Shipped are final (PRD #1206): once a Release has delivered a
 * report, no triage action moves it again; only reopenReport does. Returns the
 * refusal, or null when the report is still open.
 */
function refuseWhenFinal(report: {
  status: FeedbackReportStatus;
}): { ok: false; status: 400; body: { message: string } } | null {
  if (!FEEDBACK_REPORT_STATUS_RULES[report.status].isFinal) return null;
  return {
    ok: false,
    status: 400,
    body: {
      message: `That report is already ${statusLabel(report.status)} and cannot change.`,
    },
  };
}

/**
 * Map a reporter row from REPORT_WITH_REPORTER to the reporter DTO. Shared by
 * the list and detail mappers so both endpoints expose the same identity.
 */
function toReporterDto(
  reporter: { id: string; name: string | null; email: string } | null,
): AdminFeedbackReporterDto | null {
  return reporter
    ? {
        id: reporter.id,
        name: reporter.name,
        email: reporter.email,
      }
    : null;
}

/**
 * Convert a database feedback_report row to an admin list item DTO.
 */
function toListItemDto(row: {
  id: string;
  kind: FeedbackReportKind;
  status: FeedbackReportStatus;
  title: string;
  context_platform: string;
  tracking_issue_number: number | null;
  reporter_user_id: string | null;
  status_changed_at: Date | null;
  created_at: Date;
  reporter: { id: string; name: string | null; email: string } | null;
}): AdminFeedbackReportListItemDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    platform: row.context_platform,
    trackingIssueNumber: row.tracking_issue_number,
    reporterUserId: row.reporter_user_id,
    reporter: toReporterDto(row.reporter),
    statusChangedAt: row.status_changed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Convert a database feedback_report row to an admin detail DTO.
 */
function toDetailDto(row: {
  id: string;
  kind: FeedbackReportKind;
  status: FeedbackReportStatus;
  title: string;
  description: string;
  expected_outcome: string | null;
  context_platform: string;
  context_app_version: string;
  context_browser: string;
  context_operating_system: string;
  context_path: string;
  context_sent_at: Date;
  follow_up: string | null;
  status_note: string | null;
  release_tag: string | null;
  fix_notice_opt_in: boolean;
  tracking_issue_number: number | null;
  reporter_user_id: string | null;
  status_changed_at: Date | null;
  created_at: Date;
  reporter: { id: string; name: string | null; email: string } | null;
}): AdminFeedbackReportDetailDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    description: row.description,
    expectedOutcome: row.expected_outcome,
    context: {
      platform: row.context_platform,
      appVersion: row.context_app_version,
      browser: row.context_browser,
      operatingSystem: row.context_operating_system,
      path: row.context_path,
      sentAt: row.context_sent_at.toISOString(),
    },
    followUp: row.follow_up,
    statusNote: row.status_note,
    releaseTag: row.release_tag,
    fixNoticeOptIn: row.fix_notice_opt_in,
    platform: row.context_platform,
    trackingIssueNumber: row.tracking_issue_number,
    reporterUserId: row.reporter_user_id,
    statusChangedAt: row.status_changed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    reporter: toReporterDto(row.reporter),
  };
}

export class AdminFeedbackService {
  constructor(private readonly prisma: PrismaClient = createPrismaClient()) {}

  /**
   * Load a report by id with reporter details, or return a 404 error.
   * Shared by five methods to avoid repeating the same twelve-line preamble.
   */
  private async loadReportOr404(reportId: string): Promise<
    | {
        ok: true;
        status: 200;
        body: Prisma.FeedbackReportGetPayload<{
          include: typeof REPORT_WITH_REPORTER;
        }>;
      }
    | { ok: false; status: 404; body: { message: string } }
  > {
    const report = await this.prisma.feedbackReport.findUnique({
      where: { id: reportId },
      include: REPORT_WITH_REPORTER,
    });

    if (!report) {
      return {
        ok: false,
        status: 404,
        body: { message: 'That feedback report does not exist.' },
      };
    }

    return {
      ok: true,
      status: 200,
      body: report,
    };
  }

  /**
   * Update a report's data within a transaction and write an audit log row.
   * Shared by four methods to avoid repeating the same `$transaction` epilogue.
   */
  private async updateReportAndAudit(
    reportId: string,
    data: Prisma.FeedbackReportUpdateInput,
    actorUserId: string,
    reporterUserId: string | null,
    action: AdminAuditAction,
    meta: Prisma.InputJsonValue,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.feedbackReport.update({
        where: { id: reportId },
        data,
        include: REPORT_WITH_REPORTER,
      });

      await this.writeFeedbackAuditLog(
        tx,
        actorUserId,
        { id: reportId, reporter_user_id: reporterUserId },
        action,
        meta,
      );

      return result;
    });
  }

  /**
   * List Feedback Reports with optional filters, newest first. All filters are
   * optional and unknown-tolerant. Unrecognised status or kind values result
   * in a 400.
   */
  async listReports(
    filters: AdminFeedbackReportFilters,
  ): Promise<AdminServiceResult<{ items: AdminFeedbackReportListItemDto[] }>> {
    // Validate and parse status filter if provided
    let statusFilter: FeedbackReportStatus | undefined;
    if (filters.status !== undefined) {
      if (!isFeedbackReportStatus(filters.status)) {
        return {
          ok: false,
          status: 400,
          body: { message: 'Invalid report status.' },
        };
      }
      statusFilter = filters.status;
    }

    // Validate and parse kind filter if provided
    let kindFilter: FeedbackReportKind | undefined;
    if (filters.kind !== undefined) {
      if (!isFeedbackReportKind(filters.kind)) {
        return {
          ok: false,
          status: 400,
          body: { message: 'Invalid report kind.' },
        };
      }
      kindFilter = filters.kind;
    }

    // Parse and validate limit
    let limit = 100;
    if (filters.limit !== undefined) {
      const parsed = Number(filters.limit);
      if (!Number.isInteger(parsed) || parsed < 1) {
        limit = 100;
      } else {
        limit = Math.min(parsed, 200);
      }
    }

    // Parse tracking issue number filter if provided
    let trackingIssueFilter: number | undefined;
    if (filters.trackingIssueNumber !== undefined) {
      const parsed = Number(filters.trackingIssueNumber);
      if (Number.isInteger(parsed) && parsed > 0) {
        trackingIssueFilter = parsed;
      }
    }

    // Parse platform filter if provided
    let platformFilter: string | undefined;
    if (filters.platform !== undefined) {
      const text = trimString(filters.platform);
      if (text) {
        platformFilter = text;
      }
    }

    // Build where clause
    const where: Prisma.FeedbackReportWhereInput = {};
    if (statusFilter) where.status = statusFilter;
    if (kindFilter) where.kind = kindFilter;
    if (platformFilter) where.context_platform = platformFilter;
    if (trackingIssueFilter !== undefined)
      where.tracking_issue_number = trackingIssueFilter;

    const items = await this.prisma.feedbackReport.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        kind: true,
        status: true,
        title: true,
        context_platform: true,
        tracking_issue_number: true,
        reporter_user_id: true,
        status_changed_at: true,
        created_at: true,
        reporter: REPORT_WITH_REPORTER.reporter,
      },
    });

    return {
      ok: true,
      status: 200,
      body: { items: items.map(toListItemDto) },
    };
  }

  /**
   * Get a single Feedback Report by id with full details and reporter info.
   */
  async getReport(
    reportId: string,
  ): Promise<AdminServiceResult<AdminFeedbackReportDetailDto>> {
    const reportResult = await this.loadReportOr404(reportId);

    if (reportResult.ok === false) {
      return reportResult as unknown as AdminServiceResult<AdminFeedbackReportDetailDto>;
    }

    return {
      ok: true,
      status: 200,
      body: toDetailDto(reportResult.body),
    };
  }

  /**
   * Change a Feedback Report's status. Status transitions are guarded by the
   * pinned status rules table (ADR 0053, PRD #1206).
   *
   * Refuses with 400 if:
   * - The status value is invalid
   * - The status rule says an admin cannot set it
   * - The status is final and cannot be changed manually
   * - The report's current status is final
   * - The status rule requires a note but none was supplied
   * - The note (if supplied) exceeds the text cap
   *
   * Refuses with 404 if the report does not exist.
   */
  async changeStatus(
    actorUserId: string,
    reportId: string,
    input: ChangeStatusInput,
  ): Promise<AdminServiceResult<AdminFeedbackReportDetailDto>> {
    const reportResult = await this.loadReportOr404(reportId);

    if (reportResult.ok === false) {
      return reportResult as unknown as AdminServiceResult<AdminFeedbackReportDetailDto>;
    }

    const report = reportResult.body;

    // Validate the status value
    if (!isFeedbackReportStatus(input.status)) {
      return {
        ok: false,
        status: 400,
        body: { message: 'That status is not valid.' },
      };
    }

    const newStatus = input.status;
    const rule: FeedbackReportStatusRule =
      FEEDBACK_REPORT_STATUS_RULES[newStatus];

    // Check that admin can set this status
    if (!rule.setBy.includes('admin')) {
      return {
        ok: false,
        status: 400,
        body: { message: 'The system sets that status; an admin cannot.' },
      };
    }

    // Check that this is not a final status being set manually
    if (rule.isFinal) {
      return {
        ok: false,
        status: 400,
        body: {
          message:
            'Mark a report fixed or shipped with the release it shipped in.',
        },
      };
    }

    // Check that the status applies to this report's kind
    if (!rule.kinds.includes(report.kind)) {
      // Which kinds the status applies to is the table's answer, so the refusal
      // names them from `rule.kinds` rather than from a second list of members.
      const allowed = rule.kinds
        .map((kind) => `a ${FEEDBACK_REPORT_KIND_RULES[kind].label}`)
        .join(' or ');
      return {
        ok: false,
        status: 400,
        body: {
          message: `Only ${allowed} can be marked ${statusLabel(newStatus).toLowerCase()}.`,
        },
      };
    }

    const alreadyFinal = refuseWhenFinal(report);
    if (alreadyFinal !== null) return alreadyFinal;

    // Check status note requirement and cap
    const noteResult = parseStatusNote(
      input.statusNote,
      rule.requiresStatusNote,
    );
    if (noteResult.ok === false) return noteResult;
    const statusNote = noteResult.body.note;

    // Update the report in a transaction
    const updated = await this.updateReportAndAudit(
      reportId,
      {
        status: newStatus,
        status_changed_at: new Date(),
        // An admin may write a Status Note on any change and must on the
        // ones the table marks. Leaving it out keeps the stored note rather
        // than clearing it, so the reporter never loses the last reason given.
        ...(statusNote ? { status_note: statusNote } : {}),
      },
      actorUserId,
      report.reporter_user_id,
      'feedback_status_change',
      {
        reportId,
        from: report.status,
        to: newStatus,
        statusNote: statusNote || null,
      },
    );

    return {
      ok: true,
      status: 200,
      body: toDetailDto(updated),
    };
  }

  /**
   * Link a Tracking Issue to a Feedback Report. Setting the tracking issue
   * transitions the report to Planned status.
   *
   * Refuses with 400 if:
   * - The tracking issue number is not a positive integer
   * - The report's current status is final
   *
   * Refuses with 404 if the report does not exist.
   */
  async linkTrackingIssue(
    actorUserId: string,
    reportId: string,
    input: LinkTrackingIssueInput,
  ): Promise<AdminServiceResult<AdminFeedbackReportDetailDto>> {
    const reportResult = await this.loadReportOr404(reportId);

    if (reportResult.ok === false) {
      return reportResult as unknown as AdminServiceResult<AdminFeedbackReportDetailDto>;
    }

    const report = reportResult.body;

    // Validate the tracking issue number
    const issueNumber = Number(input.trackingIssueNumber);
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      return {
        ok: false,
        status: 400,
        body: { message: 'Enter the tracking issue number.' },
      };
    }

    const alreadyFinal = refuseWhenFinal(report);
    if (alreadyFinal !== null) return alreadyFinal;

    // Update the report in a transaction
    const updated = await this.updateReportAndAudit(
      reportId,
      {
        tracking_issue_number: issueNumber,
        status: TRACKING_ISSUE_LINKED_STATUS,
        status_changed_at: new Date(),
      },
      actorUserId,
      report.reporter_user_id,
      'feedback_tracking_issue_link',
      {
        reportId,
        trackingIssueNumber: issueNumber,
      },
    );

    return {
      ok: true,
      status: 200,
      body: toDetailDto(updated),
    };
  }

  /**
   * Unlink a Tracking Issue from a Feedback Report. The Report Status is
   * deliberately left where it is — PRD #1206 does not define a reverse
   * transition (e.g., moving from Planned back to Under Review).
   *
   * Refuses with 400 if:
   * - The report has no tracking issue linked
   * - The report's current status is final
   *
   * Refuses with 404 if the report does not exist.
   */
  async unlinkTrackingIssue(
    actorUserId: string,
    reportId: string,
  ): Promise<AdminServiceResult<AdminFeedbackReportDetailDto>> {
    const reportResult = await this.loadReportOr404(reportId);

    if (reportResult.ok === false) {
      return reportResult as unknown as AdminServiceResult<AdminFeedbackReportDetailDto>;
    }

    const report = reportResult.body;

    // Check that there is a tracking issue to unlink
    if (!report.tracking_issue_number) {
      return {
        ok: false,
        status: 400,
        body: { message: 'That report has no tracking issue.' },
      };
    }

    const alreadyFinal = refuseWhenFinal(report);
    if (alreadyFinal !== null) return alreadyFinal;

    // Update the report in a transaction. Status note is deliberately not set
    // when unlinking because PRD #1206 does not define a reverse transition.
    const updated = await this.updateReportAndAudit(
      reportId,
      {
        tracking_issue_number: null,
      },
      actorUserId,
      report.reporter_user_id,
      'feedback_tracking_issue_unlink',
      {
        reportId,
        trackingIssueNumber: report.tracking_issue_number,
      },
    );

    return {
      ok: true,
      status: 200,
      body: toDetailDto(updated),
    };
  }

  /**
   * Mark a Feedback Report as delivered (Fixed for Bug Reports, Shipped for
   * Suggestions) by naming the Release it shipped in. The kind table decides
   * which status applies, so an admin cannot mark a Suggestion Fixed or a Bug
   * Report Shipped at all.
   *
   * If the report is already in the delivered status for its kind:
   * - Same release tag → no-op (no database write, no audit row)
   * - Different release tag → 400
   *
   * Refuses with 400 if:
   * - Release tag is missing or does not match the pattern
   * - The kind has already been delivered but for a different release tag
   * - The report's current status is final (but not the delivered one)
   *
   * Refuses with 404 if the report does not exist.
   */
  async markDelivered(
    actorUserId: string,
    reportId: string,
    input: MarkDeliveredInput,
  ): Promise<AdminServiceResult<AdminFeedbackReportDetailDto>> {
    const reportResult = await this.loadReportOr404(reportId);

    if (reportResult.ok === false) {
      return reportResult as unknown as AdminServiceResult<AdminFeedbackReportDetailDto>;
    }

    const report = reportResult.body;

    // Validate and parse the release tag
    const releaseTag = parseReleaseTag(input.releaseTag);
    if (releaseTag === null) {
      return {
        ok: false,
        status: 400,
        body: {
          message: FEEDBACK_RELEASE_TAG_REFUSAL_MESSAGE,
        },
      };
    }

    // Determine the delivered status for this report's kind
    const deliveredStatus =
      FEEDBACK_REPORT_KIND_RULES[report.kind].deliveredStatus;

    // Check if report is already in delivered status
    if (report.status === deliveredStatus) {
      // Same release tag → no-op
      if (report.release_tag === releaseTag) {
        return {
          ok: true,
          status: 200,
          body: toDetailDto(report),
        };
      }
      // Different release tag → 400
      return {
        ok: false,
        status: 400,
        body: {
          message: `That report is already ${statusLabel(report.status)} in ${report.release_tag}.`,
        },
      };
    }

    // A report already final in the *other* kind's status cannot happen while
    // the kinds table restricts Fixed to a Bug Report and Shipped to a
    // Suggestion, but the guard is cheap and keeps the invariant local.
    const alreadyFinal = refuseWhenFinal(report);
    if (alreadyFinal !== null) return alreadyFinal;

    // Update the report in a transaction
    const updated = await this.updateReportAndAudit(
      reportId,
      {
        status: deliveredStatus,
        release_tag: releaseTag,
        status_changed_at: new Date(),
      },
      actorUserId,
      report.reporter_user_id,
      'feedback_manual_delivery',
      {
        reportId,
        status: deliveredStatus,
        releaseTag,
      },
    );

    // Send the Fix Notice after the transaction commits. Never throws per #1212
    // acceptance criteria — a mail failure must not roll back the Report Status change.
    await feedbackFixNoticeService.sendFixNoticeForReport(reportId);

    return {
      ok: true,
      status: 200,
      body: toDetailDto(updated),
    };
  }

  /**
   * Reopen a Feedback Report that was wrongly marked Fixed or Shipped. The
   * report returns to Under review with a required Status Note, its Release is
   * cleared, and its Tracking Issue link is kept. Its Fix Notice delivery row is
   * deleted so a later genuine Fixed or Shipped can send one new notice. No
   * email is sent. The status change and audit row share one transaction.
   *
   * Refuses with 400 if:
   * - The report is not in a final status (Fixed or Shipped)
   * - The Status Note is missing or over the text cap
   *
   * Refuses with 404 if the report does not exist.
   */
  async reopenReport(
    actorUserId: string,
    reportId: string,
    input: ReopenReportInput,
  ): Promise<AdminServiceResult<AdminFeedbackReportDetailDto>> {
    const reportResult = await this.loadReportOr404(reportId);

    if (reportResult.ok === false) {
      return reportResult as unknown as AdminServiceResult<AdminFeedbackReportDetailDto>;
    }

    const report = reportResult.body;

    // Only a final report can be reopened. The rules table decides which
    // statuses are final, so the refusal names them from the table too.
    if (!FEEDBACK_REPORT_STATUS_RULES[report.status].isFinal) {
      const finalLabels = FEEDBACK_REPORT_STATUSES.filter(
        (status) => FEEDBACK_REPORT_STATUS_RULES[status].isFinal,
      )
        .map(statusLabel)
        .join(' or ');
      return {
        ok: false,
        status: 400,
        body: {
          message: `Only a report marked ${finalLabels} can be reopened.`,
        },
      };
    }

    const noteResult = parseStatusNote(input.statusNote, true);
    if (noteResult.ok === false) return noteResult;
    const statusNote = noteResult.body.note;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.feedbackReport.update({
        where: { id: reportId },
        data: {
          status: REOPENED_STATUS,
          status_note: statusNote,
          release_tag: null,
          status_changed_at: new Date(),
        },
        include: REPORT_WITH_REPORTER,
      });

      // deleteMany because the delivery row may not exist. Deleting it lets a
      // later genuine Fixed or Shipped send one new Fix Notice.
      await tx.feedbackFixNoticeDelivery.deleteMany({
        where: { report_id: reportId },
      });

      await this.writeFeedbackAuditLog(
        tx,
        actorUserId,
        report,
        'feedback_reopen',
        {
          reportId,
          from: report.status,
          to: REOPENED_STATUS,
          releaseTag: report.release_tag,
          statusNote,
        },
      );

      return row;
    });

    return {
      ok: true,
      status: 200,
      body: toDetailDto(updated),
    };
  }

  /**
   * Private helper to write a feedback-related audit log entry inside a
   * transaction, storing the reporting User as the target.
   */
  private async writeFeedbackAuditLog(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    report: { id: string; reporter_user_id: string | null },
    action: AdminAuditAction,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        actor_user_id: actorUserId,
        target_user_id: report.reporter_user_id,
        action,
        meta,
      },
    });
  }
}

const adminFeedbackService = new AdminFeedbackService();
export default adminFeedbackService;

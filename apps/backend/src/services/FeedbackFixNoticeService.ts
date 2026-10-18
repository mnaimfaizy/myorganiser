import {
  EmailBodyBlock,
  RenderedEmail,
  renderEmailShell,
} from '@myorganiser/email-shell';
import { randomBytes } from 'crypto';
import winston from 'winston';
import { isUniqueViolation } from '../helpers/prismaErrors';
import { PrismaClient, createPrismaClient } from '../prisma';
import {
  FEEDBACK_REPORT_KIND_RULES,
  FeedbackReportKind,
} from './feedbackReportConstants';
import sendEmail from './EmailService';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

export type FixNoticeOutcome =
  | 'sent'
  | 'skipped_not_opted_in'
  | 'skipped_reporter_deleted'
  | 'skipped_already_sent'
  | 'failed';

function frontendUrl(): string {
  return (process.env.APP_FRONTEND_URL ?? 'http://localhost:4200').replace(
    /\/+$/,
    '',
  );
}

/**
 * Fix Notice delivery for Feedback Reports. When an admin or the Release-marking
 * path transitions a report to Fixed or Shipped, a notification email is sent to
 * its reporter (if they opted in), using an idempotent per-report delivery ledger
 * keyed by report_id.
 *
 * Never throws on delivery failures (per #1212 and #1214 acceptance criteria —
 * a mail failure must not roll back the Report Status change). Failures are
 * logged and recorded in the ledger; the caller need not handle them.
 */
export class FeedbackFixNoticeService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Send a Fix Notice for a Feedback Report. Called after an admin marks a report
   * Fixed/Shipped, and by the automated Release-marking path (issue #1214/#1215).
   * Never throws — one mail failure must not roll back the Report Status change.
   *
   * - If the reporter was deleted: skips and returns 'skipped_reporter_deleted'.
   * - If the reporter did not opt in on the report: skips and returns 'skipped_not_opted_in'.
   * - If the reporter has globally unsubscribed: records 'failed' and returns 'skipped_not_opted_in'.
   * - If already sent: returns 'skipped_already_sent'.
   * - On send success: returns 'sent'.
   * - On any other error: logs and returns 'failed'.
   */
  async sendFixNoticeForReport(reportId: string): Promise<FixNoticeOutcome> {
    try {
      // Load the report with the reporter's user ID and opt-in status
      const report = await this.prisma.feedbackReport.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          kind: true,
          title: true,
          release_tag: true,
          reporter_user_id: true,
          fix_notice_opt_in: true,
        },
      });

      if (!report) {
        logger.warn(
          `Fix Notice: report ${reportId} not found (should not happen)`,
        );
        return 'failed';
      }

      // Reporter was deleted by User Deletion.
      if (report.reporter_user_id === null) {
        return 'skipped_reporter_deleted';
      }

      // Reporter did not opt in on this report.
      if (!report.fix_notice_opt_in) {
        return 'skipped_not_opted_in';
      }

      // Attempt to claim the ledger. The unique constraint on report_id
      // guards against sending twice.
      const claim = await this.claimDelivery(reportId);
      if (!claim) {
        return 'skipped_already_sent';
      }

      try {
        // Load the user's email and name.
        const user = await this.prisma.user.findUnique({
          where: { id: report.reporter_user_id },
          select: {
            id: true,
            email: true,
            first_name: true,
            fix_notices_enabled: true,
            fix_notice_unsubscribe_token: true,
          },
        });

        if (!user) {
          await this.finishDelivery(reportId, 'failed', 'user_missing');
          return 'skipped_reporter_deleted';
        }

        // Reporter has globally unsubscribed from Fix Notices.
        if (!user.fix_notices_enabled) {
          await this.finishDelivery(reportId, 'failed', 'unsubscribed');
          return 'skipped_not_opted_in';
        }

        // Mint or reuse the unsubscribe token.
        const token = await this.ensureUnsubscribeToken(user);

        // Build and send the email.
        const message = this.buildFixNoticeEmail(
          report,
          user.first_name,
          token,
        );

        await sendEmail(
          user.email,
          this.buildFixNoticeSubject(report),
          message,
        );

        // Mark the delivery as sent.
        await this.finishDelivery(reportId, 'sent', undefined);

        logger.info(
          `Sent Fix Notice for report ${reportId} to user ${user.id}`,
        );
        return 'sent';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.finishDelivery(reportId, 'failed', message);
        logger.error(`Fix Notice failed for report ${reportId}: ${message}`);
        return 'failed';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        `Fix Notice claim/load failed for report ${reportId}: ${message}`,
      );
      return 'failed';
    }
  }

  /**
   * Turns Fix Notices off for the User the token belongs to. Unauthenticated —
   * the opaque token is the only credential a mail client can present.
   * Unknown tokens are a no-op.
   */
  async unsubscribe(token: string): Promise<boolean> {
    if (!token) return false;

    const updated = await this.prisma.user.updateMany({
      where: { fix_notice_unsubscribe_token: token },
      data: { fix_notices_enabled: false },
    });

    return updated.count > 0;
  }

  /**
   * Claim the delivery ledger row. The unique constraint on report_id is the
   * idempotency guard.
   */
  private async claimDelivery(reportId: string): Promise<boolean> {
    try {
      await this.prisma.feedbackFixNoticeDelivery.create({
        data: { report_id: reportId, status: 'claimed' },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /**
   * Finish the ledger row: update status, sent_at, and error fields.
   */
  private async finishDelivery(
    reportId: string,
    status: 'sent' | 'failed',
    error?: string,
  ): Promise<void> {
    await this.prisma.feedbackFixNoticeDelivery.update({
      where: { report_id: reportId },
      data: {
        status,
        sent_at: status === 'sent' ? new Date() : null,
        error: error ?? null,
      },
    });
  }

  /**
   * Mint the unsubscribe secret on first use and reuse it thereafter.
   * Mirrors YouTubeDigestService.ensureUnsubscribeToken.
   */
  private async ensureUnsubscribeToken(user: {
    id: string;
    fix_notice_unsubscribe_token: string | null;
  }): Promise<string> {
    if (user.fix_notice_unsubscribe_token) {
      return user.fix_notice_unsubscribe_token;
    }

    const token = randomBytes(32).toString('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { fix_notice_unsubscribe_token: token },
    });
    return token;
  }

  /**
   * Build the Fix Notice subject line: e.g. "bug report fixed in v1.4.0".
   */
  private buildFixNoticeSubject(report: {
    kind: FeedbackReportKind;
    release_tag: string | null;
  }): string {
    const kindRule = FEEDBACK_REPORT_KIND_RULES[report.kind];
    const deliveredStatus =
      kindRule.deliveredStatus === 'fixed' ? 'fixed' : 'shipped';
    const releaseTag = report.release_tag || 'unknown release';
    return `${kindRule.label} ${deliveredStatus} in ${releaseTag}`;
  }

  /**
   * Build the Fix Notice email body inside the Email Shell as a Notification.
   */
  private buildFixNoticeEmail(
    report: {
      kind: FeedbackReportKind;
      title: string;
      release_tag: string | null;
    },
    firstName: string,
    unsubscribeToken: string,
  ): RenderedEmail {
    const kindRule = FEEDBACK_REPORT_KIND_RULES[report.kind];
    const deliveredStatus =
      kindRule.deliveredStatus === 'fixed' ? 'fixed' : 'shipped';
    const isMobileRelease = report.release_tag?.startsWith('mobile-') ?? false;
    const baseUrl = frontendUrl();
    const unsubscribeUrl = `${baseUrl}/feedback/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
    const changelogUrl = `https://github.com/mnaimfaizy/myorganiser/blob/${report.release_tag}/CHANGELOG.md`;

    const blocks: EmailBodyBlock[] = [
      { kind: 'heading' as const, text: `Hi ${firstName},` },
      {
        kind: 'paragraph' as const,
        text: `Your ${kindRule.label} "${report.title}" is ${deliveredStatus} in ${report.release_tag}.`,
      },
    ];

    if (isMobileRelease) {
      blocks.push({
        kind: 'paragraph' as const,
        text: 'Install the update to get this fix.',
      });
    } else {
      blocks.push({
        kind: 'button' as const,
        label: 'View CHANGELOG',
        url: changelogUrl,
      });
    }

    blocks.push({
      kind: 'footnote' as const,
      text: 'Thank you for your feedback.',
      links: [
        {
          label: 'Your reports',
          url: `${baseUrl}/dashboard/account/reports`,
        },
      ],
    });

    return renderEmailShell({
      emailClass: 'notification',
      unsubscribeUrl,
      preheader: `Your ${kindRule.label} is ${deliveredStatus}.`,
      blocks,
    });
  }
}

const feedbackFixNoticeService = new FeedbackFixNoticeService(
  createPrismaClient(),
);
export default feedbackFixNoticeService;

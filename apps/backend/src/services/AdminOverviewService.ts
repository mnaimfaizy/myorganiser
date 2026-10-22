import {
  FeedbackReportStatus,
  PrismaClient,
  createPrismaClient,
} from '../prisma';
import userService from './UserService';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Platform counts for the admin Overview page. Platform Admin only. */
export interface AdminOverviewResponse {
  /** Total number of Users. */
  users: number;
  /**
   * Users whose account was created in the last 7 days (created_at >= now − 7 days).
   * Users created before User.created_at existed were backfilled from the creation time in their cuid id.
   */
  usersJoinedLast7Days: number;
  /** Users whose role is platform_admin. */
  platformAdmins: number;
  /** Users who have not verified their email. */
  unverified: number;
  /**
   * Users who have not verified their email and whose account was created more than 7 days ago
   * (email_verification_timestamp is null AND created_at < now − 7 days).
   * Users created before User.created_at existed were backfilled from the creation time in their cuid id.
   */
  unverifiedOverAWeek: number;
  /** Users who are disabled. */
  disabled: number;
  /** Users ever granted YouTube Access (lifetime, ADR 0129). */
  youtubeAccessPlacesUsed: number;
  /** YouTube Access places still available under the ceiling, never negative. */
  youtubeAccessPlacesLeft: number;
  /** The configured lifetime YouTube Access ceiling. */
  youtubeAccessCeiling: number;
  /** Feedback Reports in the received status. */
  feedbackReportsReceived: number;
}

export class AdminOverviewService {
  constructor(private readonly prisma: PrismaClient = createPrismaClient()) {}

  /**
   * Platform-wide counts for the admin Overview page. The independent counts
   * run in parallel. YouTube Access reuses UserService so its lifetime
   * ever-granted query (ADR 0129) lives in one place.
   */
  async getOverview(): Promise<AdminOverviewResponse> {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS);

    const [
      users,
      usersJoinedLast7Days,
      platformAdmins,
      unverified,
      unverifiedOverAWeek,
      disabled,
      youtubeAccess,
      feedbackReportsReceived,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: { created_at: { gte: sevenDaysAgo } },
      }),
      this.prisma.user.count({ where: { role: 'platform_admin' } }),
      this.prisma.user.count({
        where: { email_verification_timestamp: null },
      }),
      this.prisma.user.count({
        where: {
          email_verification_timestamp: null,
          created_at: { lt: sevenDaysAgo },
        },
      }),
      this.prisma.user.count({ where: { disabled: true } }),
      userService.getYouTubeAccessUsage(),
      this.prisma.feedbackReport.count({
        where: { status: FeedbackReportStatus.received },
      }),
    ]);

    return {
      users,
      usersJoinedLast7Days,
      platformAdmins,
      unverified,
      unverifiedOverAWeek,
      disabled,
      youtubeAccessPlacesUsed: youtubeAccess.everGranted,
      youtubeAccessPlacesLeft: Math.max(
        0,
        youtubeAccess.ceiling - youtubeAccess.everGranted,
      ),
      youtubeAccessCeiling: youtubeAccess.ceiling,
      feedbackReportsReceived,
    };
  }
}

const adminOverviewService = new AdminOverviewService();
export default adminOverviewService;

import {
  FeedbackReportStatus,
  PrismaClient,
  createPrismaClient,
} from '../prisma';
import userService from './UserService';

/** Platform counts for the admin Overview page. Shape is the HTTP response. */
export interface AdminOverviewCounts {
  users: number;
  platformAdmins: number;
  unverified: number;
  disabled: number;
  youtubeAccessPlacesUsed: number;
  youtubeAccessPlacesLeft: number;
  youtubeAccessCeiling: number;
  feedbackReportsReceived: number;
}

export class AdminOverviewService {
  constructor(private readonly prisma: PrismaClient = createPrismaClient()) {}

  /**
   * Platform-wide counts for the admin Overview page. The independent counts
   * run in parallel. YouTube Access reuses UserService so its lifetime
   * ever-granted query (ADR 0129) lives in one place.
   */
  async getOverview(): Promise<AdminOverviewCounts> {
    const [
      users,
      platformAdmins,
      unverified,
      disabled,
      youtubeAccess,
      feedbackReportsReceived,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'platform_admin' } }),
      this.prisma.user.count({
        where: { email_verification_timestamp: null },
      }),
      this.prisma.user.count({ where: { disabled: true } }),
      userService.getYouTubeAccessUsage(),
      this.prisma.feedbackReport.count({
        where: { status: FeedbackReportStatus.received },
      }),
    ]);

    return {
      users,
      platformAdmins,
      unverified,
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

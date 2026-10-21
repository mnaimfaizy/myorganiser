import { Request as ExRequest } from 'express';
import { Get, Request, Response, Route, Security, Tags } from 'tsoa';
import { PlatformAdminControllerBase } from './PlatformAdminControllerBase';
import adminOverviewService from '../services/AdminOverviewService';
import { VersionFloorRefusal } from '../types';

/** Platform counts for the admin Overview page. Platform Admin only. */
interface AdminOverviewResponse {
  /** Total number of Users. */
  users: number;
  /** Users whose role is platform_admin. */
  platformAdmins: number;
  /** Users who have not verified their email. */
  unverified: number;
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

@Tags('Platform Admin')
@Route('/admin/overview')
@Security('jwt', ['platform_admin'])
@Response<VersionFloorRefusal>(426, 'Below the Version Floor')
export class AdminOverviewController extends PlatformAdminControllerBase {
  /**
   * Platform counts for the admin Overview page. Platform Admin only.
   */
  @Get()
  async getAdminOverview(
    @Request() req: ExRequest,
  ): Promise<AdminOverviewResponse> {
    this.assertPlatformAdmin(req);
    return adminOverviewService.getOverview();
  }
}

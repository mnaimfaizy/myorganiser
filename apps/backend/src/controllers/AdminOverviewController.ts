import { Request as ExRequest } from 'express';
import { Get, Request, Response, Route, Security, Tags } from 'tsoa';
import { PlatformAdminControllerBase } from './PlatformAdminControllerBase';
import adminOverviewService, {
  AdminOverviewResponse,
} from '../services/AdminOverviewService';
import { VersionFloorRefusal } from '../types';

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

import {
  Body,
  Delete,
  Get,
  Patch,
  Path,
  Post,
  Put,
  Query,
  Request,
  Response,
  Route,
  Security,
  Tags,
} from 'tsoa';
import { Request as ExRequest } from 'express';
import { PlatformAdminControllerBase } from './PlatformAdminControllerBase';
import adminFeedbackService, {
  AdminFeedbackReportListItemDto,
  AdminFeedbackReportDetailDto,
} from '../services/AdminFeedbackService';
import {
  FeedbackReportKind,
  FeedbackReportStatus,
} from '../services/feedbackReportConstants';
import { ErrorResponse } from './ErrorResponse';
import { VersionFloorRefusal } from '../types';

/**
 * Request body for changing a Feedback Report's status.
 */
export interface ChangeFeedbackReportStatusRequest {
  status: FeedbackReportStatus;
  /** Optional note explaining why the status changed. */
  statusNote?: string;
}

/**
 * Request body for linking a Tracking Issue to a Feedback Report.
 */
export interface LinkFeedbackReportTrackingIssueRequest {
  /** The GitHub issue number to link. */
  trackingIssueNumber: number;
}

/**
 * Request body for marking a Feedback Report as delivered (Fixed or Shipped).
 */
export interface MarkFeedbackReportDeliveredRequest {
  /** The Release tag (vX.Y.Z) or Mobile Release tag (mobile-vX.Y.Z) the fix shipped in. */
  releaseTag: string;
}

/**
 * Request body for reopening a wrongly Fixed or Shipped Feedback Report.
 */
export interface ReopenFeedbackReportRequest {
  /** Required note explaining why the report is being reopened. */
  statusNote: string;
}

/**
 * Response body for list feedback reports endpoint.
 */
interface ListAdminFeedbackReportsResponse {
  items: AdminFeedbackReportListItemDto[];
}

@Tags('Platform Admin')
@Route('/admin/feedback/reports')
@Security('jwt', ['platform_admin'])
@Response<VersionFloorRefusal>(426, 'Below the Version Floor')
export class AdminFeedbackController extends PlatformAdminControllerBase {
  /**
   * List Feedback Reports with optional filters (status, kind, platform,
   * trackingIssueNumber, limit). Newest first. Platform Admin only.
   */
  @Get()
  @Response<ErrorResponse>(400, 'Invalid filter')
  async listFeedbackReports(
    @Request() req: ExRequest,
    @Query() status?: FeedbackReportStatus,
    @Query() kind?: FeedbackReportKind,
    @Query() platform?: string,
    @Query() trackingIssueNumber?: number,
    @Query() limit?: number,
  ): Promise<ListAdminFeedbackReportsResponse> {
    this.assertPlatformAdmin(req);

    const result = await adminFeedbackService.listReports({
      status,
      kind,
      platform,
      trackingIssueNumber,
      limit,
    });

    this.setStatus(result.status);
    return result.body as ListAdminFeedbackReportsResponse;
  }

  /**
   * Get a single Feedback Report by id with full details and reporter info.
   * Platform Admin only.
   */
  @Get('{reportId}')
  @Response<ErrorResponse>(404, 'Report not found')
  async getFeedbackReport(
    @Request() req: ExRequest,
    @Path() reportId: string,
  ): Promise<AdminFeedbackReportDetailDto> {
    this.assertPlatformAdmin(req);

    const result = await adminFeedbackService.getReport(reportId);

    this.setStatus(result.status);
    return result.body as AdminFeedbackReportDetailDto;
  }

  /**
   * Change a Feedback Report's status with an optional status note.
   * Status transitions are guarded by the pinned rules table. Platform Admin only.
   */
  @Patch('{reportId}/status')
  @Response<ErrorResponse>(400, 'Invalid status or note')
  @Response<ErrorResponse>(404, 'Report not found')
  async changeFeedbackReportStatus(
    @Request() req: ExRequest,
    @Path() reportId: string,
    @Body() body: ChangeFeedbackReportStatusRequest,
  ): Promise<AdminFeedbackReportDetailDto> {
    const admin = this.assertPlatformAdmin(req);

    const result = await adminFeedbackService.changeStatus(
      admin.id,
      reportId,
      body,
    );

    this.setStatus(result.status);
    return result.body as AdminFeedbackReportDetailDto;
  }

  /**
   * Link a GitHub issue to a Feedback Report, transitioning it to Planned.
   * Platform Admin only.
   */
  @Put('{reportId}/tracking-issue')
  @Response<ErrorResponse>(400, 'Invalid issue number')
  @Response<ErrorResponse>(404, 'Report not found')
  async linkFeedbackReportTrackingIssue(
    @Request() req: ExRequest,
    @Path() reportId: string,
    @Body() body: LinkFeedbackReportTrackingIssueRequest,
  ): Promise<AdminFeedbackReportDetailDto> {
    const admin = this.assertPlatformAdmin(req);

    const result = await adminFeedbackService.linkTrackingIssue(
      admin.id,
      reportId,
      body,
    );

    this.setStatus(result.status);
    return result.body as AdminFeedbackReportDetailDto;
  }

  /**
   * Unlink a GitHub issue from a Feedback Report. Platform Admin only.
   */
  @Delete('{reportId}/tracking-issue')
  @Response<ErrorResponse>(400, 'No tracking issue to unlink')
  @Response<ErrorResponse>(404, 'Report not found')
  async unlinkFeedbackReportTrackingIssue(
    @Request() req: ExRequest,
    @Path() reportId: string,
  ): Promise<AdminFeedbackReportDetailDto> {
    const admin = this.assertPlatformAdmin(req);

    const result = await adminFeedbackService.unlinkTrackingIssue(
      admin.id,
      reportId,
    );

    this.setStatus(result.status);
    return result.body as AdminFeedbackReportDetailDto;
  }

  /**
   * Mark a Feedback Report as delivered (Fixed for Bug Reports, Shipped for
   * Suggestions) by naming the Release. Platform Admin only.
   */
  @Post('{reportId}/delivery')
  @Response<ErrorResponse>(400, 'Invalid release tag or status')
  @Response<ErrorResponse>(404, 'Report not found')
  async markFeedbackReportDelivered(
    @Request() req: ExRequest,
    @Path() reportId: string,
    @Body() body: MarkFeedbackReportDeliveredRequest,
  ): Promise<AdminFeedbackReportDetailDto> {
    const admin = this.assertPlatformAdmin(req);

    const result = await adminFeedbackService.markDelivered(
      admin.id,
      reportId,
      body,
    );

    this.setStatus(result.status);
    return result.body as AdminFeedbackReportDetailDto;
  }

  /**
   * Reopen a Feedback Report that was wrongly marked Fixed or Shipped. It
   * returns to Under review, clears its Release, and may send a new Fix Notice
   * on a later genuine delivery. Platform Admin only.
   */
  @Post('{reportId}/reopen')
  @Response<ErrorResponse>(
    400,
    'Report is not Fixed or Shipped, or the note is missing',
  )
  @Response<ErrorResponse>(404, 'Report not found')
  async reopenFeedbackReport(
    @Request() req: ExRequest,
    @Path() reportId: string,
    @Body() body: ReopenFeedbackReportRequest,
  ): Promise<AdminFeedbackReportDetailDto> {
    const admin = this.assertPlatformAdmin(req);

    const result = await adminFeedbackService.reopenReport(
      admin.id,
      reportId,
      body,
    );

    this.setStatus(result.status);
    return result.body as AdminFeedbackReportDetailDto;
  }
}

const adminFeedbackController = new AdminFeedbackController();
export default adminFeedbackController;

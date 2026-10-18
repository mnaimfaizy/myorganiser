import { Request as ExRequest } from 'express';
import {
  Body,
  Controller,
  Get,
  Path,
  Post,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from 'tsoa';
import { requireUserId } from '../guards/AuthGuard';
import feedbackService, {
  FeedbackReportDto,
  FeedbackReportListItemDto,
} from '../services/FeedbackService';
import { FeedbackReportKind } from '../services/feedbackReportConstants';
import { ErrorResponse } from './ErrorResponse';
import { VersionFloorRefusal } from '../types';

/**
 * The Report Context the sender saw before sending. It never carries
 * screenshots, logs, or anything read from the Vault, and `path` is the page
 * path alone — no query string and no fragment.
 */
export interface ReportContextRequest {
  /** Which app sent the report — `web` for the dashboard. */
  platform: string;
  appVersion: string;
  browser: string;
  operatingSystem: string;
  path: string;
  /** ISO 8601 instant shown in the Report Context preview. */
  sentAt: string;
}

export interface CreateFeedbackReportRequest {
  kind: FeedbackReportKind;
  title: string;
  description: string;
  /** Bug Report only — what the sender expected to happen. */
  expectedOutcome?: string;
  context: ReportContextRequest;
  /** Fix Notice opt-in. The dialog ticks it by default. */
  fixNoticeOptIn: boolean;
}

type CreateFeedbackReportResponse = FeedbackReportDto | ErrorResponse;

interface ListFeedbackReportsResponse {
  items: FeedbackReportListItemDto[];
  hasChangedSinceLastSeen: boolean;
}

interface MarkReportSeenResponse {
  seenAt: string;
}

export interface AddFollowUpRequest {
  followUp: string;
}

type AddFollowUpResponse = FeedbackReportListItemDto | ErrorResponse;

@Tags('Feedback')
@Route('/feedback/reports')
@Response<VersionFloorRefusal>(426, 'Below the Version Floor')
@Security('jwt')
export class FeedbackController extends Controller {
  /** Store a Feedback Report for the signed-in User with Report Status Received. */
  @Post()
  @SuccessResponse(201, 'Created')
  @Response<ErrorResponse>(400, 'Invalid Feedback Report')
  @Response<ErrorResponse>(429, 'Too many Feedback Reports')
  public async createReport(
    @Request() req: ExRequest,
    @Body() body: CreateFeedbackReportRequest,
  ): Promise<CreateFeedbackReportResponse> {
    const userId = requireUserId(req);

    const result = await feedbackService.createReport(userId, body);
    this.setStatus(result.status);
    return result.body as CreateFeedbackReportResponse;
  }

  /** List the signed-in User's own Feedback Reports, newest first. */
  @Get()
  public async listReports(
    @Request() req: ExRequest,
  ): Promise<ListFeedbackReportsResponse> {
    const userId = requireUserId(req);

    const result = await feedbackService.listReports(userId);
    this.setStatus(result.status);
    return result.body as ListFeedbackReportsResponse;
  }

  /** Mark the signed-in User's Feedback Reports as seen (clears the badge). */
  @Post('/seen')
  public async markReportsSeen(
    @Request() req: ExRequest,
  ): Promise<MarkReportSeenResponse> {
    const userId = requireUserId(req);

    const result = await feedbackService.markReportsSeen(userId);
    this.setStatus(result.status);
    return result.body as MarkReportSeenResponse;
  }

  /** Add the one Follow-up a reporter may send while their Bug Report is Can't reproduce; it returns the report to Under review. */
  @Post('/{reportId}/follow-up')
  @Response<ErrorResponse>(400, 'Invalid Follow-up')
  @Response<ErrorResponse>(404, 'Feedback Report not found')
  public async addFollowUp(
    @Request() req: ExRequest,
    @Path() reportId: string,
    @Body() body: AddFollowUpRequest,
  ): Promise<AddFollowUpResponse> {
    const userId = requireUserId(req);

    const result = await feedbackService.addFollowUp(userId, reportId, body);
    this.setStatus(result.status);
    return result.body as AddFollowUpResponse;
  }
}

const feedbackController = new FeedbackController();
export default feedbackController;

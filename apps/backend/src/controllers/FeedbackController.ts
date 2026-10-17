import { Request as ExRequest } from 'express';
import {
  Body,
  Controller,
  Post,
  Request,
  Response,
  Route,
  Security,
  Tags,
} from 'tsoa';
import { requireUserId } from '../guards/AuthGuard';
import feedbackService, {
  FeedbackReportDto,
} from '../services/FeedbackService';
import { FeedbackReportKind } from '../services/feedbackReportConstants';
import { ErrorResponse } from './ErrorResponse';

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

@Tags('Feedback')
@Route('/feedback/reports')
@Security('jwt')
export class FeedbackController extends Controller {
  /** Store a Feedback Report for the signed-in User with Report Status Received. */
  @Post()
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
}

const feedbackController = new FeedbackController();
export default feedbackController;

import {
  Body,
  Controller,
  Post,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from 'tsoa';
import { ErrorResponse } from './ErrorResponse';
import feedbackReleaseService, {
  FeedbackReleaseMarkCounts,
} from '../services/FeedbackReleaseService';

/**
 * Request body the Production deploy sends to mark a Release's Planned
 * Feedback Reports delivered (ADR 0133).
 */
export interface MarkFeedbackReleaseRequest {
  /** The Release tag (vX.Y.Z) or Mobile Release tag (mobile-vX.Y.Z) the fixes shipped in. */
  releaseTag: string;
  /** The Tracking Issue numbers the Release shipped, at most 500. */
  issueNumbers: number[];
}

/**
 * Release marking for the Production deploy. Authenticated by its own deploy
 * credential (X-Deploy-Secret), not by a user JWT or the cron secret.
 */
@Tags('Feedback')
@Route('/feedback/releases')
export class FeedbackReleaseController extends Controller {
  /**
   * Marks every Planned Feedback Report on the named Tracking Issues as Fixed
   * (Bug Report) or Shipped (Suggestion), sends each newly marked report its
   * Fix Notice, and returns counts only.
   */
  @Post('mark')
  @Security('deploy-secret')
  @SuccessResponse('200', 'Release marked')
  @Response<ErrorResponse>(400, 'Invalid Release tag or issue list')
  @Response<ErrorResponse>(401, 'Missing or wrong deploy credential')
  public async markRelease(
    @Body() body: MarkFeedbackReleaseRequest,
  ): Promise<FeedbackReleaseMarkCounts | ErrorResponse> {
    const result = await feedbackReleaseService.markRelease(body);
    this.setStatus(result.status);
    return result.body;
  }
}

const feedbackReleaseController = new FeedbackReleaseController();
export default feedbackReleaseController;

import { Body, Controller, Post, Route, Tags } from 'tsoa';
import { ErrorResponse } from './ErrorResponse';
import feedbackFixNoticeService from '../services/FeedbackFixNoticeService';

interface FixNoticeUnsubscribeBody {
  token: string;
}

interface FixNoticeUnsubscribeResponse {
  ok: true;
}

/**
 * Public Feedback endpoints — unauthenticated operations like unsubscribing
 * from Fix Notice emails.
 */
@Tags('Feedback')
@Route('/feedback')
export class FeedbackPublicController extends Controller {
  /**
   * Turns Fix Notices off for the User the token belongs to. Unauthenticated
   * by design — the opaque token is the only credential a mail client can
   * present (mirrors YouTubeController.unsubscribeFromDigest).
   */
  @Post('/fix-notice/unsubscribe')
  public async unsubscribeFromFixNotices(
    @Body() body: FixNoticeUnsubscribeBody,
  ): Promise<FixNoticeUnsubscribeResponse | ErrorResponse> {
    const ok = await feedbackFixNoticeService.unsubscribe(body.token);
    if (!ok) {
      this.setStatus(404);
      return { message: 'Unknown unsubscribe link.' };
    }
    return { ok: true };
  }
}

const feedbackPublicController = new FeedbackPublicController();
export default feedbackPublicController;

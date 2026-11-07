import { Request as ExRequest } from 'express';
import {
  Body,
  Controller,
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
import { isYouTubeAvailable } from '../config/youtube';
import { getAuthenticatedUser, requireUserId } from '../guards/AuthGuard';
import userService from '../services/UserService';
import youTubeDigestService from '../services/YouTubeDigestService';
import youTubeSyncWorkerService from '../services/YouTubeSyncWorkerService';
import youtubeSyncService, {
  YouTubeChannelSyncResult,
  YouTubeRefreshResult,
  YouTubeSyncStatusDTO,
  YouTubeVideoWithChannel,
  isShortDuration,
} from '../services/YouTubeSyncService';
import { type UserInterface, VersionFloorRefusal } from '../types';

type YouTubeErrorResponse = { message: string };

// ─── Response Types ─────────────────────────────────────────────

interface AuthUrlResponse {
  url: string;
}

interface YouTubeAcknowledgementResponse {
  /** ISO time the User accepted the one-time acknowledgement, or null (ADR 0129). */
  acknowledgedAt: string | null;
}

interface AcknowledgementRequiredResponse {
  message: string;
  code: 'acknowledgement_required';
}

interface StatusResponse {
  connected: boolean;
  status: string;
}

interface YouTubeAvailabilityResponse {
  available: boolean;
}

/**
 * The signed-in User's YouTube Access state (ADR 0129): `granted` while a
 * Platform Admin grants it, `withdrawn` once a grant has been taken back, and
 * `not_granted` when it has never been granted.
 */
export type YouTubeAccessState = 'granted' | 'not_granted' | 'withdrawn';

interface YouTubeAccessResponse {
  /** Whether a Platform Admin currently grants the signed-in User YouTube Access (ADR 0129). */
  granted: boolean;
  /** Derived YouTube Access state; `withdrawn` covers a grant taken back. */
  state: YouTubeAccessState;
  /**
   * ISO time the grant was withdrawn. Present only when `state` is `withdrawn`
   * and the withdrawal date is known; absent for Users withdrawn before it was recorded.
   */
  withdrawnAt?: string;
}

/** The User columns that decide YouTube Access. */
export type YouTubeAccessFields = Pick<
  UserInterface,
  | 'youtube_access'
  | 'youtube_access_first_granted_at'
  | 'youtube_access_withdrawn_at'
>;

interface SubscriptionResponse {
  id: string;
  channelId: string;
  channelTitle: string;
  channelThumbnail: string | null;
  uploadsPlaylistId: string;
  enabled: boolean;
  lastSyncedAt: string | null;
}

interface VideoResponse {
  id: string;
  videoId: string;
  channelId: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string;
  watched: boolean;
  channelTitle?: string;
  /** Runtime in seconds, or null when this upload has not been classified yet. */
  durationSeconds: number | null;
  /** Whether this Cached Upload is a Short. Unclassified uploads are never Shorts. */
  isShort: boolean;
}

interface VideosPageResponse {
  videos: VideoResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ChannelCarouselResponse {
  channelId: string;
  channelTitle: string;
  channelThumbnail: string | null;
  videos: VideoResponse[];
}

interface NotificationSettingsResponse {
  /** Whether the User has opted in to the weekly New-only digest. */
  enabled: boolean;
  lastNotifiedAt: string | null;
  /** Preferred send day in the User's own week, 0 = Sunday .. 6 = Saturday. */
  preferredWeekday: number;
  /** IANA time zone the weekday is evaluated in. Null means UTC. */
  timeZone: string | null;
}

interface NotificationSettingsBody {
  enabled?: boolean;
  preferredWeekday?: number;
  timeZone?: string | null;
}

/** Result of one bounded pass of the metadata sync worker. */
interface CronSyncResponse {
  ran: boolean;
  processed: number;
  usersSynced: number;
  failed: number;
  done: boolean;
}

/** Result of one bounded pass of the weekly digest worker. */
interface CronDigestResponse {
  ran: boolean;
  processed: number;
  sent: number;
  skippedEmpty: number;
  notDue: number;
  duplicates: number;
  failed: number;
  done: boolean;
}

interface UnsubscribeBody {
  token: string;
}

interface UnsubscribeResponse {
  ok: boolean;
}

interface ProgressResponse {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  startedAt: string;
  failedChannels: Array<{
    channelId: string;
    channelTitle: string;
    error: string;
  }>;
}

interface SyncStatusResponse {
  status: string;
  lastSyncedAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncError: string | null;
  retryAt: string | null;
  progress: ProgressResponse | null;
  channelStatus: string;
  channelLastAttemptAt: string | null;
  channelLastError: string | null;
  channelRetryAt: string | null;
}

interface SyncResponse extends SyncStatusResponse {
  synced: number;
  videosSynced: number;
}

interface ChannelSyncResponse {
  synced: number;
  status: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  retryAt: string | null;
}

interface WatchedBody {
  watched: boolean;
}

interface WatchedResponse {
  ok: boolean;
  watched: boolean;
}

type DisconnectResponse =
  | {
      ok: true;
      message: string;
      revokeFailed?: boolean;
      googlePermissionsUrl?: string;
    }
  | {
      ok: false;
      message: string;
      code?: 'sync_run_live';
    };

function toSyncStatusResponse(
  status: YouTubeSyncStatusDTO,
): SyncStatusResponse {
  return {
    status: status.status,
    lastSyncedAt: status.lastSyncedAt?.toISOString() ?? null,
    lastSyncAttemptAt: status.lastSyncAttemptAt?.toISOString() ?? null,
    lastSyncError: status.lastSyncError,
    retryAt: status.retryAt?.toISOString() ?? null,
    progress: status.progress
      ? {
          total: status.progress.total,
          processed: status.progress.processed,
          succeeded: status.progress.succeeded,
          failed: status.progress.failed,
          startedAt: status.progress.startedAt.toISOString(),
          failedChannels: status.progress.failedChannels,
        }
      : null,
    channelStatus: status.channelStatus,
    channelLastAttemptAt: status.channelLastAttemptAt?.toISOString() ?? null,
    channelLastError: status.channelLastError,
    channelRetryAt: status.channelRetryAt?.toISOString() ?? null,
  };
}

function toChannelSyncResponse(
  result: YouTubeChannelSyncResult,
): ChannelSyncResponse {
  return {
    synced: result.synced,
    status: result.status,
    lastAttemptAt: result.lastAttemptAt?.toISOString() ?? null,
    lastError: result.lastError,
    retryAt: result.retryAt?.toISOString() ?? null,
  };
}

function toNotificationSettingsResponse(settings: {
  enabled: boolean;
  lastNotifiedAt: Date | null;
  preferredWeekday: number;
  timeZone: string | null;
}): NotificationSettingsResponse {
  return {
    enabled: settings.enabled,
    lastNotifiedAt: settings.lastNotifiedAt?.toISOString() ?? null,
    preferredWeekday: settings.preferredWeekday,
    timeZone: settings.timeZone,
  };
}

/**
 * Derives the YouTube Access response from the User row (ADR 0129). A current
 * grant wins; otherwise a User granted at least once reads as `withdrawn`
 * (with the date only when the withdrawal was recorded), and a User never
 * granted reads as `not_granted`.
 */
export function toYouTubeAccessResponse(
  user: YouTubeAccessFields,
): YouTubeAccessResponse {
  if (user.youtube_access === true) {
    return { granted: true, state: 'granted' };
  }
  // Only a User granted at least once can have been withdrawn.
  if (!user.youtube_access_first_granted_at) {
    return { granted: false, state: 'not_granted' };
  }
  const withdrawnAt = user.youtube_access_withdrawn_at;
  return withdrawnAt
    ? {
        granted: false,
        state: 'withdrawn',
        withdrawnAt: withdrawnAt.toISOString(),
      }
    : { granted: false, state: 'withdrawn' };
}

function toSyncResponse(result: YouTubeRefreshResult): SyncResponse {
  return {
    synced: result.subscriptionsSynced,
    videosSynced: result.videosSynced,
    ...toSyncStatusResponse(result),
  };
}

// ─── Controller ─────────────────────────────────────────────────

@Tags('YouTube')
@Route('/youtube')
@Response<VersionFloorRefusal>(426, 'Below the Version Floor')
export class YouTubeController extends Controller {
  /**
   * Returns the one-time YouTube acknowledgement state for the signed-in User
   * (ADR 0129). `acknowledgedAt` is null until the User accepts it.
   */
  @Get('/acknowledgement')
  @Security('jwt', ['youtube_access'])
  public async getAcknowledgement(
    @Request() req: ExRequest,
  ): Promise<YouTubeAcknowledgementResponse> {
    const userId = requireUserId(req);
    const acknowledgedAt = await userService.getYouTubeAcknowledgedAt(userId);
    return { acknowledgedAt: acknowledgedAt?.toISOString() ?? null };
  }

  /**
   * Records the signed-in User's one-time YouTube acknowledgement (ADR 0129).
   * The first accepted time is kept: calling again returns it unchanged.
   */
  @Post('/acknowledgement')
  @Security('jwt', ['youtube_access'])
  public async acceptAcknowledgement(
    @Request() req: ExRequest,
  ): Promise<YouTubeAcknowledgementResponse | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    const acknowledgedAt = await userService.acknowledgeYouTube(userId);
    if (acknowledgedAt === null) {
      this.setStatus(404);
      return { message: 'User not found' };
    }
    return { acknowledgedAt: acknowledgedAt.toISOString() };
  }

  /**
   * Returns the Google OAuth consent URL for linking YouTube. Refused with 409
   * until the User has stored the one-time acknowledgement (ADR 0129).
   */
  @Get('/auth-url')
  @Security('jwt', ['youtube_access'])
  @Response<AcknowledgementRequiredResponse>(
    409,
    'The YouTube acknowledgement has not been accepted yet.',
  )
  public async getAuthUrl(
    @Request() req: ExRequest,
  ): Promise<
    AuthUrlResponse | AcknowledgementRequiredResponse | YouTubeErrorResponse
  > {
    const userId = requireUserId(req);
    const acknowledgedAt = await userService.getYouTubeAcknowledgedAt(userId);
    if (acknowledgedAt === null) {
      this.setStatus(409);
      return {
        message: 'Accept the YouTube acknowledgement before connecting.',
        code: 'acknowledgement_required',
      };
    }
    const url = youtubeSyncService.getAuthUrl(userId);
    return { url };
  }

  /**
   * OAuth callback — exchanges the authorization code for tokens.
   */
  @Post('/callback')
  @Security('jwt', ['youtube_access'])
  public async handleCallback(
    @Request() req: ExRequest,
    @Body() body: { code: string },
  ): Promise<{ ok: boolean; message: string }> {
    const userId = requireUserId(req);
    const result = await youtubeSyncService.handleOAuthCallback(
      userId,
      body.code,
    );
    if (!result.ok) {
      this.setStatus(400);
    }
    return result;
  }

  /**
   * Returns the user's YouTube integration status.
   */
  @Get('/status')
  @Security('jwt', ['youtube_access'])
  public async getConnectionStatus(
    @Request() req: ExRequest,
  ): Promise<StatusResponse | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    try {
      return await youtubeSyncService.getStatus(userId);
    } catch {
      this.setStatus(500);
      return { message: 'Failed to fetch YouTube status' };
    }
  }

  /**
   * Disconnects the user's YouTube account after revoking the token.
   * Deletes all YouTube data, including Watched marks; nothing is kept for a reconnect.
   */
  @Delete('/disconnect')
  @Security('jwt', ['youtube_access'])
  public async disconnect(
    @Request() req: ExRequest,
  ): Promise<DisconnectResponse> {
    const userId = requireUserId(req);
    const result = await youtubeSyncService.disconnect(userId);
    if (result.ok === false && result.code === 'sync_run_live') {
      this.setStatus(409);
    }
    return result;
  }

  /**
   * Returns the user's synced YouTube channel subscriptions.
   */
  @Get('/subscriptions')
  @Security('jwt', ['youtube_access'])
  public async getSubscriptions(
    @Request() req: ExRequest,
  ): Promise<SubscriptionResponse[] | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    const subs = await youtubeSyncService.getSubscriptions(userId);
    return subs.map((s) => ({
      id: s.id,
      channelId: s.channelId,
      channelTitle: s.channelTitle,
      channelThumbnail: s.channelThumbnail,
      uploadsPlaylistId: s.uploadsPlaylistId,
      enabled: s.enabled,
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Channel Sync: fetches fresh subscriptions from YouTube and upserts Followed Channels.
   */
  @Put('/subscriptions/sync')
  @Security('jwt', ['youtube_access'])
  public async syncSubscriptions(
    @Request() req: ExRequest,
  ): Promise<ChannelSyncResponse | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    return toChannelSyncResponse(await youtubeSyncService.syncChannels(userId));
  }

  /**
   * Upload Sync: fetches Cached Uploads for every Enabled Channel.
   */
  @Put('/uploads/sync')
  @Security('jwt', ['youtube_access'])
  public async syncUploads(
    @Request() req: ExRequest,
  ): Promise<SyncResponse | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    return toSyncResponse(await youtubeSyncService.syncUploads(userId));
  }

  /** Returns the latest cached-video sync outcome and retry time. */
  @Get('/sync-status')
  @Security('jwt', ['youtube_access'])
  public async getSyncStatus(
    @Request() req: ExRequest,
  ): Promise<SyncStatusResponse | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    return toSyncStatusResponse(await youtubeSyncService.getSyncStatus(userId));
  }

  /**
   * Toggles a subscription's enabled state.
   */
  @Patch('/subscriptions/{subscriptionId}')
  @Security('jwt', ['youtube_access'])
  public async toggleSubscription(
    @Request() req: ExRequest,
    @Path() subscriptionId: string,
    @Body() body: { enabled: boolean },
  ): Promise<{ ok: boolean } | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    await youtubeSyncService.toggleSubscription(
      userId,
      subscriptionId,
      body.enabled,
    );
    return { ok: true };
  }

  /**
   * Returns cached videos with sorting, searching, and pagination.
   * @param sort  Sort order: latest | oldest | az
   * @param search  Filter by video title
   * @param page  Page number (1-based)
   * @param limit  Items per page
   * @param kind  Library slice by runtime: short | long | all (default all)
   */
  @Get('/videos')
  @Security('jwt', ['youtube_access'])
  public async getVideos(
    @Request() req: ExRequest,
    @Query() sort?: 'latest' | 'oldest' | 'az',
    @Query() search?: string,
    @Query() page?: number,
    @Query() limit?: number,
    @Query() channelId?: string,
    @Query() kind?: 'short' | 'long' | 'all',
  ): Promise<VideosPageResponse | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    const result = await youtubeSyncService.getVideos(userId, {
      sort,
      search,
      page,
      limit,
      channelId,
      kind,
    });
    return {
      ...result,
      videos: result.videos.map((v: YouTubeVideoWithChannel) => ({
        id: v.id,
        videoId: v.videoId,
        channelId: v.channelId,
        title: v.title,
        thumbnail: v.thumbnail,
        publishedAt: v.publishedAt.toISOString(),
        watched: v.watched,
        channelTitle: v.subscription?.channelTitle ?? undefined,
        durationSeconds: v.durationSeconds,
        isShort: isShortDuration(v.durationSeconds),
      })),
    };
  }

  /** Marks a Cached Upload as Watched or New. */
  @Patch('/videos/{videoId}/watched')
  @Security('jwt', ['youtube_access'])
  public async setVideoWatched(
    @Request() req: ExRequest,
    @Path() videoId: string,
    @Body() body: WatchedBody,
  ): Promise<WatchedResponse | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    const updated = await youtubeSyncService.setVideoWatched(
      userId,
      videoId,
      body.watched,
    );
    if (updated === 0) {
      this.setStatus(404);
      return { message: 'Cached Upload not found' };
    }
    return { ok: true, watched: body.watched };
  }

  /**
   * Returns videos grouped by channel for the carousel view.
   */
  @Get('/videos/carousel')
  @Security('jwt', ['youtube_access'])
  public async getVideosCarousel(
    @Request() req: ExRequest,
  ): Promise<ChannelCarouselResponse[] | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    const grouped = await youtubeSyncService.getVideosGroupedByChannel(userId);
    return grouped.map((g) => ({
      channelId: g.channelId,
      channelTitle: g.channelTitle,
      channelThumbnail: g.channelThumbnail,
      videos: g.videos.map((v) => ({
        id: v.id,
        videoId: v.videoId,
        channelId: v.channelId,
        title: v.title,
        thumbnail: v.thumbnail,
        publishedAt: v.publishedAt.toISOString(),
        watched: v.watched,
        durationSeconds: v.durationSeconds,
        isShort: isShortDuration(v.durationSeconds),
      })),
    }));
  }

  /**
   * Returns the user's YouTube notification preferences.
   */
  @Get('/notification-settings')
  @Security('jwt', ['youtube_access'])
  public async getNotificationSettings(
    @Request() req: ExRequest,
  ): Promise<NotificationSettingsResponse | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    const settings = await youtubeSyncService.getNotificationSettings(userId);
    return toNotificationSettingsResponse(settings);
  }

  /**
   * Updates the user's YouTube notification preferences.
   */
  @Patch('/notification-settings')
  @Security('jwt', ['youtube_access'])
  public async updateNotificationSettings(
    @Request() req: ExRequest,
    @Body() body: NotificationSettingsBody,
  ): Promise<NotificationSettingsResponse | YouTubeErrorResponse> {
    const userId = requireUserId(req);
    try {
      const updated = await youtubeSyncService.updateNotificationSettings(
        userId,
        body,
      );
      return toNotificationSettingsResponse(updated);
    } catch (error) {
      this.setStatus(400);
      return {
        message:
          error instanceof Error
            ? error.message
            : 'Invalid notification settings.',
      };
    }
  }

  /**
   * YouTube Access state for the signed-in User (ADR 0129): `granted`,
   * `not_granted`, or `withdrawn`, with `withdrawnAt` when the withdrawal date
   * is known. `granted` is true only for `granted`. Reachable without the access
   * scope, so the web can hide YouTube from Users without it.
   */
  @Get('/access')
  @Security('jwt')
  public async getAccess(
    @Request() req: ExRequest,
  ): Promise<YouTubeAccessResponse> {
    const user = getAuthenticatedUser(req);
    return toYouTubeAccessResponse(user);
  }

  /**
   * Public availability report (ADR 0091): whether YouTube is available right
   * now. Unauthenticated and reports booleans only — never configuration
   * values — so the web can hide the feature without needing a session.
   */
  @Get('/availability')
  public async getAvailability(): Promise<YouTubeAvailabilityResponse> {
    return { available: isYouTubeAvailable() };
  }

  /**
   * Turns the weekly digest off from the link carried by every digest email.
   * Unauthenticated by design — the opaque token is the only credential a
   * mail client can present.
   */
  @Post('/digest/unsubscribe')
  public async unsubscribeFromDigest(
    @Body() body: UnsubscribeBody,
  ): Promise<UnsubscribeResponse | YouTubeErrorResponse> {
    const ok = await youTubeDigestService.unsubscribe(body.token);
    if (!ok) {
      this.setStatus(404);
      return { message: 'Unknown unsubscribe link.' };
    }
    return { ok: true };
  }

  /**
   * Cron-only endpoint: runs one bounded pass of the metadata sync worker.
   * Authenticated via X-Cron-Secret header instead of JWT.
   */
  @Post('/cron/sync')
  @Security('cron-secret')
  public async cronSync(): Promise<CronSyncResponse | YouTubeErrorResponse> {
    if (!isYouTubeAvailable()) {
      return {
        ran: false,
        processed: 0,
        usersSynced: 0,
        failed: 0,
        done: true,
      };
    }
    const result = await youTubeSyncWorkerService.runSyncWorker();
    return {
      ran: result.ran,
      processed: result.processed,
      usersSynced: result.usersSynced,
      failed: result.failed,
      done: result.done,
    };
  }

  /**
   * Cron-only endpoint: runs one bounded pass of the weekly digest worker.
   * Separate from `/cron/sync` so neither job can starve or fail the other.
   */
  @Post('/cron/digest')
  @Security('cron-secret')
  public async cronDigest(): Promise<
    CronDigestResponse | YouTubeErrorResponse
  > {
    if (!isYouTubeAvailable()) {
      return {
        ran: false,
        processed: 0,
        sent: 0,
        skippedEmpty: 0,
        notDue: 0,
        duplicates: 0,
        failed: 0,
        done: true,
      };
    }
    const result = await youTubeDigestService.runDigestWorker();
    return {
      ran: result.ran,
      processed: result.processed,
      sent: result.sent,
      skippedEmpty: result.skippedEmpty,
      notDue: result.notDue,
      duplicates: result.duplicates,
      failed: result.failed,
      done: result.done,
    };
  }
}

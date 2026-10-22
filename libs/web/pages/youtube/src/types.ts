// Types shared across YouTube components
export interface YouTubeVideo {
  id: string;
  videoId: string;
  channelId: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string;
  channelTitle?: string;
  description?: string;
  watched: boolean;
  /** Runtime in seconds, or null for uploads cached before duration collection. */
  durationSeconds?: number | null;
  /**
   * Whether this Cached Upload is a Short, classified server-side from its
   * runtime. Unclassified uploads are never Shorts, so a sync gap leaves a
   * video on the long-form home rather than hiding it behind the daily budget.
   */
  isShort?: boolean;
}

export interface YouTubeSubscription {
  id: string;
  channelId: string;
  channelTitle: string;
  channelThumbnail: string | null;
  uploadsPlaylistId: string;
  enabled: boolean;
  lastSyncedAt: string | null;
}

export interface ChannelCarousel {
  channelId: string;
  channelTitle: string;
  channelThumbnail: string | null;
  videos: YouTubeVideo[];
}

export interface NotificationSettings {
  /** Whether the User has opted in to the weekly New-only digest. */
  enabled: boolean;
  lastNotifiedAt: string | null;
  /** Preferred send day in the User's own week, 0 = Sunday .. 6 = Saturday. */
  preferredWeekday: number;
  /** IANA time zone the weekday is evaluated in. Null means UTC. */
  timeZone: string | null;
}

export type SortOption = 'latest' | 'oldest' | 'az';

export interface FailingChannelInfo {
  channelId: string;
  channelTitle: string;
  error: string;
}

export interface SyncProgressInfo {
  total: number; // Enabled Channels in this Upload Sync
  processed: number;
  succeeded: number;
  failed: number;
  startedAt: string; // ISO timestamp — the run stamp
  failedChannels: FailingChannelInfo[];
}

export interface YouTubeSyncStatus {
  status:
    | 'never'
    | 'discovering'
    | 'running'
    | 'success'
    | 'partial'
    | 'failed'
    | 'quota_exceeded'
    | 'cooldown';
  lastSyncedAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncError: string | null;
  retryAt: string | null;
  channelStatus:
    | 'never'
    | 'discovering'
    | 'success'
    | 'failed'
    | 'quota_exceeded'
    | 'cooldown';
  channelLastAttemptAt: string | null;
  channelLastError: string | null;
  channelRetryAt: string | null;
  /**
   * Progress data is non-null while a run is live AND on the terminal read of
   * `partial`, `failed`, and `quota_exceeded`; it is null on `success` and `never`.
   * This field is a hand-maintained duplicate of the generated `SyncStatusResponse.progress`
   * in libs/app-api-client and must be kept in step with it.
   */
  progress: SyncProgressInfo | null;
}

export interface YouTubeSyncResult extends YouTubeSyncStatus {
  synced: number;
  videosSynced: number;
}

export interface YouTubeChannelSyncResult {
  synced: number;
  status: YouTubeSyncStatus['channelStatus'];
  lastAttemptAt: string | null;
  lastError: string | null;
  retryAt: string | null;
}

/** The YouTube layout split: desktop markup, or the phone markup below the 768px shell breakpoint. */
export type YouTubeLayoutVariant = 'desktop' | 'phone';

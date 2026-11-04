'use client';

import {
  GetVideosKindEnum,
  GetVideosSortEnum,
  type YouTubeApi,
} from '@myorganiser/app-api-client';
import { requestYouTubeAvailabilityRecheck } from '@myorganiser/web-youtube';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createYouTubeApi } from '../lib/youtubeApi';
import { didSyncRequestRun } from '../lib/syncProgress';
import type {
  ChannelCarousel,
  NotificationSettings,
  SortOption,
  YouTubeSubscription,
  YouTubeVideo,
  YouTubeChannelSyncResult,
  YouTubeSyncResult,
  YouTubeSyncStatus,
} from '../types';

// Helper: centralize cooldown derivation & formatting so UI components
// and other hooks use a single authoritative implementation.
export function isRetryCooldownActive(retryAt?: string | null) {
  if (!retryAt) return false;
  const t = Date.parse(retryAt);
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

export function formatRetryAt(retryAt?: string | null) {
  if (!retryAt) return null;
  const d = new Date(retryAt);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

export { useVideoQueue, QUEUE_CAP } from './useVideoQueue';
export type { VideoQueue } from './useVideoQueue';
export { useYouTubeAvailability } from '@myorganiser/web-youtube';

export { useShortsBudget } from './useShortsBudget';
export type { ShortsBudget } from './useShortsBudget';
export {
  MIN_SHORTS_LIMIT_MINUTES,
  MAX_SHORTS_LIMIT_MINUTES,
  formatShortsDuration,
} from '../lib/shortsBudget';

export class YouTubeRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'YouTubeRequestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Turns whatever the generated client rejects with into a
 * `YouTubeRequestError`. The auth axios instance has already refreshed the
 * token and replayed a 401 once, so an error here is final.
 */
function toRequestError(err: unknown): unknown {
  if (!isAxiosError(err) || !err.response) return err;
  const { status, data } = err.response;
  const body = (data ?? {}) as { message?: string; code?: string };
  // A 404 may mean YouTube was taken away from this open page (ADR 0129);
  // only the availability check can tell, so ask every page to make it.
  if (status === 404) requestYouTubeAvailabilityRecheck();
  return new YouTubeRequestError(
    body.message ?? `Request failed: ${status}`,
    status,
    body.code,
  );
}

/**
 * Runs one call on the generated `YouTubeApi` and returns its body as `T`.
 * The generated response types collapse the backend's success/error unions to
 * the error shape, so the caller names the success body.
 */
async function callApi<T>(
  call: (api: YouTubeApi) => Promise<{ data: unknown }>,
): Promise<T> {
  const api = createYouTubeApi();
  try {
    return (await call(api)).data as T;
  } catch (err) {
    throw toRequestError(err);
  }
}

export function useYouTubeStatus() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('loading');
  const didMount = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await callApi<{ connected: boolean; status: string }>(
        (api) => api.getConnectionStatus(),
      );
      setConnected(data.connected);
      setStatus(data.status);
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      callApi<{ connected: boolean; status: string }>((api) =>
        api.getConnectionStatus(),
      )
        .then((data) => {
          setConnected(data.connected);
          setStatus(data.status);
        })
        .catch(() => setStatus('error'));
    }
  }, []);

  return { connected, status, refresh };
}

export function useYouTubeSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<YouTubeSubscription[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callApi<YouTubeSubscription[]>((api) =>
        api.getSubscriptions(),
      );
      setSubscriptions(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      await callApi((api) =>
        api.toggleSubscription({
          subscriptionId: id,
          toggleSubscriptionRequest: { enabled },
        }),
      );
      await fetch_();
    },
    [fetch_],
  );

  useEffect(() => {
    void fetch_();
  }, [fetch_]);

  return { subscriptions, loading, toggle, refresh: fetch_ };
}

export function useYouTubeVideos(channelId?: string) {
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortOption>('latest');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callApi<{
        videos: YouTubeVideo[];
        total: number;
        totalPages: number;
      }>((api) =>
        api.getVideos({
          sort: sort as GetVideosSortEnum,
          page,
          limit: 24,
          // Long-form surfaces exclude Shorts: short-form is isolated on its
          // own budgeted page (PRD #264, user story 14), so it must not
          // reappear in the channel grid or a channel's detail list.
          kind: GetVideosKindEnum.Long,
          ...(search ? { search } : {}),
          ...(channelId ? { channelId } : {}),
        }),
      );
      setVideos(data.videos);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } finally {
      setLoading(false);
    }
  }, [sort, search, page, channelId]);

  useEffect(() => {
    void fetch_();
  }, [fetch_]);

  const updateWatched = useCallback((videoId: string, watched: boolean) => {
    setVideos((prev) =>
      prev.map((v) => (v.videoId === videoId ? { ...v, watched } : v)),
    );
  }, []);

  return {
    videos,
    total,
    totalPages,
    loading,
    sort,
    setSort,
    search,
    setSearch,
    page,
    setPage,
    updateWatched,
    refresh: fetch_,
  };
}

/**
 * Cached Uploads that are Shorts, for the separate Shorts page.
 *
 * Shorts arrive in the ordinary uploads playlist, so they are not a separate
 * resource — the server slices the same library by runtime via `kind=short`.
 * Filtering server-side keeps the page from downloading a full library to throw
 * most of it away, and keeps one classification rule rather than two.
 */
export function useYouTubeShorts() {
  const [shorts, setShorts] = useState<YouTubeVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callApi<{ videos: YouTubeVideo[] }>((api) =>
        api.getVideos({
          sort: GetVideosSortEnum.Latest,
          page: 1,
          limit: 50,
          kind: GetVideosKindEnum.Short,
        }),
      );
      setShorts(data.videos);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch_();
  }, [fetch_]);

  const updateWatched = useCallback((videoId: string, watched: boolean) => {
    setShorts((prev) =>
      prev.map((v) => (v.videoId === videoId ? { ...v, watched } : v)),
    );
  }, []);

  return { shorts, loading, error, updateWatched, refresh: fetch_ };
}

export function useYouTubeCarousel() {
  const [channels, setChannels] = useState<ChannelCarousel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callApi<ChannelCarousel[]>((api) =>
        api.getVideosCarousel(),
      );
      setChannels(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch_();
  }, [fetch_]);

  const updateWatched = useCallback((videoId: string, watched: boolean) => {
    setChannels((prev) =>
      prev.map((channel) => ({
        ...channel,
        videos: channel.videos.map((v) =>
          v.videoId === videoId ? { ...v, watched } : v,
        ),
      })),
    );
  }, []);

  return { channels, loading, error, updateWatched, refresh: fetch_ };
}

export function useYouTubeNotifications() {
  const [settings, setSettings] = useState<NotificationSettings>({
    // The digest is opt-in, so assume off until the server says otherwise.
    enabled: false,
    lastNotifiedAt: null,
    preferredWeekday: 1,
    timeZone: null,
  });
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    try {
      const data = await callApi<NotificationSettings>((api) =>
        api.getNotificationSettings(),
      );
      setSettings(data);
    } catch {
      // Use defaults
    }
  }, []);

  const update = useCallback(async (data: Partial<NotificationSettings>) => {
    setLoading(true);
    try {
      const result = await callApi<NotificationSettings>((api) =>
        api.updateNotificationSettings({ notificationSettingsBody: data }),
      );
      setSettings(result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch_();
  }, [fetch_]);

  return { settings, loading, update };
}

export interface YouTubeDisconnectResponse {
  ok: boolean;
  message: string;
  revokeFailed?: boolean;
  googlePermissionsUrl?: string;
}

export function useYouTubeConnect() {
  const connect = useCallback(async () => {
    const data = await callApi<{ url: string }>((api) => api.getAuthUrl());
    window.location.href = data.url;
  }, []);

  const disconnect = useCallback(async () => {
    return callApi<YouTubeDisconnectResponse>((api) => api.disconnect());
  }, []);

  return { connect, disconnect };
}

export interface YouTubeAcknowledgementState {
  /** `null` until the first read succeeds, and after a failed read. */
  acknowledged: boolean | null;
  /** True until the first read settles. */
  loading: boolean;
  error: string | null;
  /**
   * Stores the one-time acknowledgement (ADR 0129). Rejects if the server does
   * not store it, so the caller can keep the connect action usable.
   */
  accept: () => Promise<void>;
}

/**
 * The User's one-time acknowledgement before a first connect (ADR 0129).
 *
 * The server refuses the authorization address until the acknowledgement is
 * stored, so a failed read is treated as not acknowledged by the caller.
 */
export function useYouTubeAcknowledgement(): YouTubeAcknowledgementState {
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callApi<{ acknowledgedAt: string | null }>((api) =>
        api.getAcknowledgement(),
      );
      setAcknowledged(Boolean(data.acknowledgedAt));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch_();
  }, [fetch_]);

  const accept = useCallback(async () => {
    await callApi<{ acknowledgedAt: string }>((api) =>
      api.acceptAcknowledgement(),
    );
    setAcknowledged(true);
  }, []);

  return { acknowledged, loading, error, accept };
}

/**
 * Uploads fetched per channel when expanding past the channel list cap.
 * Sync keeps the latest 100 per channel, so one page covers the whole
 * snapshot and there is never a second round.
 */
export const CHANNEL_UPLOAD_PAGE_SIZE = 100;

export interface ChannelUploadExpansion {
  /** Full upload lists, keyed by channel id, for channels already expanded. */
  uploadsByChannel: Record<string, YouTubeVideo[]>;
  /** Channels whose expansion is in flight. */
  loadingChannelIds: ReadonlySet<string>;
  /** Channels known to hold nothing further. */
  fullyLoadedChannelIds: ReadonlySet<string>;
  error: string | null;
  loadChannel: (channelId: string) => void;
  /** Mirrors a Watched change into any expanded list holding that upload. */
  updateWatched: (videoId: string, watched: boolean) => void;
}

/**
 * On-demand expansion of one channel past the channel list's cap.
 *
 * The channel list endpoint returns a bounded slice per channel so the home
 * page does not download every account's whole library on load. That slice is
 * the doom-scroll guardrail working as intended, but it also has to be
 * escapable: a digest can name an upload older than the slice, and the
 * end-of-list disclosure would otherwise be lying about what is cached.
 *
 * Expansion is per channel and sticky for the life of the page — re-selecting
 * an expanded channel does not refetch.
 */
export function useChannelUploads(): ChannelUploadExpansion {
  const [uploadsByChannel, setUploadsByChannel] = useState<
    Record<string, YouTubeVideo[]>
  >({});
  const [loadingChannelIds, setLoadingChannelIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [fullyLoadedChannelIds, setFullyLoadedChannelIds] = useState<
    Set<string>
  >(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef<Set<string>>(new Set());

  const loadChannel = useCallback((channelId: string) => {
    if (inFlightRef.current.has(channelId)) return;
    inFlightRef.current.add(channelId);

    setError(null);
    setLoadingChannelIds((prev) => new Set(prev).add(channelId));

    void callApi<{ videos: YouTubeVideo[]; total: number }>((api) =>
      api.getVideos({
        sort: GetVideosSortEnum.Latest,
        page: 1,
        limit: CHANNEL_UPLOAD_PAGE_SIZE,
        // Shorts stay on their own budgeted page (PRD #264, user story 14)
        // and must not leak back into a long-form channel list.
        kind: GetVideosKindEnum.Long,
        channelId,
      }),
    )
      .then((data) => {
        setUploadsByChannel((prev) => ({ ...prev, [channelId]: data.videos }));
        // One page covers the whole snapshot, so this channel is done unless
        // the server somehow held more than a page.
        if (data.videos.length >= data.total) {
          setFullyLoadedChannelIds((prev) => new Set(prev).add(channelId));
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        inFlightRef.current.delete(channelId);
        setLoadingChannelIds((prev) => {
          const next = new Set(prev);
          next.delete(channelId);
          return next;
        });
      });
  }, []);

  const updateWatched = useCallback((videoId: string, watched: boolean) => {
    setUploadsByChannel((prev) => {
      let changed = false;
      const next: Record<string, YouTubeVideo[]> = {};
      for (const [channelId, videos] of Object.entries(prev)) {
        if (!videos.some((v) => v.videoId === videoId)) {
          next[channelId] = videos;
          continue;
        }
        changed = true;
        next[channelId] = videos.map((v) =>
          v.videoId === videoId ? { ...v, watched } : v,
        );
      }
      return changed ? next : prev;
    });
  }, []);

  return {
    uploadsByChannel,
    loadingChannelIds,
    fullyLoadedChannelIds,
    error,
    loadChannel,
    updateWatched,
  };
}

/**
 * What differs between the User's Upload Sync and Channel Sync requests: the
 * endpoint, which cooldown guards it, and where each side carries the attempt
 * stamp `didSyncRequestRun` compares (#753).
 */
interface SyncRequest<R> {
  send: (api: YouTubeApi) => Promise<{ data: unknown }>;
  disabledLabel: string;
  retryAt: (status: YouTubeSyncStatus) => string | null;
  attemptAtBefore: (status: YouTubeSyncStatus) => string | null;
  attemptAtAfter: (result: R) => string | null;
}

const UPLOAD_SYNC_REQUEST: SyncRequest<YouTubeSyncResult> = {
  send: (api) => api.syncUploads(),
  disabledLabel: 'Sync disabled',
  retryAt: (status) => status.retryAt,
  attemptAtBefore: (status) => status.lastSyncAttemptAt,
  attemptAtAfter: (result) => result.lastSyncAttemptAt,
};

const CHANNEL_SYNC_REQUEST: SyncRequest<YouTubeChannelSyncResult> = {
  send: (api) => api.syncSubscriptions(),
  disabledLabel: 'Refresh channels disabled',
  retryAt: (status) => status.channelRetryAt,
  attemptAtBefore: (status) => status.channelLastAttemptAt,
  attemptAtAfter: (result) => result.lastAttemptAt,
};

export function useYouTubeSyncStatus() {
  const [status, setStatus] = useState<
    import('../types').YouTubeSyncStatus | null
  >(null);
  const [loading, setLoading] = useState(false);
  const didMount = useRef(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callApi<import('../types').YouTubeSyncStatus>((api) =>
        api.getSyncStatus(),
      );
      setStatus(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, []);

  const sendSyncRequest = useCallback(
    async <R extends { status: YouTubeSyncStatus['status'] }>(
      request: SyncRequest<R>,
    ) => {
      setLoading(true);
      try {
        // Fetch the authoritative sync-status for the cooldown guard and for
        // the attempt stamp the response is compared against (#753) only.
        // This read happens before the PUT is sent, so it is always stale — do
        // not publish it as the component's current status. Publishing a stale
        // observation can overwrite a live status if another fetch happens to
        // resolve afterward, which would kill the poll loop. The component
        // will poll for the actual live status after the PUT is sent.
        const latest = await callApi<YouTubeSyncStatus>((api) =>
          api.getSyncStatus(),
        );
        const retryAt = request.retryAt(latest);
        if (isRetryCooldownActive(retryAt)) {
          throw new Error(
            `${request.disabledLabel} until ${formatRetryAt(retryAt) ?? retryAt}`,
          );
        }

        // The request resolves once the run has finished (ADR 0080), so its
        // result is the completion signal for a run the User started (#753).
        const result = await callApi<R>(request.send);

        // A failed re-read must not hide a run that did work.
        await fetch_().catch(() => undefined);
        return didSyncRequestRun(
          result.status,
          request.attemptAtBefore(latest),
          request.attemptAtAfter(result),
        );
      } finally {
        setLoading(false);
      }
    },
    [fetch_],
  );

  const triggerUploadSync = useCallback(
    () => sendSyncRequest(UPLOAD_SYNC_REQUEST),
    [sendSyncRequest],
  );

  const triggerChannelSync = useCallback(
    () => sendSyncRequest(CHANNEL_SYNC_REQUEST),
    [sendSyncRequest],
  );

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      void fetch_();
    }
  }, [fetch_]);

  const isCooldownActive = !!(status && isRetryCooldownActive(status.retryAt));
  const isChannelCooldownActive = !!(
    status && isRetryCooldownActive(status.channelRetryAt)
  );

  return {
    status,
    loading,
    refresh: fetch_,
    triggerUploadSync,
    triggerChannelSync,
    isCooldownActive,
    isChannelCooldownActive,
  };
}

export async function updateVideoWatched(
  videoId: string,
  watched: boolean,
): Promise<{ ok: boolean; watched: boolean }> {
  return callApi<{ ok: boolean; watched: boolean }>((api) =>
    api.setVideoWatched({ videoId, watchedBody: { watched } }),
  );
}

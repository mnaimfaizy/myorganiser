'use client';

import { Button, cn, useIsMobileState } from '@myorganiser/web-ui';
import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import {
  formatRetryAt,
  useChannelUploads,
  useVideoQueue,
  useYouTubeAvailability,
  useYouTubeCarousel,
  useYouTubeConnect,
  useYouTubeStatus,
  useYouTubeSubscriptions,
  useYouTubeSyncStatus,
} from '../hooks';
import { useYouTubeSyncPoll } from '../hooks/useYouTubeSyncPoll';
import { describeSyncFreshness } from '../lib/syncFreshness';
import { isRunLive } from '../lib/syncProgress';
import { ChannelDirectory } from './ChannelDirectory';
import { QueueRail } from './QueueRail';
import { SyncFreshnessIndicator } from './SyncFreshnessIndicator';
import { SyncProgressPanel } from './SyncProgressPanel';
import { YouTubeConnectPrompt } from './YouTubeConnectPrompt';
import { YouTubePageHeader } from './YouTubePageHeader';
import { YouTubeSectionNav } from './YouTubeSectionNav';
import { YouTubeUnavailableNotice } from './YouTubeUnavailableNotice';

export function YouTubePageClient() {
  const { available, error: availabilityError } = useYouTubeAvailability();

  // Availability gate — fail closed. The connection and data hooks live below
  // it, so a User without YouTube Access makes no YouTube request at all.
  if (available !== true) {
    return (
      <YouTubeUnavailableNotice
        reason={availabilityError ? 'unreachable' : 'unavailable'}
      />
    );
  }

  return <YouTubeConnectionState />;
}

function YouTubeConnectionState() {
  const { connected, status } = useYouTubeStatus();
  const { connect } = useYouTubeConnect();

  if (status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-body text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!connected) {
    return (
      <YouTubeConnectPrompt
        onConnect={connect}
        statusMessage={
          status === 'revoked'
            ? 'Your previous connection was revoked. Please reconnect.'
            : undefined
        }
      />
    );
  }

  return <ConnectedDashboard />;
}

function ConnectedDashboard() {
  // Digest mail and the subscription list deep-link a channel here. Read once
  // as the directory's initial selection rather than driving it from the URL,
  // so the User's own clicks are not fighting a stale query string.
  const deepLinkedChannelId = useSearchParams().get('channel');
  const isPhone = useIsMobileState() === true;
  const subs = useYouTubeSubscriptions();
  const carouselData = useYouTubeCarousel();
  const syncStatus = useYouTubeSyncStatus();
  const [syncError, setSyncError] = useState<string | null>(null);

  const syncBusy = isRunLive(syncStatus.status);
  const isCooldownActive = !!syncStatus.isCooldownActive;

  const refreshSync = syncStatus.refresh;
  const triggerUploadSync = syncStatus.triggerUploadSync;
  const syncStatusValue = syncStatus.status;

  const handleRunComplete = useCallback(async () => {
    setSyncError(null);
    const results = await Promise.allSettled([
      subs.refresh(),
      carouselData.refresh(),
    ]);
    const hadFailure = results.some((r) => r.status === 'rejected');
    if (hadFailure) {
      setSyncError('Refresh failed — showing cached data');
    }
  }, [subs, carouselData]);

  const { runUserSync } = useYouTubeSyncPoll(syncStatus.status, {
    poll: refreshSync,
    onRunComplete: handleRunComplete,
  });

  const channelUploads = useChannelUploads();

  const channels = useMemo(
    () =>
      carouselData.channels.map((channel) => {
        const expanded = channelUploads.uploadsByChannel[channel.channelId];
        return expanded ? { ...channel, videos: expanded } : channel;
      }),
    [carouselData.channels, channelUploads.uploadsByChannel],
  );

  const library = useMemo(
    () => channels.flatMap((channel) => channel.videos),
    [channels],
  );

  const queue = useVideoQueue(library);

  const [playbackOwner, setPlaybackOwner] = useState<'directory' | 'queue'>(
    'directory',
  );

  const handleDirectoryPlaybackClaim = useCallback(() => {
    setPlaybackOwner('directory');
    queue.stop();
  }, [queue]);

  const handleQueuePlaybackClaim = useCallback(() => {
    setPlaybackOwner('queue');
  }, []);

  const handleWatchedToggle = useCallback(
    (videoId: string, watched: boolean) => {
      carouselData.updateWatched(videoId, watched);
      channelUploads.updateWatched(videoId, watched);
    },
    [carouselData, channelUploads],
  );

  const handleSync = useCallback(() => {
    if (isCooldownActive || syncBusy) return;

    if (syncStatusValue?.retryAt) {
      const retryTime = Date.parse(syncStatusValue.retryAt);
      if (!Number.isNaN(retryTime) && retryTime > Date.now()) {
        return;
      }
    }

    void runUserSync(triggerUploadSync);
  }, [
    isCooldownActive,
    syncBusy,
    triggerUploadSync,
    syncStatusValue,
    runUserSync,
  ]);

  const handleDirectoryRetry = useCallback(() => {
    carouselData.refresh();
  }, [carouselData]);

  const uploadSyncDisabled =
    carouselData.loading || syncStatus.loading || syncBusy || isCooldownActive;

  const syncSpinning = carouselData.loading || syncStatus.loading || syncBusy;

  const retryLabel =
    isCooldownActive && syncStatus.status?.retryAt
      ? (formatRetryAt(syncStatus.status.retryAt) ?? syncStatus.status.retryAt)
      : null;

  const syncButtonLabel = retryLabel
    ? `Sync uploads disabled until ${retryLabel}`
    : 'Sync uploads';

  const showNoChannelsNote = !subs.loading && subs.subscriptions.length === 0;

  const showNeverSyncedNote =
    !subs.loading &&
    subs.subscriptions.length > 0 &&
    syncStatus.status?.status === 'never';

  const newUploadCount = library.filter((video) => !video.watched).length;
  const channelCount = channels.length;
  const subtitle = [
    describeSyncFreshness(syncStatus.status).lastSyncedLabel,
    `${channelCount} ${channelCount === 1 ? 'channel' : 'channels'}`,
    newUploadCount > 0
      ? `${newUploadCount} new ${newUploadCount === 1 ? 'upload' : 'uploads'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const syncButton = isPhone ? (
    <Button
      variant="outline"
      size="icon"
      onClick={handleSync}
      disabled={uploadSyncDisabled}
      aria-label={syncButtonLabel}
      title={syncButtonLabel}
    >
      <RefreshCw
        className={cn(
          syncSpinning && 'animate-spin motion-reduce:animate-none',
        )}
      />
    </Button>
  ) : (
    <Button
      variant="outline"
      onClick={handleSync}
      disabled={uploadSyncDisabled}
      aria-label={syncButtonLabel}
      title={syncButtonLabel}
    >
      <RefreshCw
        className={cn(
          syncSpinning && 'animate-spin motion-reduce:animate-none',
        )}
      />
      Sync uploads
    </Button>
  );

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 pb-4 pt-0 md:mx-auto md:w-full md:max-w-[1240px] md:p-8">
      <div className="flex flex-col gap-3">
        <YouTubePageHeader
          title="YouTube"
          subtitle={subtitle}
          actions={syncButton}
          variant={isPhone ? 'phone' : 'desktop'}
        />
        <SyncFreshnessIndicator status={syncStatus.status} variant="inline" />
      </div>

      <YouTubeSectionNav
        current="videos"
        variant={isPhone ? 'phone' : 'desktop'}
        channelCount={subs.loading ? null : subs.subscriptions.length}
      />

      {showNoChannelsNote && (
        <div role="status" className="text-body-sm text-muted-foreground">
          No channels yet.{' '}
          <Link
            href="/dashboard/youtube/channels"
            className="font-semibold text-brand-text underline"
          >
            Refresh channels
          </Link>
        </div>
      )}
      {showNeverSyncedNote && (
        <div role="status" className="text-body-sm text-muted-foreground">
          Uploads have not been synced yet. Sync uploads caches the latest 100
          from each enabled channel.
        </div>
      )}
      {syncStatus.status && <SyncProgressPanel status={syncStatus.status} />}
      {syncError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-control border border-destructive-edge bg-destructive-faint p-3 text-body-sm text-destructive-text"
        >
          {syncError}
        </div>
      )}

      <QueueRail
        queue={queue}
        onWatchedToggle={handleWatchedToggle}
        onPlaybackClaim={handleQueuePlaybackClaim}
      >
        {({ player, rail, disclosure }) => (
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex min-w-0 flex-[999_1_540px] flex-col gap-5">
              {player}
              <div className="md:hidden">{disclosure}</div>
              <ChannelDirectory
                channels={channels}
                loading={carouselData.loading}
                error={carouselData.error}
                onRetry={handleDirectoryRetry}
                onWatchedToggle={handleWatchedToggle}
                onAddToQueue={queue.add}
                isQueued={queue.isQueued}
                queueFull={queue.isFull}
                playbackSuspended={playbackOwner !== 'directory'}
                onPlaybackClaim={handleDirectoryPlaybackClaim}
                initialChannelId={deepLinkedChannelId}
                onLoadMoreUploads={channelUploads.loadChannel}
                loadingMoreChannelIds={channelUploads.loadingChannelIds}
                fullyLoadedChannelIds={channelUploads.fullyLoadedChannelIds}
              />
            </div>
            <div className="hidden md:sticky md:top-4 md:block md:flex-[1_1_300px] md:self-start rounded-panel border border-border bg-raised-surface p-4">
              {rail}
            </div>
          </div>
        )}
      </QueueRail>
    </div>
  );
}

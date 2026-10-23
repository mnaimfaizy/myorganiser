'use client';

import { useIsMobileState } from '@myorganiser/web-ui';
import { useCallback, useState } from 'react';
import {
  useYouTubeAvailability,
  useYouTubeConnect,
  useYouTubeStatus,
  useYouTubeSubscriptions,
  useYouTubeSyncStatus,
  YouTubeRequestError,
} from '../hooks';
import { useYouTubeSyncPoll } from '../hooks/useYouTubeSyncPoll';
import { isRunLive } from '../lib/syncProgress';
import { DisconnectYouTubeDialog } from './DisconnectYouTubeDialog';
import { SubscriptionManager } from './SubscriptionManager';
import { YouTubeConnectPrompt } from './YouTubeConnectPrompt';
import { YouTubeSectionNav } from './YouTubeSectionNav';
import { YouTubeUnavailableNotice } from './YouTubeUnavailableNotice';

export function YouTubeChannelsPageClient() {
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

  return <YouTubeChannelsConnectionState />;
}

function YouTubeChannelsConnectionState() {
  const { connected, status, refresh: refreshStatus } = useYouTubeStatus();
  const { connect } = useYouTubeConnect();
  const [disconnectNotice, setDisconnectNotice] = useState<{
    message: string;
    googlePermissionsUrl: string;
  } | null>(null);

  const disconnectNoticeBanner =
    disconnectNotice === null ? null : (
      <div
        role="status"
        className="mx-4 mt-4 rounded-panel border border-border bg-raised-surface p-4 text-body-sm text-foreground-supporting"
      >
        {disconnectNotice.message}{' '}
        <a
          href={disconnectNotice.googlePermissionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-brand-text underline"
        >
          Manage Google permissions
        </a>
      </div>
    );

  if (status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!connected) {
    return (
      <>
        {disconnectNoticeBanner}
        <YouTubeConnectPrompt
          onConnect={connect}
          statusMessage={
            status === 'revoked'
              ? 'Your previous connection was revoked. Please reconnect.'
              : undefined
          }
        />
      </>
    );
  }

  return (
    <>
      {disconnectNoticeBanner}
      <ConnectedChannelsDashboard
        refreshStatus={refreshStatus}
        onDisconnectNotice={setDisconnectNotice}
      />
    </>
  );
}

interface ConnectedChannelsDashboardProps {
  refreshStatus: () => Promise<void>;
  onDisconnectNotice: (
    notice: { message: string; googlePermissionsUrl: string } | null,
  ) => void;
}

function ConnectedChannelsDashboard({
  refreshStatus,
  onDisconnectNotice,
}: ConnectedChannelsDashboardProps) {
  const { disconnect } = useYouTubeConnect();
  const subs = useYouTubeSubscriptions();
  const syncStatus = useYouTubeSyncStatus();
  const isMobile = useIsMobileState();
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const syncBusy = isRunLive(syncStatus.status);
  const disconnectDisabledReason = syncBusy
    ? 'Disconnect unavailable while a sync is running'
    : undefined;

  const isChannelCooldownActive = !!syncStatus.isChannelCooldownActive;

  const refreshSync = syncStatus.refresh;
  const triggerChannelSync = syncStatus.triggerChannelSync;

  const handleRunComplete = useCallback(async () => {
    await subs.refresh();
  }, [subs]);

  const { runUserSync, waitingForClaim } = useYouTubeSyncPoll(
    syncStatus.status,
    {
      poll: refreshSync,
      onRunComplete: handleRunComplete,
    },
  );

  const channelSyncInFlight =
    waitingForClaim || syncStatus.status?.channelStatus === 'discovering';

  const handleChannelSync = useCallback(() => {
    if (isChannelCooldownActive || syncBusy) return;

    void runUserSync(triggerChannelSync);
  }, [isChannelCooldownActive, syncBusy, triggerChannelSync, runUserSync]);

  const handleRequestDisconnect = useCallback(() => {
    setDisconnectError(null);
    setDisconnectDialogOpen(true);
  }, []);

  const handleDisconnectDialogOpenChange = useCallback((open: boolean) => {
    setDisconnectDialogOpen(open);
    if (!open) {
      setDisconnectError(null);
    }
  }, []);

  const handleConfirmDisconnect = useCallback(async () => {
    setDisconnectError(null);
    try {
      const result = await disconnect();
      setDisconnectDialogOpen(false);
      await refreshStatus();
      if (result.revokeFailed && result.googlePermissionsUrl) {
        onDisconnectNotice({
          message: result.message,
          googlePermissionsUrl: result.googlePermissionsUrl,
        });
      } else {
        onDisconnectNotice(null);
      }
    } catch (err: unknown) {
      const message =
        err instanceof YouTubeRequestError && err.code === 'sync_run_live'
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Disconnect failed';
      setDisconnectError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }, [disconnect, onDisconnectNotice, refreshStatus]);

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-4 pb-8 pt-4 md:p-8">
      <h1 className="sr-only">Channels</h1>
      <YouTubeSectionNav
        current="channels"
        channelCount={subs.loading ? null : subs.subscriptions.length}
        variant={isMobile === true ? 'phone' : 'desktop'}
      />

      <SubscriptionManager
        subscriptions={subs.subscriptions}
        loading={subs.loading || channelSyncInFlight}
        onSync={handleChannelSync}
        onToggle={subs.toggle}
        onRequestDisconnect={handleRequestDisconnect}
        disconnectDisabled={syncBusy}
        disconnectDisabledReason={disconnectDisabledReason}
        syncRetryAt={syncStatus.status?.channelRetryAt}
        syncBusy={syncBusy}
      />

      <DisconnectYouTubeDialog
        open={disconnectDialogOpen}
        onOpenChange={handleDisconnectDialogOpenChange}
        onConfirm={handleConfirmDisconnect}
        error={disconnectError}
      />
    </div>
  );
}

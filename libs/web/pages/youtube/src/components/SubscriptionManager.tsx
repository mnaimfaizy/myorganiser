'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatRetryAt, isRetryCooldownActive } from '../hooks';
import type { YouTubeSubscription } from '../types';
import { ChannelsAside } from './ChannelsAside';
import { ChannelsListCard, type ChannelFilter } from './ChannelsListCard';

interface SubscriptionManagerProps {
  subscriptions: YouTubeSubscription[];
  loading: boolean;
  onSync: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRequestDisconnect: () => void;
  disconnectDisabled?: boolean;
  disconnectDisabledReason?: string;
  syncRetryAt?: string | null;
  syncBusy?: boolean;
}

export function SubscriptionManager({
  subscriptions,
  loading,
  onSync,
  onToggle,
  onRequestDisconnect,
  disconnectDisabled = false,
  disconnectDisabledReason,
  syncRetryAt,
  syncBusy = false,
}: SubscriptionManagerProps) {
  const router = useRouter();
  const [filterText, setFilterText] = useState('');
  const [filter, setFilter] = useState<ChannelFilter>('all');

  const isCooldownActive = !!(
    syncRetryAt && isRetryCooldownActive(syncRetryAt)
  );
  const retryLabel = formatRetryAt(syncRetryAt);
  const refreshBlockedLabel =
    isCooldownActive && retryLabel
      ? `Refresh channels disabled until ${retryLabel}`
      : undefined;

  const enabledCount = subscriptions.filter((sub) => sub.enabled).length;
  const counts = {
    all: subscriptions.length,
    on: enabledCount,
    off: subscriptions.length - enabledCount,
  };

  const needle = filterText.trim().toLowerCase();
  const visibleChannels = subscriptions.filter((sub) => {
    const matchesChip =
      filter === 'all' || (filter === 'on' ? sub.enabled : !sub.enabled);
    const matchesText =
      needle === '' || sub.channelTitle.toLowerCase().includes(needle);
    return matchesChip && matchesText;
  });

  const handleSync = useCallback(() => {
    if (isCooldownActive) return;
    onSync();
  }, [isCooldownActive, onSync]);

  const handleSelectChannel = useCallback(
    (channelId: string) => {
      router.push(
        `/dashboard/youtube?channel=${encodeURIComponent(channelId)}`,
      );
    },
    [router],
  );

  const handleFilterTextChange = useCallback((value: string) => {
    setFilterText(value);
  }, []);

  const handleFilterChange = useCallback((next: ChannelFilter) => {
    setFilter(next);
  }, []);

  return (
    <div className="flex flex-col gap-5 md:flex-row md:flex-wrap md:items-start">
      <ChannelsListCard
        channels={visibleChannels}
        totalCount={subscriptions.length}
        counts={counts}
        filterText={filterText}
        onFilterTextChange={handleFilterTextChange}
        filter={filter}
        onFilterChange={handleFilterChange}
        loading={loading}
        onRefresh={handleSync}
        refreshDisabled={isCooldownActive || syncBusy}
        refreshBlockedLabel={refreshBlockedLabel}
        onSelectChannel={handleSelectChannel}
        onToggle={onToggle}
      />
      <ChannelsAside
        onRequestDisconnect={onRequestDisconnect}
        disconnectDisabled={disconnectDisabled}
        disconnectDisabledReason={disconnectDisabledReason}
      />
    </div>
  );
}

'use client';

import { getAccessToken } from '@myorganiser/auth';
import { getApiBaseUrl } from '@myorganiser/core';
import { useEffect, useState } from 'react';
import { useYouTubeNavVisible } from '../../hooks/useYouTubeNavVisible';
import type { YouTubeHome, YouTubeState, YouTubeVideo } from '../home-view';

interface YouTubeSubscriptionRow {
  enabled: boolean;
}

/**
 * YouTube status, recent uploads and channel count for Home. Gated by the
 * same nav rule as the YouTube page; the data is server-side, so it does not
 * depend on the vault lock.
 */
export function useYouTubeHome(): YouTubeHome {
  const visible = useYouTubeNavVisible();
  const [state, setState] = useState<YouTubeState>({ status: 'loading' });

  useEffect(() => {
    if (!visible) return;

    let isActive = true;

    const base = `${getApiBaseUrl()}/youtube`;
    const token = getAccessToken();
    const init: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    };
    const getJson = <T>(path: string): Promise<T> =>
      fetch(`${base}${path}`, init).then((r) => r.json() as Promise<T>);

    // The channel count is a side read: if it fails or is not a list, it is
    // unknown (null) and the videos still load.
    const readChannelCount = async (): Promise<number | null> => {
      try {
        const rows: unknown = await getJson<unknown>('/subscriptions');
        if (!Array.isArray(rows)) return null;
        return rows.filter((row: YouTubeSubscriptionRow) => row.enabled).length;
      } catch {
        return null;
      }
    };

    getJson<{ connected: boolean }>('/status')
      .then(async (status): Promise<YouTubeState> => {
        if (!status.connected) return { status: 'disconnected' };
        const [videos, channels] = await Promise.all([
          getJson<{ videos?: YouTubeVideo[] }>('/videos?sort=latest&limit=6'),
          readChannelCount(),
        ]);
        return {
          status: 'loaded',
          channels,
          videos: videos.videos ?? [],
        };
      })
      .then((next) => {
        if (isActive) setState(next);
      })
      .catch(() => {
        if (isActive) setState({ status: 'error' });
      });

    return () => {
      isActive = false;
    };
  }, [visible]);

  return { visible, state };
}

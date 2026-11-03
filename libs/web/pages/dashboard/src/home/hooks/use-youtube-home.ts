'use client';

import {
  GetVideosSortEnum,
  type SubscriptionResponse,
} from '@myorganiser/app-api-client';
import { useEffect, useState } from 'react';
import { useYouTubeNavVisible } from '../../hooks/useYouTubeNavVisible';
import { createYouTubeApi } from '../../lib/apiClient';
import type { YouTubeHome, YouTubeState } from '../home-view';

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
    const api = createYouTubeApi();

    // The channel count is a side read: if it fails or is not a list, it is
    // unknown (null) and the videos still load.
    const readChannelCount = async (): Promise<number | null> => {
      try {
        const response = await api.getSubscriptions();
        // The generated response type collapses the backend's
        // `SubscriptionResponse[] | YouTubeErrorResponse` union to the error
        // shape; the success body is really an array.
        const rows = response.data as unknown as SubscriptionResponse[];
        if (!Array.isArray(rows)) return null;
        return rows.filter((row) => row.enabled).length;
      } catch {
        return null;
      }
    };

    api
      .getConnectionStatus()
      .then(async (status): Promise<YouTubeState> => {
        if (!status.data.connected) return { status: 'disconnected' };
        const [videos, channels] = await Promise.all([
          api.getVideos({ sort: GetVideosSortEnum.Latest, limit: 6 }),
          readChannelCount(),
        ]);
        return {
          status: 'loaded',
          channels,
          videos: videos.data.videos,
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

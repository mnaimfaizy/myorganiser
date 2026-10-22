import type {
  AdminUserIdentity,
  YouTubeAccessUsageResponse,
} from '@myorganiser/app-api-client';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';

export interface UseAdminUserResult {
  user: AdminUserIdentity | null;
  /** Replaces the User after a lifecycle action returns the updated identity. */
  setUser: Dispatch<SetStateAction<AdminUserIdentity | null>>;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  youtubeUsage: YouTubeAccessUsageResponse | null;
  youtubeUsageFailed: boolean;
}

/**
 * Loads one User for the detail page, and the YouTube Access usage once the
 * User is known. A missing id reads as not found.
 */
export function useAdminUser(userId: string | undefined): UseAdminUserResult {
  const [user, setUser] = useState<AdminUserIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [youtubeUsage, setYouTubeUsage] =
    useState<YouTubeAccessUsageResponse | null>(null);
  const [youtubeUsageFailed, setYouTubeUsageFailed] = useState(false);

  const youtubeAccess = user?.youtubeAccess;

  const loadYouTubeUsage = useCallback(async () => {
    try {
      const api = createPlatformAdminApi();
      const response = await api.getYouTubeAccessUsage();
      setYouTubeUsage(response.data);
      setYouTubeUsageFailed(false);
    } catch {
      setYouTubeUsage(null);
      setYouTubeUsageFailed(true);
    }
  }, []);

  const loadUser = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const api = createPlatformAdminApi();
      const response = await api.getUserById({ userId: id });
      setUser(response.data);
    } catch (err) {
      setUser(null);

      if (isAxiosError(err) && err.response?.status === 404) {
        setNotFound(true);
      } else {
        setError('Unable to load user. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    void loadUser(userId);
  }, [loadUser, userId]);

  useEffect(() => {
    if (youtubeAccess === undefined) {
      return;
    }

    void loadYouTubeUsage();
  }, [loadYouTubeUsage, youtubeAccess]);

  return {
    user,
    setUser,
    loading,
    notFound,
    error,
    youtubeUsage,
    youtubeUsageFailed,
  };
}

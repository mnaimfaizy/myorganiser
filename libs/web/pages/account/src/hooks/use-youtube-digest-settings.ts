'use client';

import { getAccessToken } from '@myorganiser/auth';
import { detectTimeZone, getApiBaseUrl } from '@myorganiser/core';
import { useToast } from '@myorganiser/web-ui';
import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface YouTubeDigestSettings {
  /** The digest card is shown only when this is true. */
  connected: boolean;
  enabled: boolean;
  setEnabled: Dispatch<SetStateAction<boolean>>;
  weekday: number;
  setWeekday: Dispatch<SetStateAction<number>>;
  saving: boolean;
  /** PATCHes the digest settings. Nothing is sent until this runs. */
  save: () => Promise<void>;
  timeZone: string;
}

/**
 * Weekly YouTube digest settings. Reads on mount (status, then settings when
 * connected); writes only through `save`.
 */
export function useYouTubeDigestSettings(): YouTubeDigestSettings {
  const { toast } = useToast();

  const [enabled, setEnabled] = useState(false);
  const [weekday, setWeekday] = useState(1);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);

  // Fetch YouTube notification settings
  useEffect(() => {
    (async () => {
      try {
        const token = getAccessToken();
        const authHeaders = token
          ? { Authorization: `Bearer ${token}` }
          : undefined;
        const status = await fetch(`${getApiBaseUrl()}/youtube/status`, {
          headers: authHeaders,
          credentials: 'include',
        });
        if (!status.ok) return;
        const statusData = await status.json();
        setConnected(statusData.connected);
        if (!statusData.connected) return;

        const res = await fetch(
          `${getApiBaseUrl()}/youtube/notification-settings`,
          {
            headers: authHeaders,
            credentials: 'include',
          },
        );
        if (!res.ok) return;
        const data = await res.json();
        setEnabled(data.enabled);
        setWeekday(data.preferredWeekday);
      } catch {
        // YouTube not connected or API unavailable
      }
    })();
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const token = getAccessToken();
      const timeZone = detectTimeZone();
      const res = await fetch(
        `${getApiBaseUrl()}/youtube/notification-settings`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({
            enabled,
            preferredWeekday: weekday,
            timeZone,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to save');
      }
      toast({
        title: 'Saved',
        description: 'Weekly digest settings updated.',
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to update digest settings.';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [enabled, weekday, toast]);

  return {
    connected,
    enabled,
    setEnabled,
    weekday,
    setWeekday,
    saving,
    save,
    timeZone: detectTimeZone() || 'UTC',
  };
}

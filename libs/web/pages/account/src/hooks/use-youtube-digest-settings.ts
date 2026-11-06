'use client';

import { detectTimeZone } from '@myorganiser/core';
import { useToast } from '@myorganiser/web-ui';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { createYouTubeApi } from '../lib/apiClient';

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
  /** Why the last load failed, or null when it has not failed. */
  loadError: string | null;
  /** Runs the load again after a failure. */
  retryLoad: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const message = (error.response?.data as { message?: unknown } | undefined)
      ?.message;
    if (typeof message === 'string' && message) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Fetch YouTube notification settings
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createYouTubeApi();
        const { data: status } = await api.getConnectionStatus();
        if (cancelled) return;
        setConnected(status.connected);
        if (!status.connected) {
          setLoadError(null);
          return;
        }

        const { data } = await api.getNotificationSettings();
        if (cancelled) return;
        setEnabled(data.enabled);
        setWeekday(data.preferredWeekday);
        setLoadError(null);
      } catch (error) {
        if (cancelled) return;
        // A 404 is how the backend says YouTube is off or this User has no
        // YouTube Access, so there is no digest to show and nothing failed.
        if (isAxiosError(error) && error.response?.status === 404) {
          setConnected(false);
          setLoadError(null);
          return;
        }
        setLoadError(errorMessage(error, 'Failed to load digest settings.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  const retryLoad = useCallback(() => {
    setLoadError(null);
    setLoadAttempt((n) => n + 1);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await createYouTubeApi().updateNotificationSettings({
        notificationSettingsBody: {
          enabled,
          preferredWeekday: weekday,
          timeZone: detectTimeZone() || 'UTC',
        },
      });
      toast({
        title: 'Saved',
        description: 'Weekly digest settings updated.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: errorMessage(error, 'Failed to update digest settings.'),
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
    loadError,
    retryLoad,
  };
}

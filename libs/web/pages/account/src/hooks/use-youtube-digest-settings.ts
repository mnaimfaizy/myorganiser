'use client';

import { detectTimeZone } from '@myorganiser/core';
import { useToast } from '@myorganiser/web-ui';
import { isAxiosError } from 'axios';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { createYouTubeApi } from '../lib/apiClient';
import { invalidSaveToast } from '../lib/invalidSaveToast';
import {
  youTubeDigestSchema,
  type YouTubeDigestValues,
} from '../schemas/youtubeDigest';

export interface YouTubeDigestSettings {
  /** The digest card needs this and `settingsLoaded` to both be true. */
  connected: boolean;
  /**
   * True only after a successful settings load. False before the first load,
   * after a failed load, and while a Retry is in flight. The form must not be
   * shown, and `save` sends nothing, until it is true.
   */
  settingsLoaded: boolean;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  weekday: number;
  setWeekday: (weekday: number) => void;
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

  const { control, setValue, reset, handleSubmit } =
    useForm<YouTubeDigestValues>({
      resolver: zodResolver(youTubeDigestSchema),
      defaultValues: { enabled: false, weekday: 1 },
    });
  const enabled = useWatch({ control, name: 'enabled' });
  const weekday = useWatch({ control, name: 'weekday' });
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Fetch YouTube notification settings
  useEffect(() => {
    let cancelled = false;
    setSettingsLoaded(false);
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
        reset({ enabled: data.enabled, weekday: data.preferredWeekday });
        setSettingsLoaded(true);
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
  }, [loadAttempt, reset]);

  const retryLoad = useCallback(() => {
    setLoadError(null);
    setLoadAttempt((n) => n + 1);
  }, []);

  const setEnabled = useCallback(
    (next: boolean) => setValue('enabled', next),
    [setValue],
  );
  const setWeekday = useCallback(
    (next: number) => setValue('weekday', next),
    [setValue],
  );

  const save = useCallback(async () => {
    // Second guard behind the hidden form: never write unloaded defaults.
    if (!settingsLoaded) return;
    await handleSubmit(
      async (values) => {
        setSaving(true);
        try {
          await createYouTubeApi().updateNotificationSettings({
            notificationSettingsBody: {
              enabled: values.enabled,
              preferredWeekday: values.weekday,
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
            description: errorMessage(
              error,
              'Failed to update digest settings.',
            ),
            variant: 'destructive',
          });
        } finally {
          setSaving(false);
        }
      },
      (errors) => toast(invalidSaveToast(errors)),
    )();
  }, [handleSubmit, settingsLoaded, toast]);

  return {
    connected,
    settingsLoaded,
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

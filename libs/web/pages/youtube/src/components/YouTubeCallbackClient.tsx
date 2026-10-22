'use client';

import { getAccessToken } from '@myorganiser/auth';
import { getApiBaseUrl } from '@myorganiser/core';
import { Button, Illustration } from '@myorganiser/web-ui';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useYouTubeAvailability } from '../hooks';
import { YouTubeUnavailableNotice } from './YouTubeUnavailableNotice';

export default function YouTubeCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const didRun = useRef(false);
  const { available, error: availabilityError } = useYouTubeAvailability();

  const handleBack = useCallback(() => {
    router.replace('/dashboard');
  }, [router]);

  const isUnavailable = available !== true;

  useEffect(() => {
    if (didRun.current) return;
    if (isUnavailable) return;

    didRun.current = true;

    (async () => {
      const code = searchParams.get('code');
      if (!code) {
        setError('No authorization code received from Google.');
        return;
      }

      const token = getAccessToken();
      if (!token) {
        setError('You must be logged in to connect YouTube.');
        return;
      }

      try {
        // Raw fetch, not the generated client: the callback's contract is kept as it was.
        const res = await fetch(`${getApiBaseUrl()}/youtube/callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
          body: JSON.stringify({ code }),
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
          setError(data.message ?? 'Failed to connect YouTube.');
          return;
        }

        router.replace('/dashboard/youtube');
      } catch {
        setError('Something went wrong while connecting YouTube.');
      }
    })();
  }, [searchParams, router, isUnavailable]);

  if (isUnavailable) {
    return (
      <YouTubeUnavailableNotice
        reason={availabilityError ? 'unreachable' : 'unavailable'}
        onBack={handleBack}
      />
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <div
          role="alert"
          className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-panel border border-destructive-edge bg-raised-surface p-7 text-center"
        >
          <Illustration kind="youtube" size={96} />
          <h1 className="font-display text-title text-destructive-text">
            Connection Failed
          </h1>
          <p className="text-body text-muted-foreground">{error}</p>
          <Button type="button" variant="outline" onClick={handleBack}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div
        role="status"
        className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-panel border border-border bg-raised-surface p-7 text-center"
      >
        <Illustration kind="youtube" size={96} />
        <Loader2
          aria-hidden="true"
          className="size-5 animate-spin text-brand motion-reduce:animate-none"
        />
        <h1 className="font-display text-title text-foreground">
          Connecting your YouTube account…
        </h1>
      </div>
    </div>
  );
}

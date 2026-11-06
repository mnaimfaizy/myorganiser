'use client';

import { isAxiosError } from 'axios';
import { Button, Card, CardContent } from '@myorganiser/web-ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAnonymousYouTubeApi } from '../lib/youtubeApi';

type Status = 'working' | 'done' | 'invalid-link' | 'error';

export default function YouTubeUnsubscribeClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const [fetchStatus, setFetchStatus] = useState<Status>('working');
  const didRun = useRef(false);

  // A missing token is a property of the URL, not the outcome of a request, so
  // it is derived during render rather than pushed through state from an
  // effect — the request never runs in that case.
  const status: Status = token ? fetchStatus : 'invalid-link';

  const performUnsubscribe = useCallback(async () => {
    try {
      const res = await createAnonymousYouTubeApi().unsubscribeFromDigest({
        unsubscribeBody: { token },
      });
      setFetchStatus(res.data.ok ? 'done' : 'error');
    } catch (err) {
      setFetchStatus(
        isAxiosError(err) && err.response?.status === 404
          ? 'invalid-link'
          : 'error',
      );
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    // Latch before issuing the request so StrictMode's double-invocation
    // cannot produce a second POST for the same token.
    if (didRun.current) return;
    didRun.current = true;

    (async () => {
      await performUnsubscribe();
    })();
  }, [token, performUnsubscribe]);

  // Deliberately unlatched: a retry is an explicit request from the reader.
  const handleRetry = useCallback(() => {
    setFetchStatus('working');
    void performUnsubscribe();
  }, [performUnsubscribe]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          {status === 'working' && (
            <div
              className="space-y-2 text-center"
              role="status"
              aria-live="polite"
            >
              <h1 className="text-lg font-semibold">
                Updating your digest preferences…
              </h1>
              <p className="text-sm text-muted-foreground">
                Please wait while we process your request.
              </p>
            </div>
          )}

          {status === 'done' && (
            <div className="space-y-4" role="status" aria-live="polite">
              <div className="text-center space-y-2">
                <h1 className="text-lg font-semibold">Digest turned off</h1>
                <p className="text-sm text-muted-foreground">
                  Your weekly YouTube digest is now disabled. You can turn it
                  back on any time from your account settings.
                </p>
              </div>
              <div className="flex justify-center">
                <Button asChild variant="outline">
                  <Link href="/dashboard/account">Go to account settings</Link>
                </Button>
              </div>
            </div>
          )}

          {status === 'invalid-link' && (
            <div className="space-y-4" role="status" aria-live="polite">
              <div className="text-center space-y-2">
                <h1 className="text-lg font-semibold">Link no longer valid</h1>
                <p className="text-sm text-muted-foreground">
                  This unsubscribe link has expired or is no longer valid. You
                  can manage your digest settings directly from your account
                  page.
                </p>
              </div>
              <div className="flex justify-center">
                <Button asChild variant="outline">
                  <Link href="/dashboard/account">Go to account settings</Link>
                </Button>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4" role="status" aria-live="polite">
              <div className="text-center space-y-2">
                <h1 className="text-lg font-semibold text-destructive">
                  Something went wrong
                </h1>
                <p className="text-sm text-muted-foreground">
                  We couldn't process your request. Please try again or visit
                  your account settings to manage your digest.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={handleRetry} variant="default">
                  Try again
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard/account">Go to account settings</Link>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

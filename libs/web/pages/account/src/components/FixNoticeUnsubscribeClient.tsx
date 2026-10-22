'use client';

import { getApiBaseUrl } from '@myorganiser/core';
import { AppLogo, Button, Illustration } from '@myorganiser/web-ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type Status = 'working' | 'done' | 'invalid-link' | 'error';

interface StatusCopy {
  heading: string;
  text: string;
  cta: { label: string; href: string } | null;
  headingClassName?: string;
}

const REPORTS_CTA = {
  label: 'Go to your reports',
  href: '/dashboard/account/reports',
} as const;

const STATUS_COPY = {
  working: {
    heading: 'Updating your notification preferences…',
    text: 'Please wait while we process your request.',
    cta: null,
  },
  done: {
    heading: 'Fix Notices turned off',
    text: 'You will no longer receive an email when one of your Feedback Reports is fixed or shipped. You can still see the outcome any time on your reports page.',
    cta: REPORTS_CTA,
  },
  'invalid-link': {
    heading: 'Link no longer valid',
    text: 'This unsubscribe link has expired or is no longer valid. You can manage your Feedback Report notifications from your account.',
    cta: { label: 'Go to account settings', href: '/dashboard/account' },
  },
  error: {
    heading: 'Something went wrong',
    text: "We couldn't process your request. Please try again or visit your reports page.",
    cta: REPORTS_CTA,
    headingClassName: 'text-destructive-text',
  },
} as const satisfies Record<Status, StatusCopy>;

export default function FixNoticeUnsubscribeClient() {
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
      const res = await fetch(
        `${getApiBaseUrl()}/feedback/fix-notice/unsubscribe`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token }),
        },
      );

      if (res.status === 404) {
        setFetchStatus('invalid-link');
        return;
      }

      if (!res.ok) {
        setFetchStatus('error');
        return;
      }

      const data = await res.json();
      setFetchStatus(data.ok ? 'done' : 'error');
    } catch {
      setFetchStatus('error');
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

  const copy: StatusCopy = STATUS_COPY[status];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-14">
      <Link
        href="/"
        aria-label="MyOrganiser home"
        className="inline-flex items-center rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <AppLogo variant="full" height={34} aria-hidden />
      </Link>

      <div
        className="flex w-full max-w-[460px] flex-col items-center gap-3.5 rounded-panel border border-border bg-card px-7 py-9 text-center shadow-card"
        role="status"
        aria-live="polite"
      >
        <Illustration kind="feedback" size={96} />
        <h1
          className={`font-display text-title-lg text-foreground ${copy.headingClassName ?? ''}`.trim()}
        >
          {copy.heading}
        </h1>
        <p className="text-body-sm text-foreground-supporting">{copy.text}</p>

        {(status === 'error' || copy.cta) && (
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {status === 'error' && (
              <Button onClick={handleRetry} variant="outline">
                Try again
              </Button>
            )}
            {copy.cta && (
              <Button asChild variant="default">
                <Link href={copy.cta.href}>{copy.cta.label}</Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

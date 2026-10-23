'use client';

import { Button, Illustration, useIsMobileState } from '@myorganiser/web-ui';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useId, useState, type ReactNode } from 'react';
import { useYouTubeAcknowledgement } from '../hooks';
import { YOUTUBE_DATA_PRIVACY_BULLETS } from '../lib/dataPrivacyCopy';
import { YouTubeAcknowledgementForm } from './YouTubeAcknowledgementForm';

interface YouTubeConnectPromptProps {
  /**
   * Optional connect handler. If provided, the button will call it instead of
   * navigating. Used by YouTubePageClient to trigger the OAuth flow.
   */
  onConnect?: () => void;

  /**
   * Optional status message or variant. Used to show "revoked" state in
   * YouTubePageClient. Rendered as a status pill inside the hero.
   */
  statusMessage?: ReactNode;

  /**
   * Optional fallback link destination when onConnect is not provided.
   * If not provided and onConnect is absent, defaults to "/dashboard/youtube".
   */
  fallbackHref?: string;
}

interface YouTubeConnectHeroProps {
  statusMessage?: ReactNode;
  /** The Connect action when no acknowledgement form is shown; null otherwise. */
  action: ReactNode;
}

/** The navy hero: illustration, title, lead, status pill and the hero action. */
function YouTubeConnectHero({
  statusMessage,
  action,
}: YouTubeConnectHeroProps) {
  const headingId = useId();
  // Desktop markup while the breakpoint is undecided (undefined), as Tasks does.
  const isMobile = useIsMobileState() === true;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-5 rounded-panel bg-navy p-5 text-navy-foreground md:p-8"
    >
      <div className="flex flex-wrap items-center gap-6">
        <Illustration kind="youtube" size={isMobile ? 64 : 140} />
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3">
          <h1
            id={headingId}
            className="m-0 font-display text-title-lg text-navy-foreground md:text-display"
          >
            Connect Your YouTube Account
          </h1>
          <p className="text-body text-navy-muted-foreground">
            Link your YouTube account to view and manage videos from your
            Enabled Channels. We only request read-only access.
          </p>
          {statusMessage ? (
            <p
              role="status"
              className="inline-flex items-center gap-2 self-start rounded-control bg-warning-text px-3 py-2 text-body-sm font-semibold text-navy-foreground"
            >
              {statusMessage}
            </p>
          ) : null}
          {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
    </section>
  );
}

/** The "How we store your YouTube data" card: the data-privacy bullets and the link to the full copy. */
function YouTubeDataStorageCard() {
  return (
    <section
      aria-label="How we store your YouTube data"
      className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 rounded-panel border border-border bg-raised-surface p-6"
    >
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {YOUTUBE_DATA_PRIVACY_BULLETS.map((bullet) => (
          <li
            key={bullet}
            className="flex items-start gap-3 text-body text-foreground-secondary"
          >
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-control-sm bg-brand-soft text-brand-text"
            >
              <Check className="size-3.5" />
            </span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/youtube/data-privacy"
        className="self-start text-body-sm font-semibold text-brand-text underline underline-offset-4"
      >
        How we store your YouTube data
      </Link>
    </section>
  );
}

interface YouTubeConnectPromptActionProps {
  onConnect: () => void;
  statusMessage?: ReactNode;
}

/**
 * The connect flow. It owns the acknowledgement lookup, so the Shorts fallback
 * (which renders no action) makes no acknowledgement request.
 *
 * Until the stored acknowledgement is known, Connect is disabled so a User who
 * has already accepted does not see the checkbox flash. A User who has not
 * accepted (or whose lookup failed; the server enforces it anyway) ticks the
 * box, and submitting stores the acknowledgement before connecting. The form
 * card is shown only in that case; otherwise Connect sits in the hero.
 */
function YouTubeConnectPromptAction({
  onConnect,
  statusMessage,
}: YouTubeConnectPromptActionProps) {
  const { acknowledged, loading, accept } = useYouTubeAcknowledgement();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleAccept = useCallback(async () => {
    setSubmitError(null);
    try {
      await accept();
    } catch {
      setSubmitError('Could not save your acknowledgement. Please try again.');
      return;
    }
    onConnect();
  }, [accept, onConnect]);

  const needsAcknowledgement = !(loading || acknowledged === true);

  return (
    <div className="flex flex-col gap-5">
      <YouTubeConnectHero
        statusMessage={statusMessage}
        action={
          needsAcknowledgement ? null : (
            <Button
              variant="brand"
              size="lg"
              onClick={onConnect}
              disabled={loading}
            >
              Connect YouTube
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-start gap-5">
        <YouTubeDataStorageCard />
        {needsAcknowledgement ? (
          <YouTubeAcknowledgementForm
            onAccept={handleAccept}
            submitError={submitError}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Shared connect prompt shown when YouTube is not connected.
 *
 * Used by both YouTubePageClient (with onConnect callback and status message)
 * and ShortsPageClient (without onConnect, linking back to /dashboard/youtube).
 */
export function YouTubeConnectPrompt({
  onConnect,
  statusMessage,
  fallbackHref = '/dashboard/youtube',
}: YouTubeConnectPromptProps) {
  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-3.5 px-4 pb-8 pt-4 md:gap-6 md:p-8">
      {onConnect ? (
        <YouTubeConnectPromptAction
          onConnect={onConnect}
          statusMessage={statusMessage}
        />
      ) : (
        <>
          <YouTubeConnectHero
            statusMessage={statusMessage}
            action={
              <Button asChild variant="outline">
                <Link href={fallbackHref}>Back to Videos</Link>
              </Button>
            }
          />
          <div className="flex flex-wrap items-start gap-5">
            <YouTubeDataStorageCard />
          </div>
        </>
      )}
    </div>
  );
}

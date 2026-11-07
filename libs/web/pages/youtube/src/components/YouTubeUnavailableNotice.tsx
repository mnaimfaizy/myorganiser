'use client';

import { Button, Illustration, cn } from '@myorganiser/web-ui';
import { requestYouTubeAvailabilityRecheck } from '@myorganiser/web-youtube';
import Link from 'next/link';
import { useCallback } from 'react';
import {
  formatWithdrawalDate,
  type UnavailableNoticeReason,
} from '../lib/unavailableNotice';

interface YouTubeUnavailableNoticeProps {
  /**
   * `unavailable`: the availability check answered false (switched off, or no
   * YouTube Access). `unreachable`: the check itself errored, so the notice
   * offers Try again. `withdrawn`: a Platform Admin withdrew the User's YouTube
   * Access, which is permanent, so there is no retry. Callers derive this with
   * `toUnavailableNoticeProps`.
   */
  reason?: UnavailableNoticeReason;
  /** ISO date-time of the withdrawal. Used only when `reason` is `withdrawn`; absent or unparsable → the sentence has no date. */
  withdrawnAt?: string | null;
  /** When set, Back to Dashboard uses this handler (OAuth callback uses router.replace). When omitted, navigate with a Link to /dashboard. */
  onBack?: () => void;
}

type Reason = UnavailableNoticeReason;

interface ReasonCopy {
  /** `alert` for the permanent withdrawal, `status` for the temporary check failure. */
  role: 'alert' | 'status' | undefined;
  /** Small caps line above the heading, or null when the reason has none. */
  caps: { label: string; className: string } | null;
  // caps.className is a fixed class list; it is not passed through cn().
  heading: string;
  body: (withdrawalDate: string | null) => string;
  /** Shows the Try again button. */
  showRetry: boolean;
  /** Shows the "contact the person who runs your MyOrganiser" line. */
  showContactLine: boolean;
  borderClassName: string;
}

const REASON_COPY = {
  unavailable: {
    role: undefined,
    caps: null,
    heading: 'YouTube is not available right now',
    body: () => 'Please try again later.',
    showRetry: false,
    showContactLine: false,
    borderClassName: 'border-border',
  },
  unreachable: {
    role: 'status',
    caps: {
      label: 'TEMPORARY',
      className: 'text-label-caps text-muted-foreground',
    },
    heading: "YouTube can't be reached right now",
    body: () =>
      "We couldn't check your YouTube connection. Your cached uploads are safe. Try again in a few minutes.",
    showRetry: true,
    showContactLine: false,
    borderClassName: 'border-border',
  },
  withdrawn: {
    role: 'alert',
    caps: {
      label: 'ACCESS WITHDRAWN · PERMANENT',
      className: 'text-label-caps text-warning-text',
    },
    heading: 'YouTube is no longer available to you',
    body: (withdrawalDate) => {
      const ending =
        'Your YouTube connection was ended and its cached data deleted. The rest of MyOrganiser is unaffected.';
      return withdrawalDate
        ? `An admin withdrew your YouTube Access on ${withdrawalDate}. ${ending}`
        : `An admin withdrew your YouTube Access. ${ending}`;
    },
    showRetry: false,
    showContactLine: true,
    borderClassName: 'border-warning',
  },
} as const satisfies Record<Reason, ReasonCopy>;

export function YouTubeUnavailableNotice({
  reason = 'unavailable',
  withdrawnAt = null,
  onBack,
}: YouTubeUnavailableNoticeProps) {
  const copy = REASON_COPY[reason];
  const withdrawalDate = formatWithdrawalDate(withdrawnAt);

  const handleRetry = useCallback(() => {
    requestYouTubeAvailabilityRecheck();
  }, []);

  const backButton = onBack ? (
    <Button type="button" variant="outline" onClick={onBack}>
      Back to Dashboard
    </Button>
  ) : (
    <Button asChild variant="outline">
      <Link href="/dashboard">Back to Dashboard</Link>
    </Button>
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div
        role={copy.role}
        className={cn(
          'flex w-full max-w-[420px] flex-col items-center gap-4 rounded-panel border bg-raised-surface p-7 text-center',
          copy.borderClassName,
        )}
      >
        <Illustration kind="youtube" size={96} />
        {copy.caps ? (
          <p className={copy.caps.className}>{copy.caps.label}</p>
        ) : null}
        <h1 className="font-display text-title text-foreground">
          {copy.heading}
        </h1>
        <p className="text-body text-muted-foreground">
          {copy.body(withdrawalDate)}
        </p>
        {copy.showContactLine ? (
          <p className="text-caption text-muted-foreground">
            If you think this is a mistake, contact the person who runs your
            MyOrganiser.
          </p>
        ) : null}
        {copy.showRetry ? (
          <Button type="button" variant="brand" onClick={handleRetry}>
            Try again
          </Button>
        ) : null}
        {backButton}
      </div>
    </div>
  );
}

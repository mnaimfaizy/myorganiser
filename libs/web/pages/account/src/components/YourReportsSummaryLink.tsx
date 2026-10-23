'use client';

import {
  Illustration,
  ListGroup,
  ListGroupHeaderTitle,
  ListGroupRow,
  ListGroupRowBody,
  ListGroupRowMeta,
  ListGroupRowTitle,
  ListGroupRowTrailing,
} from '@myorganiser/web-ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import type { AccountVariant } from '../account-view';
import { createFeedbackApi } from '../lib/apiClient';

interface YourReportsSummaryLinkProps {
  variant?: AccountVariant;
}

export function YourReportsSummaryLink({
  variant = 'desktop',
}: YourReportsSummaryLinkProps) {
  const headingId = useId();
  const [hasChanged, setHasChanged] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const api = createFeedbackApi();
        const response = await api.listReports();
        setHasChanged(response.data.hasChangedSinceLastSeen);
      } catch {
        // Silently fail; the real content lives on /dashboard/account/reports
        console.error('Failed to fetch reports summary');
        setHasChanged(false);
      }
    })();
  }, []);

  const updatedPill =
    hasChanged === true ? (
      <span className="rounded-full bg-brand px-2.5 py-0.5 text-label-caps text-brand-foreground">
        Updated
      </span>
    ) : null;

  if (variant === 'phone') {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <ListGroupHeaderTitle id={headingId} className="mt-1.5 px-1">
          Feedback
        </ListGroupHeaderTitle>
        <ListGroup>
          <ListGroupRow asChild interactive size="value" className="min-h-13">
            <Link href="/dashboard/account/reports">
              <ListGroupRowBody>
                <ListGroupRowTitle>Your reports</ListGroupRowTitle>
                <ListGroupRowMeta>
                  See the status of every Bug Report and Suggestion you&apos;ve
                  sent.
                </ListGroupRowMeta>
              </ListGroupRowBody>
              <ListGroupRowTrailing>
                {updatedPill}
                <ChevronRight className="text-inactive" aria-hidden="true" />
              </ListGroupRowTrailing>
            </Link>
          </ListGroupRow>
        </ListGroup>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-wrap items-center gap-4 rounded-panel border border-border bg-raised-surface px-6 py-5"
    >
      <Illustration kind="feedback" size={48} />
      <div className="flex min-w-0 flex-1 basis-[300px] flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <h2 id={headingId} className="font-display text-title font-bold">
            Your reports
          </h2>
          {updatedPill}
        </div>
        <p className="text-body-sm text-muted-foreground">
          See the status of every Bug Report and Suggestion you&apos;ve sent.
        </p>
      </div>
      <Link
        href="/dashboard/account/reports"
        className="font-semibold text-brand-text no-underline"
      >
        View your reports →
      </Link>
    </section>
  );
}

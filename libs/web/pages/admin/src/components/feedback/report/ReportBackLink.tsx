import { cn } from '@myorganiser/web-ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

import type { ReportVariant } from '../../../lib/feedbackReportView';

export interface ReportBackLinkProps {
  variant: ReportVariant;
}

/**
 * The way back to the inbox. Phone shows the short visible word "Feedback"
 * and keeps the full name in aria-label, so the label still contains the
 * visible text.
 */
export function ReportBackLink({ variant }: ReportBackLinkProps) {
  const isPhone = variant === 'phone';

  return (
    <Link
      href="/admin/feedback"
      aria-label={isPhone ? 'Back to Feedback' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 self-start font-semibold text-brand-text hover:underline',
        isPhone ? 'min-h-11 text-body' : 'text-body-sm',
      )}
    >
      <ChevronLeft aria-hidden="true" className="size-icon shrink-0" />
      {isPhone ? 'Feedback' : 'Back to Feedback'}
    </Link>
  );
}

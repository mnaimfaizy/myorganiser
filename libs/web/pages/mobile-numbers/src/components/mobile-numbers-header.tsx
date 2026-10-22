'use client';

import { Plus } from 'lucide-react';
import { Button, Illustration } from '@myorganiser/web-ui';

interface MobileNumbersHeaderProps {
  /** From formatMobileNumbersSummary (desktop) or formatMobileNumbersPhoneSummary (phone). Empty while loading. */
  summary: string;
  onAdd: () => void;
  /** Desktop shows the illustration, title, summary and Add button; phone shows the hidden title and summary. */
  variant: 'desktop' | 'phone';
}

/**
 * The Mobile numbers page heading. On phone the app shell draws the title and
 * the page's FAB adds, so only a visually hidden `<h1>` and the summary remain.
 */
const MobileNumbersHeader = ({
  summary,
  onAdd,
  variant,
}: MobileNumbersHeaderProps) => {
  if (variant === 'phone') {
    return (
      <div className="flex flex-col gap-0.5">
        <h1 className="sr-only">Mobile numbers</h1>
        {summary ? (
          <p className="text-caption text-muted-foreground">{summary}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Illustration kind="mobile" size={64} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="m-0 font-display text-title-lg text-foreground">
          Mobile numbers
        </h1>
        <p className="text-body-sm text-muted-foreground">{summary}</p>
      </div>
      <Button variant="brand" onClick={onAdd}>
        <Plus aria-hidden="true" />
        Add mobile number
      </Button>
    </div>
  );
};

export { MobileNumbersHeader };
export type { MobileNumbersHeaderProps };

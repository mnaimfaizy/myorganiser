'use client';

import { Plus } from 'lucide-react';
import { Button, Illustration } from '@myorganiser/web-ui';

interface SubscriptionsHeaderProps {
  /** Desktop only: from formatSubscriptionsSummary, e.g. "6 active · 2 renew this week". */
  summary: string;
  onAdd: () => void;
  /** Desktop shows the illustration, title, summary and Add button; phone shows only the hidden title. */
  variant: 'desktop' | 'phone';
}

/**
 * The Subscriptions page heading. On phone the app shell already draws the
 * title and the page's FAB adds, so only a visually hidden `<h1>` remains.
 */
const SubscriptionsHeader = ({
  summary,
  onAdd,
  variant,
}: SubscriptionsHeaderProps) => {
  if (variant === 'phone') {
    return <h1 className="sr-only">Subscriptions</h1>;
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Illustration kind="subscriptions" size={64} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="m-0 font-display text-title-lg text-foreground">
          Subscriptions
        </h1>
        <p className="text-body text-muted-foreground">{summary}</p>
      </div>
      <Button variant="brand" onClick={onAdd}>
        <Plus aria-hidden="true" />
        Add subscription
      </Button>
    </div>
  );
};

export { SubscriptionsHeader };
export type { SubscriptionsHeaderProps };

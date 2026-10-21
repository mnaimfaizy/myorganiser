'use client';

import { Plus } from 'lucide-react';
import { Button, EmptyPage, EmptyScreen } from '@myorganiser/web-ui';

interface SubscriptionsEmptyProps {
  onAdd: () => void;
  variant: 'desktop' | 'phone';
}

const DESKTOP_TIPS = [
  'One monthly total across weekly, monthly and yearly plans',
  'A heads-up when something renews within a week',
  'Cancelled plans drop out of your totals',
] as const;

/**
 * The first-run state for Subscriptions. On phone the shell already draws the
 * title, so EmptyScreen's `<h1>` is kept for the outline but visually hidden,
 * and the screen is no longer full height.
 */
const SubscriptionsEmpty = ({ onAdd, variant }: SubscriptionsEmptyProps) => {
  if (variant === 'phone') {
    return (
      <EmptyScreen
        illustration="subscriptions"
        title="Subscriptions"
        heading="No subscriptions yet"
        line="Add the ones you pay for and see what they cost each month."
        className="min-h-0 grow [&>h1]:sr-only"
        action={
          <Button variant="brand" size="lg" onClick={onAdd}>
            <Plus aria-hidden="true" />
            Add subscription
          </Button>
        }
      />
    );
  }

  return (
    <EmptyPage
      illustration="subscriptions"
      title="Subscriptions"
      heading="No subscriptions yet"
      line="Add the ones you pay for and see what they cost each month, and what renews next."
      tips={DESKTOP_TIPS}
      action={
        <Button variant="brand" size="lg" onClick={onAdd}>
          <Plus aria-hidden="true" />
          Add subscription
        </Button>
      }
    />
  );
};

export { SubscriptionsEmpty };
export type { SubscriptionsEmptyProps };

'use client';

import { formatMoney } from '@myorganiser/core';
import {
  isSafeLink,
  SubscriptionStatusEnum,
  type SubscriptionRecord,
} from '@myorganiser/vault-core';
import {
  Button,
  cn,
  IconButton,
  NewTabLink,
  StatusPill,
} from '@myorganiser/web-ui';
import { X } from 'lucide-react';
import {
  getSubscriptionBillingCyclePhrase,
  getSubscriptionPaymentMethodLabel,
  getSubscriptionRenewalTypeLabel,
  getSubscriptionStatusLabel,
  getSubscriptionStatusTone,
  getSubscriptionTierLabel,
} from '../utils/presentation';
import {
  formatLongDate,
  formatNextBillingDetail,
} from '../utils/subscription-summary';

export interface SubscriptionDetailPanelProps {
  subscription: SubscriptionRecord;
  today: Date;
  onClose: () => void;
  onEdit: () => void;
  /** Hidden when the subscription is already cancelled. */
  onMarkCancelled: () => void;
  onDelete: () => void;
}

/**
 * The desktop Subscription detail: a raised card beside the list, showing the
 * amount, the billing facts and the footer actions. Read-only apart from the
 * actions, which flow out through the callbacks.
 */
export function SubscriptionDetailPanel({
  subscription,
  today,
  onClose,
  onEdit,
  onMarkCancelled,
  onDelete,
}: SubscriptionDetailPanelProps) {
  const isCancelled = subscription.status === SubscriptionStatusEnum.Cancelled;
  const nextBilling = formatNextBillingDetail(
    subscription.nextBillingDate,
    today,
  );
  const ends = formatLongDate(subscription.endDate);

  return (
    <aside
      aria-label="Subscription detail"
      className="flex min-w-0 flex-1 basis-80 flex-col gap-4 rounded-panel border border-border bg-raised-surface p-5 shadow-card"
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="font-display text-title break-words text-foreground">
            {subscription.name}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            <StatusPill tone={getSubscriptionStatusTone(subscription.status)}>
              {getSubscriptionStatusLabel(subscription.status)}
            </StatusPill>
            <StatusPill tone="neutral">
              {getSubscriptionTierLabel(subscription.tier)}
            </StatusPill>
          </div>
        </div>
        <IconButton
          variant="ghost"
          label="Close detail"
          icon={<X aria-hidden="true" className="size-3.5" />}
          onClick={onClose}
        />
      </div>

      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-display text-display tabular-nums text-foreground">
          {formatMoney({
            amount: subscription.amount,
            currency: subscription.currency,
          })}
        </span>
        <span className="text-body-sm text-muted-foreground">
          {getSubscriptionBillingCyclePhrase(subscription.billingCycle)}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-body-sm">
        <dt className="text-muted-foreground">Next billing</dt>
        <dd className="min-w-0 font-semibold text-foreground">
          {nextBilling ?? '—'}
        </dd>

        <dt className="text-muted-foreground">Started</dt>
        <dd className="min-w-0 text-foreground">
          {formatLongDate(subscription.startDate) ?? '—'}
        </dd>

        <dt className="text-muted-foreground">Renewal</dt>
        <dd className="min-w-0 text-foreground">
          {getSubscriptionRenewalTypeLabel(subscription.renewalType)}
        </dd>

        <dt className="text-muted-foreground">Pays with</dt>
        <dd className="min-w-0 text-foreground">
          {getSubscriptionPaymentMethodLabel(subscription.paymentMethod)}
        </dd>

        {ends ? (
          <>
            <dt className="text-muted-foreground">Ends</dt>
            <dd className="min-w-0 text-foreground">{ends}</dd>
          </>
        ) : null}

        {subscription.link && isSafeLink(subscription.link) ? (
          <>
            <dt className="text-muted-foreground">Website</dt>
            <dd className="min-w-0">
              <NewTabLink
                href={subscription.link}
                className="font-semibold text-brand-text"
              >
                Manage plan
              </NewTabLink>
            </dd>
          </>
        ) : null}
      </dl>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Button className="w-full" onClick={onEdit}>
          Edit
        </Button>
        <div className="grid grid-cols-2 gap-2">
          {isCancelled ? null : (
            <Button
              variant="outline"
              className="min-w-0 whitespace-nowrap px-2"
              onClick={onMarkCancelled}
            >
              Mark cancelled
            </Button>
          )}
          <Button
            variant="outline"
            className={cn(
              'min-w-0 whitespace-nowrap border-destructive-edge px-2 text-destructive-text hover:bg-destructive-soft',
              isCancelled && 'col-span-2',
            )}
            onClick={onDelete}
          >
            Delete…
          </Button>
        </div>
      </div>
    </aside>
  );
}

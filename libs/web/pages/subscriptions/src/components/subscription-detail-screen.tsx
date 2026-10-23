'use client';

import { formatMoney } from '@myorganiser/core';
import {
  SubscriptionStatusEnum,
  type SubscriptionRecord,
} from '@myorganiser/vault-core';
import {
  Button,
  cn,
  ListGroup,
  ListGroupRow,
  ListGroupRowTitle,
  ListGroupRowTrailing,
  StatusPill,
} from '@myorganiser/web-ui';
import {
  getSubscriptionBillingCycleLabel,
  getSubscriptionBillingCyclePhrase,
  getSubscriptionPaymentMethodLabel,
  getSubscriptionRenewalTypeLabel,
  getSubscriptionStatusLabel,
  getSubscriptionStatusTone,
  getSubscriptionTierLabel,
} from '../utils/presentation';
import {
  formatLongDate,
  formatRenewal,
  formatWeekdayDate,
} from '../utils/subscription-summary';
import { RenewalPill } from './renewal-pill';

export interface SubscriptionDetailScreenProps {
  subscription: SubscriptionRecord;
  today: Date;
  onEdit: () => void;
  onMarkCancelled: () => void;
  onDelete: () => void;
}

/**
 * The phone Subscription detail, pushed over the Subscriptions list. The shell
 * draws the back bar; this screen draws the title block with its Edit action,
 * the amount card, the grouped billing facts and the footer actions.
 */
export function SubscriptionDetailScreen({
  subscription,
  today,
  onEdit,
  onMarkCancelled,
  onDelete,
}: SubscriptionDetailScreenProps) {
  const isCancelled = subscription.status === SubscriptionStatusEnum.Cancelled;
  const renewal = formatRenewal(subscription.nextBillingDate, today);
  const renewsOn = formatWeekdayDate(subscription.nextBillingDate);

  const rows = [
    {
      term: 'Billed',
      value: getSubscriptionBillingCycleLabel(subscription.billingCycle),
    },
    { term: 'Started', value: formatLongDate(subscription.startDate) ?? '—' },
    {
      term: 'Renewal',
      value: getSubscriptionRenewalTypeLabel(subscription.renewalType),
    },
    {
      term: 'Pays with',
      value: getSubscriptionPaymentMethodLabel(subscription.paymentMethod),
    },
    {
      term: 'Ends',
      value: formatLongDate(subscription.endDate) ?? 'No end date',
    },
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col gap-4 pt-1 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <h1 className="font-display text-display min-w-0 flex-1 break-words text-foreground">
            {subscription.name}
          </h1>
          <Button
            variant="link"
            className="h-11 shrink-0 px-2"
            onClick={onEdit}
          >
            Edit
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusPill tone={getSubscriptionStatusTone(subscription.status)}>
            {getSubscriptionStatusLabel(subscription.status)}
          </StatusPill>
          <StatusPill tone="neutral">
            {getSubscriptionTierLabel(subscription.tier)}
          </StatusPill>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 rounded-panel border border-border bg-raised-surface p-4.5">
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
        {renewsOn ? (
          <p className="flex flex-wrap items-center gap-2 text-body-sm text-foreground-secondary">
            {renewal?.soon ? <RenewalPill renewal={renewal} /> : null}
            <span>{`Renews ${renewsOn}`}</span>
          </p>
        ) : null}
      </div>

      <ListGroup>
        <dl className="flex flex-col divide-y divide-border-subtle">
          {rows.map((row) => (
            <div
              key={row.term}
              className="flex min-h-13 items-center justify-between gap-3 px-4 py-2.5"
            >
              <dt className="text-body-sm text-muted-foreground">{row.term}</dt>
              <dd className="min-w-0 text-right text-body-sm font-medium text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        {subscription.link ? (
          <ListGroupRow
            asChild
            interactive
            size="value"
            className="text-brand-text"
          >
            <a href={subscription.link} target="_blank" rel="noreferrer">
              <ListGroupRowTitle className="min-w-0 flex-1 text-body-sm font-semibold">
                Manage plan on the website
                <span className="sr-only"> (opens in a new tab)</span>
              </ListGroupRowTitle>
              <ListGroupRowTrailing>
                <span aria-hidden="true">↗</span>
              </ListGroupRowTrailing>
            </a>
          </ListGroupRow>
        ) : null}
      </ListGroup>

      <div className="mt-auto grid grid-cols-2 gap-2 pb-2">
        {isCancelled ? null : (
          <Button
            variant="secondary"
            className="min-w-0 whitespace-normal px-2"
            onClick={onMarkCancelled}
          >
            Mark cancelled
          </Button>
        )}
        <Button
          variant="outline"
          className={cn(
            'min-w-0 border-destructive-edge px-2 text-destructive-text hover:bg-destructive-soft',
            isCancelled && 'col-span-2',
          )}
          onClick={onDelete}
        >
          Delete…
        </Button>
      </div>
    </div>
  );
}

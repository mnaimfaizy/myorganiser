'use client';

import { formatMoney } from '@myorganiser/core';
import {
  SubscriptionBillingCycleEnum,
  type SubscriptionRecord,
} from '@myorganiser/vault-core';
import {
  ListGroup,
  ListGroupRow,
  ListGroupRowBody,
  ListGroupRowTitle,
  ListGroupRowTrailing,
  StatusPill,
  cn,
} from '@myorganiser/web-ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

import {
  getSubscriptionBillingCycleLabel,
  getSubscriptionBillingCyclePhrase,
  getSubscriptionPaymentMethodLabel,
  getSubscriptionRenewalTypeLabel,
  getSubscriptionTierLabel,
} from '../utils/presentation';
import {
  formatRenewal,
  monthlyEquivalent,
} from '../utils/subscription-summary';
import { RenewalPill } from './renewal-pill';

interface SubscriptionListProps {
  /** Already filtered and sorted. */
  subscriptions: SubscriptionRecord[];
  today: Date;
  /** aria-label of the list section, e.g. "Active subscriptions". */
  label: string;
  /** Shown when `subscriptions` is empty, e.g. "No cancelled subscriptions.". */
  emptyMessage: string;
  variant: 'desktop' | 'phone';
  /** Desktop: the selected row. */
  selectedId?: string;
  /** Desktop: a row press selects it (opens the detail panel). */
  onSelect?: (id: string) => void;
}

/**
 * The subscriptions list. Desktop rows are buttons that select a subscription
 * for the detail panel; phone rows are links to the detail screen.
 */
const SubscriptionList = ({
  subscriptions,
  today,
  label,
  emptyMessage,
  variant,
  selectedId,
  onSelect,
}: SubscriptionListProps) => {
  const handleRowPress = useCallback(
    (id: string) => {
      onSelect?.(id);
    },
    [onSelect],
  );

  if (subscriptions.length === 0) {
    return (
      <section aria-label={label}>
        <ListGroup>
          <p className="px-4 py-4 text-body-sm text-muted-foreground">
            {emptyMessage}
          </p>
        </ListGroup>
      </section>
    );
  }

  if (variant === 'phone') {
    return (
      <section aria-label={label}>
        <ListGroup>
          {subscriptions.map((s) => {
            const renewal = formatRenewal(s.nextBillingDate, today);
            return (
              <ListGroupRow key={s.id} asChild interactive size="default">
                <Link href={`/dashboard/subscriptions/${s.id}`}>
                  <ListGroupRowBody>
                    <ListGroupRowTitle>{s.name}</ListGroupRowTitle>
                    <span className="text-body-sm text-muted-foreground">
                      {`${formatMoney({ amount: s.amount, currency: s.currency })} ${getSubscriptionBillingCyclePhrase(s.billingCycle)}`}
                    </span>
                  </ListGroupRowBody>
                  <RenewalPill renewal={renewal} />
                  <ListGroupRowTrailing>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 text-inactive"
                    />
                  </ListGroupRowTrailing>
                </Link>
              </ListGroupRow>
            );
          })}
        </ListGroup>
      </section>
    );
  }

  return (
    <section aria-label={label}>
      <ListGroup>
        {subscriptions.map((s) => {
          const selected = s.id === selectedId;
          const renewal = formatRenewal(s.nextBillingDate, today);
          const isMonthly =
            s.billingCycle === SubscriptionBillingCycleEnum.Monthly;
          const cycleLine = isMonthly
            ? getSubscriptionBillingCycleLabel(s.billingCycle).toLowerCase()
            : `${getSubscriptionBillingCycleLabel(s.billingCycle).toLowerCase()} · ${formatMoney(
                {
                  amount: monthlyEquivalent(s.amount, s.billingCycle),
                  currency: s.currency,
                },
              )} / mo`;

          return (
            <button
              key={s.id}
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => handleRowPress(s.id)}
              className={cn(
                'flex w-full min-h-18 flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 text-left text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
                selected
                  ? 'bg-brand-soft ring-2 ring-inset ring-brand'
                  : 'hover:bg-ghost-hover',
              )}
            >
              <span className="flex min-w-0 grow basis-60 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words text-body font-semibold text-foreground">
                    {s.name}
                  </span>
                  <StatusPill size="sm">
                    {getSubscriptionTierLabel(s.tier)}
                  </StatusPill>
                </span>
                <span className="text-body-sm text-muted-foreground">
                  {`${getSubscriptionPaymentMethodLabel(s.paymentMethod)} · ${getSubscriptionRenewalTypeLabel(s.renewalType).toLowerCase()}`}
                </span>
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-4">
                <span className="flex flex-col items-end text-right">
                  <span className="text-body font-semibold tabular-nums text-foreground">
                    {formatMoney({ amount: s.amount, currency: s.currency })}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {cycleLine}
                  </span>
                </span>
                {renewal ? (
                  <RenewalPill renewal={renewal} fixedWidth />
                ) : (
                  <span
                    aria-hidden="true"
                    className="w-28 shrink-0 text-center text-muted-foreground"
                  >
                    —
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </ListGroup>
    </section>
  );
};

export { SubscriptionList };
export type { SubscriptionListProps };

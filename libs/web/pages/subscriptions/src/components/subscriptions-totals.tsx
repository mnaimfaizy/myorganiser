'use client';

import { formatMoney } from '@myorganiser/core';
import type { CurrencyCode } from '@myorganiser/vault-core';

import type { MonthlyConversion } from '../hooks/use-subscriptions-page';
import type {
  CurrencyMonthlyTotal,
  RenewalLabel,
} from '../utils/subscription-summary';
import { RenewalPill } from './renewal-pill';

export interface NextRenewalSummary {
  name: string;
  amount: number;
  currency: CurrencyCode;
  renewal: RenewalLabel;
}

interface SubscriptionsTotalsProps {
  /** activeMonthlyTotals(...): preferred currency first; may be empty. */
  totals: CurrencyMonthlyTotal[];
  preferredCurrency: CurrencyCode;
  activeCount: number;
  /** The next active renewal, or null. */
  nextRenewal: NextRenewalSummary | null;
  /** The "Show all in <currency>" conversion of the Monthly Equivalent. */
  conversion: MonthlyConversion;
  onConvert: () => void;
  onShowOriginal: () => void;
  variant: 'desktop' | 'phone';
}

/**
 * "+ US$12.00 + £3.00", one per remaining currency. `monthsPerPeriod` scales
 * each Monthly Equivalent (12 for the yearly figure); 1 leaves it unchanged.
 */
function joinOtherTotals(
  others: readonly CurrencyMonthlyTotal[],
  monthsPerPeriod = 1,
): string {
  return others
    .map(
      (t) =>
        `+ ${formatMoney({ amount: t.monthly * monthsPerPeriod, currency: t.currency })}`,
    )
    .join(' ');
}

/**
 * The Subscriptions totals. Desktop is three cards (each month, each year,
 * next renewal); phone is one navy card. The monthly figure is the first
 * currency's Monthly Equivalent, or the converted figure once the user asks for it. Other
 * currencies are shown as "+ …" rather than being added up silently, on both the
 * each-month card and the each-year card (where each is multiplied by 12).
 */
const SubscriptionsTotals = ({
  totals,
  preferredCurrency,
  activeCount,
  nextRenewal,
  conversion,
  onConvert,
  onShowOriginal,
  variant,
}: SubscriptionsTotalsProps) => {
  const primary = totals[0] ?? null;
  const isConverted = conversion.status === 'ready';
  const shownCurrency = isConverted
    ? preferredCurrency
    : (primary?.currency ?? preferredCurrency);
  const monthly = isConverted ? conversion.monthly : (primary?.monthly ?? 0);
  const others = isConverted ? [] : totals.slice(1);
  const showConversion =
    !isConverted &&
    totals.length > 0 &&
    (others.length > 0 || shownCurrency !== preferredCurrency);

  if (variant === 'phone') {
    const captionParts = [
      others.length > 0 ? joinOtherTotals(others) : null,
      `${activeCount} active`,
    ].filter((part): part is string => part !== null);

    return (
      <section
        aria-label="Totals"
        className="flex items-end justify-between gap-4 rounded-panel bg-navy p-5 text-navy-foreground"
      >
        <div className="flex min-w-0 flex-col">
          <p className="text-label-caps uppercase text-navy-muted-foreground">
            Each month
          </p>
          <p className="font-display text-title-lg tabular-nums text-navy-foreground">
            {formatMoney({ amount: monthly, currency: shownCurrency })}
          </p>
          <p className="text-caption text-navy-muted-foreground">
            {captionParts.join(' · ')}
          </p>
        </div>
        {nextRenewal ? (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-caption text-navy-muted-foreground">
              Next
            </span>
            <RenewalPill
              renewal={nextRenewal.renewal}
              className={
                nextRenewal.renewal.soon
                  ? undefined
                  : 'bg-navy-raised text-navy-foreground'
              }
            />
          </div>
        ) : null}
      </section>
    );
  }

  const yearly = monthly * 12;
  const linkClassName =
    'inline underline underline-offset-4 text-navy-muted-foreground hover:text-navy-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-accent disabled:cursor-not-allowed disabled:no-underline disabled:opacity-70';

  return (
    <section
      aria-label="Totals"
      className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4"
    >
      <div className="flex flex-col rounded-panel bg-navy p-6 text-navy-foreground">
        <p className="text-label-caps uppercase text-navy-muted-foreground">
          Each month (active)
        </p>
        <p className="mt-2 font-display text-display tabular-nums text-navy-foreground">
          {formatMoney({ amount: monthly, currency: shownCurrency })}
        </p>
        {isConverted ? (
          <p className="mt-2 text-caption text-navy-muted-foreground">
            {`All in ${preferredCurrency} · `}
            <button
              type="button"
              onClick={onShowOriginal}
              className={linkClassName}
            >
              Show original
            </button>
          </p>
        ) : null}
        {showConversion ? (
          <p className="mt-2 text-caption text-navy-muted-foreground">
            {others.length > 0 ? `${joinOtherTotals(others)} · ` : null}
            <button
              type="button"
              onClick={onConvert}
              disabled={conversion.status === 'loading'}
              className={linkClassName}
            >
              {conversion.status === 'loading'
                ? 'Converting…'
                : `Show all in ${preferredCurrency}`}
            </button>
          </p>
        ) : null}
      </div>

      <div className="flex flex-col rounded-panel border border-border bg-raised-surface p-6">
        <p className="text-label-caps uppercase text-muted-foreground">
          Each year
        </p>
        <p className="mt-2 font-display text-display tabular-nums text-foreground">
          {formatMoney({ amount: yearly, currency: shownCurrency })}
        </p>
        {others.length > 0 ? (
          <p className="mt-2 text-caption text-muted-foreground">
            {joinOtherTotals(others, 12)}
          </p>
        ) : null}
        <p className="mt-2 text-caption text-muted-foreground">
          Monthly, yearly and weekly plans combined
        </p>
      </div>

      <div className="flex flex-col rounded-panel border border-border bg-raised-surface p-6">
        <p className="text-label-caps uppercase text-muted-foreground">
          Next renewal
        </p>
        {nextRenewal ? (
          <>
            <p className="mt-2 font-display text-title break-words text-foreground">
              {nextRenewal.name}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <RenewalPill renewal={nextRenewal.renewal} />
              <span className="font-semibold tabular-nums text-foreground">
                {formatMoney({
                  amount: nextRenewal.amount,
                  currency: nextRenewal.currency,
                })}
              </span>
            </div>
          </>
        ) : (
          <p className="mt-2 text-body-sm text-muted-foreground">
            No upcoming renewals
          </p>
        )}
      </div>
    </section>
  );
};

export { SubscriptionsTotals };
export type { SubscriptionsTotalsProps };

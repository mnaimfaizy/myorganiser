import {
  SubscriptionBillingCycleEnum,
  SubscriptionStatusEnum,
  type CurrencyCode,
  type SubscriptionBillingCycle,
  type SubscriptionRecord,
  type SubscriptionStatus,
} from '@myorganiser/vault-core';
import {
  addYears,
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
  startOfDay,
} from 'date-fns';

/** A renewal this many days away or fewer is flagged as soon (amber). */
export const RENEWS_SOON_DAYS = 7;

/** "Tue 21 Oct". */
const WEEKDAY_DATE = 'EEE d MMM';

// Pinned to the cycle enum (ADR 0053): a cycle added to the enum and not here
// fails to compile instead of silently counting as one month.
const MONTHS_PER_CYCLE = {
  [SubscriptionBillingCycleEnum.Weekly]: 12 / 52,
  [SubscriptionBillingCycleEnum.Fortnightly]: 12 / 26,
  [SubscriptionBillingCycleEnum.Monthly]: 1,
  [SubscriptionBillingCycleEnum.Quarterly]: 3,
  [SubscriptionBillingCycleEnum.Yearly]: 12,
  [SubscriptionBillingCycleEnum.TwoYears]: 24,
  [SubscriptionBillingCycleEnum.ThreeYears]: 36,
} as const satisfies Record<SubscriptionBillingCycle, number>;

/**
 * What one billing of `amount` costs per month. A cycle that is not an enum
 * member (decrypted data from a different build) counts as monthly.
 */
export function monthlyEquivalent(
  amount: number,
  cycle: SubscriptionBillingCycle,
): number {
  const months = (MONTHS_PER_CYCLE as Record<string, number>)[cycle] ?? 1;
  return amount / months;
}

/**
 * The Monthly Equivalent of the active subscriptions in one currency.
 * `toCurrency` converts an amount from a record's currency; the caller owns
 * fetching the rates it uses.
 */
export function activeMonthlyEquivalentIn(
  items: readonly SubscriptionRecord[],
  toCurrency: (amount: number, from: CurrencyCode) => number,
): number {
  let monthly = 0;
  for (const s of items) {
    if (!isActiveSubscription(s)) continue;
    monthly += monthlyEquivalent(
      toCurrency(s.amount, s.currency),
      s.billingCycle,
    );
  }
  return monthly;
}

export function isActiveSubscription(record: SubscriptionRecord): boolean {
  return record.status === SubscriptionStatusEnum.Active;
}

export interface CurrencyMonthlyTotal {
  currency: CurrencyCode;
  /** The monthly equivalent of every active subscription in this currency. */
  monthly: number;
  count: number;
}

/**
 * The monthly equivalent of the active subscriptions, one total per currency.
 * The preferred currency comes first, then the rest alphabetically. Inactive,
 * pending, cancelled and expired subscriptions are left out, as today.
 */
export function activeMonthlyTotals(
  items: readonly SubscriptionRecord[],
  preferredCurrency: CurrencyCode,
): CurrencyMonthlyTotal[] {
  const byCurrency = new Map<CurrencyCode, CurrencyMonthlyTotal>();
  for (const s of items) {
    if (!isActiveSubscription(s)) continue;
    const monthly = monthlyEquivalent(s.amount, s.billingCycle);
    const existing = byCurrency.get(s.currency);
    if (existing) {
      existing.monthly += monthly;
      existing.count += 1;
    } else {
      byCurrency.set(s.currency, { currency: s.currency, monthly, count: 1 });
    }
  }

  return [...byCurrency.values()].sort((a, b) => {
    if (a.currency === preferredCurrency) return -1;
    if (b.currency === preferredCurrency) return 1;
    return a.currency.localeCompare(b.currency);
  });
}

/**
 * Reads the date portion of a stored ISO string as a local calendar day, so a
 * user behind UTC never sees the previous day.
 */
export function parseBillingDay(iso: string | undefined): Date | null {
  if (!iso) return null;
  const parsed = parseISO(iso.slice(0, 10));
  return isValid(parsed) ? parsed : null;
}

/** Whole calendar days from `today` to the date, or null when there is none. */
export function daysUntil(iso: string | undefined, today: Date): number | null {
  const day = parseBillingDay(iso);
  if (day === null) return null;
  return differenceInCalendarDays(day, startOfDay(today));
}

/** From today through `RENEWS_SOON_DAYS` days ahead. */
function isWithinSoonWindow(days: number): boolean {
  return days >= 0 && days <= RENEWS_SOON_DAYS;
}

export interface RenewalLabel {
  /** "Today", "Tomorrow", "In 3 days", or a short date such as "2 Nov". */
  label: string;
  /** Within `RENEWS_SOON_DAYS`, today included. Drives the amber pill. */
  soon: boolean;
}

/**
 * The renewal pill for a next billing date. Within a week it counts down in
 * days; further out, or in the past, it is the date. The year is added only
 * when the date is not within the coming year.
 */
export function formatRenewal(
  iso: string | undefined,
  today: Date,
): RenewalLabel | null {
  const day = parseBillingDay(iso);
  if (day === null) return null;
  const days = differenceInCalendarDays(day, startOfDay(today));

  if (isWithinSoonWindow(days)) {
    if (days === 0) return { label: 'Today', soon: true };
    if (days === 1) return { label: 'Tomorrow', soon: true };
    return { label: `In ${days} days`, soon: true };
  }

  const withinComingYear = days > 0 && day < addYears(startOfDay(today), 1);
  return {
    label: format(day, withinComingYear ? 'd MMM' : 'd MMM yyyy'),
    soon: false,
  };
}

/** "Tue 21 Oct", with " · in 3 days" (or " · today") when the renewal is soon. */
export function formatNextBillingDetail(
  iso: string | undefined,
  today: Date,
): string | null {
  const day = parseBillingDay(iso);
  const renewal = formatRenewal(iso, today);
  if (day === null || renewal === null) return null;
  const date = format(day, WEEKDAY_DATE);
  return renewal.soon ? `${date} · ${renewal.label.toLowerCase()}` : date;
}

/** "Tue 21 Oct", the bare weekday date, for the phone detail's "Renews …" line. */
export function formatWeekdayDate(iso: string | undefined): string | null {
  const day = parseBillingDay(iso);
  return day === null ? null : format(day, WEEKDAY_DATE);
}

/** "3 Mar 2024", or null when there is no date. */
export function formatLongDate(iso: string | undefined): string | null {
  const day = parseBillingDay(iso);
  return day === null ? null : format(day, 'd MMM yyyy');
}

/**
 * The active subscription that renews next, from today on. Ties go to the
 * name. Null when no active subscription has an upcoming billing date.
 */
export function nextActiveRenewal(
  items: readonly SubscriptionRecord[],
  today: Date,
): SubscriptionRecord | null {
  let best: { record: SubscriptionRecord; days: number } | null = null;
  for (const s of items) {
    if (!isActiveSubscription(s)) continue;
    const days = daysUntil(s.nextBillingDate, today);
    if (days === null || days < 0) continue;
    if (
      best === null ||
      days < best.days ||
      (days === best.days && s.name.localeCompare(best.record.name) < 0)
    ) {
      best = { record: s, days };
    }
  }
  return best?.record ?? null;
}

/** Active subscriptions renewing from today through `RENEWS_SOON_DAYS`. */
export function countRenewingSoon(
  items: readonly SubscriptionRecord[],
  today: Date,
): number {
  return items.filter((s) => {
    if (!isActiveSubscription(s)) return false;
    const days = daysUntil(s.nextBillingDate, today);
    return days !== null && isWithinSoonWindow(days);
  }).length;
}

/** "6 active · 2 renew this week", or "6 active" when nothing renews soon. */
export function formatSubscriptionsSummary(
  items: readonly SubscriptionRecord[],
  today: Date,
): string {
  const active = items.filter(isActiveSubscription).length;
  const soon = countRenewingSoon(items, today);
  if (soon === 0) return `${active} active`;
  return `${active} active · ${soon} ${soon === 1 ? 'renews' : 'renew'} this week`;
}

// The status chips' display order (SubscriptionsPage artboard), pinned to the
// status enum (ADR 0053): a status added to the enum and not here fails to
// compile instead of silently missing from the chips and the form.
const STATUS_FILTER_ORDER = {
  [SubscriptionStatusEnum.Active]: 0,
  [SubscriptionStatusEnum.Pending]: 1,
  [SubscriptionStatusEnum.Inactive]: 2,
  [SubscriptionStatusEnum.Cancelled]: 3,
  [SubscriptionStatusEnum.Expired]: 4,
} as const satisfies Record<SubscriptionStatus, number>;

/** The status chips in display order. */
export const SUBSCRIPTION_STATUS_FILTERS = (
  Object.keys(STATUS_FILTER_ORDER) as SubscriptionStatus[]
).sort((a, b) => STATUS_FILTER_ORDER[a] - STATUS_FILTER_ORDER[b]);

/**
 * The list filter: one status on desktop, or `others` (every status but
 * Active) on phone, where the artboard shows only Active and Others.
 */
export type SubscriptionListFilter = SubscriptionStatus | 'others';

export function countByStatus(
  items: readonly SubscriptionRecord[],
): Record<SubscriptionStatus, number> {
  const counts = {
    [SubscriptionStatusEnum.Active]: 0,
    [SubscriptionStatusEnum.Pending]: 0,
    [SubscriptionStatusEnum.Inactive]: 0,
    [SubscriptionStatusEnum.Cancelled]: 0,
    [SubscriptionStatusEnum.Expired]: 0,
  } satisfies Record<SubscriptionStatus, number>;
  for (const s of items) {
    if (s.status in counts) counts[s.status] += 1;
  }
  return counts;
}

export function filterSubscriptions(
  items: readonly SubscriptionRecord[],
  filter: SubscriptionListFilter,
): SubscriptionRecord[] {
  if (filter === 'others') return items.filter((s) => !isActiveSubscription(s));
  return items.filter((s) => s.status === filter);
}

export type SubscriptionSort = 'nextRenewal' | 'name';

export const SUBSCRIPTION_SORT_LABELS = {
  nextRenewal: 'Next renewal',
  name: 'Name',
} as const satisfies Record<SubscriptionSort, string>;

/**
 * Sorts a copy. Next renewal puts the earliest billing date first and the
 * subscriptions with no date last; ties, and the Name sort, go by name.
 */
export function sortSubscriptions(
  items: readonly SubscriptionRecord[],
  sort: SubscriptionSort,
): SubscriptionRecord[] {
  const byName = (a: SubscriptionRecord, b: SubscriptionRecord) =>
    a.name.localeCompare(b.name);
  if (sort === 'name') return [...items].sort(byName);

  return [...items].sort((a, b) => {
    const da = parseBillingDay(a.nextBillingDate)?.getTime() ?? null;
    const db = parseBillingDay(b.nextBillingDate)?.getTime() ?? null;
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    }
    return byName(a, b);
  });
}

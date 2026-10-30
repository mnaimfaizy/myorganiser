import {
  isSafeLink,
  monthlyEquivalentAmount,
  type CurrencyCode,
  type SubscriptionBillingCycle,
  type SubscriptionPaymentMethod,
  type SubscriptionRecord,
  type SubscriptionRenewalType,
  type SubscriptionStatus,
  type SubscriptionTier,
} from '@myorganiser/vault-core/portable';
import {
  formatCalendarDate,
  formatCalendarDateShort,
  formatDayMonth,
  parseCalendarDate,
} from './calendarDate';

/**
 * What the Subscriptions screens read out of a decrypted Subscriptions Vault
 * Blob.
 *
 * The payload is decrypted JSON written by some build of some client, so
 * every field but `id` is a claim — the same defensive reading
 * `taskModel.ts` and `groceryTripModel.ts` do for their own Vault Blob Types.
 * This module holds no React and imports no `react-native`, which is what
 * lets `libs/mobile/screens`' Jest project — a `node` environment with no
 * renderer — cover it.
 */
export type DecryptedSubscription = Partial<SubscriptionRecord> & {
  id: string;
};

/**
 * The List screen's four-way filter. Pending is not one of these — it is
 * shown grouped under Active with its own pill (CONTEXT.md), so the filter
 * itself only ever asks about the other four statuses.
 */
export type SubscriptionListFilter =
  | 'active'
  | 'inactive'
  | 'cancelled'
  | 'expired';

/** The unfiltered "renews within a week" window, in days. */
const RENEWING_SOON_DAYS = 7;

/**
 * How far ahead a renewal still reads as a countdown ("renews in 25 days").
 * Past it the row prints the date instead ("renews 3 Mar 2027") — a count
 * of a hundred-odd days is a number nobody can place (Sub-List).
 */
const COUNTDOWN_DAYS = 30;

/** Unambiguous per-currency prefixes (CurrencyCode's own five). */
const CURRENCY_PREFIXES = {
  AUD: 'A$',
  USD: 'US$',
  EUR: '€',
  GBP: '£',
  NZD: 'NZ$',
} as const satisfies Record<CurrencyCode, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toDecryptedSubscription(entry: unknown): DecryptedSubscription | null {
  if (!isRecord(entry)) return null;
  return typeof entry.id === 'string' && entry.id.length > 0
    ? (entry as DecryptedSubscription)
    : null;
}

function readVisibleSubscriptions(records: unknown): DecryptedSubscription[] {
  if (!Array.isArray(records)) return [];
  const subscriptions: DecryptedSubscription[] = [];
  for (const entry of records) {
    const subscription = toDecryptedSubscription(entry);
    if (subscription !== null) subscriptions.push(subscription);
  }
  return subscriptions;
}

/** Whether the payload holds any Subscription at all, whatever its status —
 * the List screen's "No Subscriptions yet" (Sub-List-Empty) is for none. */
export function hasVisibleSubscriptions(records: unknown): boolean {
  return readVisibleSubscriptions(records).length > 0;
}

/** The one Subscription with `id`, or `null` when the payload holds none —
 * deleted on another device while this screen was open. */
export function findVisibleSubscription(
  records: unknown,
  id: string,
): DecryptedSubscription | null {
  return readVisibleSubscriptions(records).find((sub) => sub.id === id) ?? null;
}

/** A Subscription's link, only when it is safe to open — `null` otherwise,
 * including a stored value with an unsafe scheme (issue #1281). */
export function openableSubscriptionLink(
  subscription: DecryptedSubscription,
): string | null {
  const link = subscription.link?.trim();
  return link != null && link.length > 0 && isSafeLink(link) ? link : null;
}

/** A Subscription's status, defaulting to `active` when the payload carries
 * none — the same "oldest data has no opinion" default `taskModel.ts` gives
 * a missing status. */
export function subscriptionStatus(
  subscription: DecryptedSubscription,
): SubscriptionStatus {
  return subscription.status ?? 'active';
}

/**
 * Whether `subscription` belongs on the List screen's `filter` tab. The
 * Active tab also carries Pending — it is shown there with its own pill
 * rather than in a filter of its own (CONTEXT.md).
 */
function matchesFilter(
  subscription: DecryptedSubscription,
  filter: SubscriptionListFilter,
): boolean {
  const status = subscriptionStatus(subscription);
  if (filter === 'active') return status === 'active' || status === 'pending';
  return status === filter;
}

/**
 * `value`'s calendar date, read as three local components — the same
 * boundary-safe parse `taskModel.ts` uses for a due date, so a next billing
 * date compares against "today" the same way a Task's due date does.
 */
function parseDateOnly(
  value: string,
): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

function startOfLocalDay(y: number, m: number, d: number): number {
  return new Date(y, m, d).getTime();
}

/** Calendar days from `now`'s local day to `dateOnly`'s, or `null` when
 * `dateOnly` does not parse. Negative means the date has already passed. */
function daysUntil(dateOnly: string, now: Date): number | null {
  const parsed = parseDateOnly(dateOnly);
  if (parsed === null) return null;
  const due = startOfLocalDay(parsed.y, parsed.m, parsed.d);
  const today = startOfLocalDay(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  return Math.round((due - today) / (24 * 60 * 60 * 1000));
}

/** Whether `subscription` renews within the next seven days (today included).
 * A Subscription with no next billing date is never Renewing soon — it has
 * nothing to be soon about. */
function isRenewingSoon(
  subscription: DecryptedSubscription,
  now: Date,
): boolean {
  if (subscription.nextBillingDate == null) return false;
  const days = daysUntil(subscription.nextBillingDate, now);
  return days !== null && days >= 0 && days <= RENEWING_SOON_DAYS;
}

/**
 * Orders by next billing date ascending; a Subscription with no next billing
 * date sorts last, whichever filter tab it is on. Both dates are
 * `IsoDateTimeString`, so a lexicographic compare is a chronological one.
 */
function compareByNextBillingDate(
  a: DecryptedSubscription,
  b: DecryptedSubscription,
): number {
  const aHas = a.nextBillingDate != null;
  const bHas = b.nextBillingDate != null;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  if (!aHas && !bHas) return 0;
  return (a.nextBillingDate as string).localeCompare(
    b.nextBillingDate as string,
  );
}

/**
 * The Cancelled tab's order: most recently cancelled first (Sub-List-Cancelled
 * lists "Cancelled 12 Aug" above "Cancelled 2 Jun"), with a Subscription that
 * carries no cancellation date last. A next billing date means nothing on a
 * Cancelled Subscription — there is no next bill.
 */
function compareByCancellationDateDescending(
  a: DecryptedSubscription,
  b: DecryptedSubscription,
): number {
  const aDate = a.cancellationDate;
  const bDate = b.cancellationDate;
  if (aDate != null && bDate == null) return -1;
  if (aDate == null && bDate != null) return 1;
  if (aDate == null || bDate == null) return 0;
  return bDate.localeCompare(aDate);
}

/** What the List screen renders for one filter tab: the Renewing soon bucket
 * (Active tab only — CONTEXT.md's Monthly Equivalent card is Active-only for
 * the same reason), then the rest, ordered by next billing date with no date
 * sorting last — except on Cancelled, which lists the most recently
 * cancelled first. The two never overlap: a Subscription placed in `renewingSoon`
 * is not repeated in `items`. */
export interface SubscriptionListView {
  renewingSoon: DecryptedSubscription[];
  items: DecryptedSubscription[];
}

export function selectSubscriptionListView(
  records: unknown,
  filter: SubscriptionListFilter,
  now: Date,
): SubscriptionListView {
  const matching = readVisibleSubscriptions(records).filter((subscription) =>
    matchesFilter(subscription, filter),
  );

  const renewingSoon =
    filter === 'active'
      ? matching
          .filter((subscription) => isRenewingSoon(subscription, now))
          .sort(compareByNextBillingDate)
      : [];

  const renewingSoonIds = new Set(
    renewingSoon.map((subscription) => subscription.id),
  );
  const items = matching
    .filter((subscription) => !renewingSoonIds.has(subscription.id))
    .sort(
      filter === 'cancelled'
        ? compareByCancellationDateDescending
        : compareByNextBillingDate,
    );

  return { renewingSoon, items };
}

/**
 * The Monthly Equivalent summed per currency, over the Subscriptions this
 * screen can already see. Mobile keeps no `normalizeSubscriptions` validation
 * pass (that lives in `@myorganiser/web-vault`, a web-only library) — a
 * decrypted record here is only ever a `DecryptedSubscription` claim, so this
 * checks the three fields `monthlyEquivalentAmount` reads are actually
 * present before calling it, and skips a record missing any of them rather
 * than propagating a `NaN` into a currency's total. The arithmetic itself —
 * the factor table and the per-record calculation — is not reimplemented
 * here; only the defensive field check and the per-currency grouping are.
 */
export function calculateVisibleMonthlyEquivalents(
  subscriptions: readonly DecryptedSubscription[],
): Array<{ currency: CurrencyCode; amount: number }> {
  const totals = new Map<CurrencyCode, number>();
  for (const subscription of subscriptions) {
    if (subscriptionStatus(subscription) !== 'active') continue;
    if (
      subscription.amount == null ||
      subscription.billingCycle == null ||
      subscription.currency == null
    ) {
      continue;
    }
    const amount = monthlyEquivalentAmount(subscription as SubscriptionRecord);
    totals.set(
      subscription.currency,
      (totals.get(subscription.currency) ?? 0) + amount,
    );
  }
  return Array.from(totals.entries()).map(([currency, amount]) => ({
    currency,
    amount,
  }));
}

// --- Presentation tables ------------------------------------------------
//
// One label per enum member, pinned (ADR 0053): a member added to its enum
// and not here fails to compile, rather than printing a raw key. Every
// Subscriptions screen on mobile reads these; none keeps a copy of its own.

/**
 * A status as the screens print it. Declared in the order the Edit sheet
 * offers them (Sub-Edit): Active, Pending, Inactive, Expired, Cancelled.
 */
export const SUBSCRIPTION_STATUS_LABELS = {
  active: 'Active',
  pending: 'Pending',
  inactive: 'Inactive',
  expired: 'Expired',
  cancelled: 'Cancelled',
} as const satisfies Record<SubscriptionStatus, string>;

/** The statuses in the Edit sheet's order — the table above's own keys. */
export const SUBSCRIPTION_STATUS_ORDER = Object.keys(
  SUBSCRIPTION_STATUS_LABELS,
) as SubscriptionStatus[];

/** A billing cycle named on its own — the Detail's "Billing cycle" row, the New chips. */
export const BILLING_CYCLE_LABELS = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  twoYears: 'Every 2 years',
  threeYears: 'Every 3 years',
} as const satisfies Record<SubscriptionBillingCycle, string>;

/** The New sheet's cycle chips, in the table's (and the design's) order. */
export const BILLING_CYCLE_ORDER = Object.keys(
  BILLING_CYCLE_LABELS,
) as SubscriptionBillingCycle[];

/** A billing cycle as the unit after an amount — "A$22.99 / month". */
export const BILLING_CYCLE_UNITS = {
  weekly: '/ week',
  fortnightly: '/ fortnight',
  monthly: '/ month',
  quarterly: '/ quarter',
  yearly: '/ year',
  twoYears: '/ 2 years',
  threeYears: '/ 3 years',
} as const satisfies Record<SubscriptionBillingCycle, string>;

export const PAYMENT_METHOD_LABELS = {
  creditCard: 'Credit card',
  paypal: 'PayPal',
  bankTransfer: 'Bank transfer',
} as const satisfies Record<SubscriptionPaymentMethod, string>;

export const RENEWAL_TYPE_LABELS = {
  autoRenew: 'Auto-renew',
  manual: 'Manual',
} as const satisfies Record<SubscriptionRenewalType, string>;

export const TIER_LABELS = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
  enterprise: 'Enterprise',
  individual: 'Individual',
  family: 'Family',
} as const satisfies Record<SubscriptionTier, string>;

/** Each currency's own name — the New sheet's Currency picker (Sub-New-Currency). */
export const CURRENCY_NAMES = {
  AUD: 'Australian dollar',
  USD: 'US dollar',
  EUR: 'Euro',
  GBP: 'British pound',
  NZD: 'New Zealand dollar',
} as const satisfies Record<CurrencyCode, string>;

/** The Currency picker's rows, in the table's (and the design's) order. */
export const CURRENCY_ORDER = Object.keys(CURRENCY_NAMES) as CurrencyCode[];

/** A currency's unambiguous prefix on its own — the Currency picker's "· A$". */
export function currencyPrefix(currency: CurrencyCode): string {
  return CURRENCY_PREFIXES[currency];
}

// --- Dates and renewal wording ------------------------------------------

/**
 * When a Subscription renews, as a row's subtitle reads it (Sub-List):
 * "renews today", "renews tomorrow", "renews in 11 days", and past a month
 * the date itself — "renews 3 Mar 2027". "No renewal date" when there is
 * nothing to count down to (#908 story 49).
 */
export function describeRenewal(
  subscription: DecryptedSubscription,
  now: Date,
): string {
  const date = subscription.nextBillingDate;
  if (date == null) return 'No renewal date';
  const days = daysUntil(date, now);
  if (days === null) return 'No renewal date';
  if (days < 0) return 'renewal overdue';
  if (days === 0) return 'renews today';
  if (days === 1) return 'renews tomorrow';
  if (days <= COUNTDOWN_DAYS) return `renews in ${days} days`;
  return `renews ${formatDayMonth(date, now)}`;
}

function sentenceCase(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/** A calendar date with its year only when it is not `now`'s: "Tue 29 Sep" / "Wed 3 Mar 2027". */
function formatDateAgainst(iso: string, now: Date): string {
  const date = parseCalendarDate(iso);
  if (date === null) return iso;
  return date.getFullYear() === now.getFullYear()
    ? formatCalendarDateShort(iso)
    : formatCalendarDate(iso);
}

/**
 * The Detail hero's schedule line, before its renewal-type part (Sub-Detail):
 * "Renews in 2 days · Tue 29 Sep". Past a month the countdown drops out and
 * the date carries the line: "Renews Wed 3 Mar 2027". A Cancelled
 * Subscription says when it stopped instead (Sub-Detail-Cancelled):
 * "Cancelled Wed 12 Aug 2026 · no further charges".
 */
export function describeScheduleLine(
  subscription: DecryptedSubscription,
  now: Date,
): string {
  if (subscriptionStatus(subscription) === 'cancelled') {
    return subscription.cancellationDate != null
      ? `Cancelled ${formatCalendarDate(subscription.cancellationDate)} · no further charges`
      : 'Cancelled · no further charges';
  }
  const date = subscription.nextBillingDate;
  const renewal = describeRenewal(subscription, now);
  if (date == null || parseCalendarDate(date) === null) return renewal;
  const days = daysUntil(date, now);
  if (days !== null && days > COUNTDOWN_DAYS) {
    return `Renews ${formatDateAgainst(date, now)}`;
  }
  return `${sentenceCase(renewal)} · ${formatDateAgainst(date, now)}`;
}

/**
 * A non-Active row's subtitle on its filter tab. A Cancelled one says when
 * (Sub-List-Cancelled: "Cancelled 12 Aug"); the others keep the renewal
 * wording the Active tab uses.
 */
export function describeRowSubtitle(
  subscription: DecryptedSubscription,
  now: Date,
): string {
  if (subscriptionStatus(subscription) !== 'cancelled') {
    return describeRenewal(subscription, now);
  }
  return subscription.cancellationDate != null
    ? `Cancelled ${formatDayMonth(subscription.cancellationDate, now)}`
    : 'Cancelled';
}

/** A stored date printed in full ("Tue 29 Sep 2026"), or "—" when there is none. */
export function formatStoredDate(value: string | undefined): string {
  return value != null && value.length > 0 ? formatCalendarDate(value) : '—';
}

/**
 * A stored date as the date picker's `YYYY-MM-DD`, or `null`. A date-time
 * stored by another client keeps its calendar-day part.
 */
export function toPickerDate(value: string | undefined): string | null {
  if (value == null) return null;
  const day = value.slice(0, 10);
  return parseCalendarDate(day) !== null ? day : null;
}

// --- Monthly Equivalent presentation --------------------------------------

/** Whether a Subscription is Active and carries everything its Monthly Equivalent needs. */
function countsTowardMonthlyEquivalent(
  subscription: DecryptedSubscription,
): subscription is DecryptedSubscription & {
  amount: number;
  billingCycle: SubscriptionBillingCycle;
  currency: CurrencyCode;
} {
  return (
    subscriptionStatus(subscription) === 'active' &&
    subscription.amount != null &&
    subscription.billingCycle != null &&
    subscription.currency != null
  );
}

/** How many Active Subscriptions the Monthly Equivalent card is counting ("7 active"). */
export function countActiveSubscriptions(
  subscriptions: readonly DecryptedSubscription[],
): number {
  return subscriptions.filter(
    (subscription) => subscriptionStatus(subscription) === 'active',
  ).length;
}

/** One worked example on the Monthly Equivalent explainer (Sub-List-Explainer). */
export interface MonthlyEquivalentExample {
  id: string;
  /** "Anytime Gym · A$17.50 / week" */
  label: string;
  /** "≈ A$75.83" */
  equivalent: string;
}

/**
 * The explainer's worked examples: every counted Subscription whose cycle is
 * not already monthly — a monthly one restates as itself and teaches nothing
 * — grouped by currency in the card's order, then in the order given.
 */
export function monthlyEquivalentExamples(
  subscriptions: readonly DecryptedSubscription[],
): MonthlyEquivalentExample[] {
  const counted = subscriptions.filter(countsTowardMonthlyEquivalent);
  const currencies: CurrencyCode[] = [];
  for (const subscription of counted) {
    if (!currencies.includes(subscription.currency)) {
      currencies.push(subscription.currency);
    }
  }
  return currencies.flatMap((currency) =>
    counted
      .filter(
        (subscription) =>
          subscription.currency === currency &&
          subscription.billingCycle !== 'monthly',
      )
      .map((subscription) => ({
        id: subscription.id,
        label: `${subscription.name ?? 'Untitled subscription'} · ${formatSubscriptionAmount(
          subscription.amount,
          currency,
        )} ${BILLING_CYCLE_UNITS[subscription.billingCycle]}`,
        equivalent: `≈ ${formatSubscriptionAmount(
          monthlyEquivalentAmount(subscription as SubscriptionRecord),
          currency,
        )}`,
      })),
  );
}

/**
 * One Subscription's own Monthly Equivalent ("≈ A$22.99"), or `null` when it
 * does not count toward one — anything not Active, or missing a field.
 */
export function describeMonthlyEquivalent(
  subscription: DecryptedSubscription,
): string | null {
  if (!countsTowardMonthlyEquivalent(subscription)) return null;
  return `≈ ${formatSubscriptionAmount(
    monthlyEquivalentAmount(subscription as SubscriptionRecord),
    subscription.currency,
  )}`;
}

// --- Form validation --------------------------------------------------------

/** Sub-Edit-Error and Sub-New-Errors, verbatim. */
export const AMOUNT_ERROR = 'Enter an amount above 0';
export const NAME_ERROR = 'Give it a name';

/**
 * An amount draft read as money, or why it cannot be one. Zero is not a
 * Subscription's price, so it is refused with the rest (Sub-Edit-Error).
 */
export function parseAmountDraft(
  draft: string,
): { ok: true; amount: number } | { ok: false; error: string } {
  const trimmed = draft.trim();
  const amount = Number(trimmed);
  if (trimmed.length === 0 || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: AMOUNT_ERROR };
  }
  return { ok: true, amount };
}

function withThousands(fixed: string): string {
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [whole, decimals] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${decimals}`;
}

/** An amount with an unambiguous currency prefix — `A$`, `US$`, `NZ$`, `€`,
 * `£` — never a bare `$`, which reads as three different currencies here. */
export function formatSubscriptionAmount(
  amount: number,
  currency: CurrencyCode,
): string {
  return `${CURRENCY_PREFIXES[currency]}${withThousands(amount.toFixed(2))}`;
}

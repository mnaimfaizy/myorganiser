import { formatMoney } from '@myorganiser/core';
import {
  calculateMonthlyEquivalents,
  isClosedTaskStatus,
  SubscriptionStatusEnum,
  type CatalogItem,
  type CurrencyCode,
  type GroceryList,
  type SubscriptionRecord,
  type Task,
  type TaskContext,
  type TaskPriority,
} from '@myorganiser/vault-core';
import {
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
  startOfDay,
} from 'date-fns';

/**
 * Pure derivations for the Home page. Nothing here reads the vault or React
 * state: the caller passes normalised records and the clock (`now`), so every
 * function is unit-testable. The page-private helpers these mirror live in
 * other route libraries that this page may not import (Nx page boundary).
 */

/** A renewal this many days away or fewer is "renewing soon". */
export const RENEWS_SOON_DAYS = 7;

/** The labels a Task context reads as, pinned to the context enum (ADR 0053). */
const CONTEXT_LABELS = {
  personal: 'Personal',
  work: 'Work',
} as const satisfies Record<TaskContext, string>;

/** Open-Task contexts in display order: Personal, then Work. */
const CONTEXT_ORDER = [
  'personal',
  'work',
] as const satisfies readonly TaskContext[];

const PRIORITY_RANK = {
  high: 0,
  medium: 1,
  low: 2,
} as const satisfies Record<TaskPriority, number>;

/** A local calendar date as `YYYY-MM-DD`, the shape a Task's `dueDate` takes. */
export function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Morning before 12, afternoon before 18, evening after. */
export function getGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** `$12.50`, the Groceries page's own money format. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** The singular for a count of one, otherwise the plural. */
export function pluralize(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

// --- Tasks -----------------------------------------------------------------

export interface HomeDueTask {
  id: string;
  title: string;
  dueDate: string;
  /** Due before today (overdue) rather than due today. */
  overdue: boolean;
}

export interface TasksHomeSummary {
  /** Open (not done, not cancelled) Tasks. */
  open: number;
  /** Context labels present among the open Tasks, Personal before Work. */
  openContexts: readonly ('Personal' | 'Work')[];
  /** Open Tasks due today or earlier, overdue first. */
  dueOpen: readonly HomeDueTask[];
  /** Tasks marked done today that were due today or earlier. */
  doneToday: number;
  /** Due today or overdue, plus those completed today. */
  todayTotal: number;
  todayDone: number;
}

function compareDueTasks(a: Task, b: Task): number {
  const byDue = (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
  if (byDue !== 0) return byDue;
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  return a.title.localeCompare(b.title);
}

export function summarizeTasks(
  tasks: readonly Task[],
  now: Date,
): TasksHomeSummary {
  const today = localDateKey(now);
  const live = tasks.filter((task) => !task.archived);
  const open = live.filter((task) => !isClosedTaskStatus(task.status));

  const dueOpen = open
    .filter((task) => task.dueDate !== undefined && task.dueDate <= today)
    .sort(compareDueTasks);

  const doneToday = live.filter(
    (task) =>
      task.status === 'done' &&
      task.dueDate !== undefined &&
      task.dueDate <= today &&
      task.closedAt !== undefined &&
      localDateKey(new Date(task.closedAt)) === today,
  ).length;

  const contexts = new Set(open.map((task) => task.context));
  const openContexts = CONTEXT_ORDER.filter((context) =>
    contexts.has(context),
  ).map((context) => CONTEXT_LABELS[context]);

  return {
    open: open.length,
    openContexts,
    dueOpen: dueOpen.map((task) => ({
      id: task.id,
      title: task.title,
      dueDate: task.dueDate ?? today,
      overdue: (task.dueDate ?? today) < today,
    })),
    doneToday,
    todayTotal: dueOpen.length + doneToday,
    todayDone: doneToday,
  };
}

// --- Subscriptions ---------------------------------------------------------

export interface HomeRenewal {
  id: string;
  name: string;
  /** The billing day, as a local calendar date. */
  renewsOn: Date;
  amount: number;
  currency: CurrencyCode;
}

export interface SubscriptionsHomeSummary {
  active: number;
  /** Each active currency's monthly equivalent, joined " + ". Empty if none. */
  monthly: string;
  /** Active renewals from today through `RENEWS_SOON_DAYS`, soonest first. */
  renewingSoon: readonly HomeRenewal[];
}

/** Reads the date part of a stored ISO string as a local calendar day. */
function billingDay(iso: string | undefined): Date | null {
  if (!iso) return null;
  const parsed = parseISO(iso.slice(0, 10));
  return isValid(parsed) ? parsed : null;
}

function daysFromToday(day: Date, now: Date): number {
  return differenceInCalendarDays(day, startOfDay(now));
}

export function summarizeSubscriptions(
  subscriptions: readonly SubscriptionRecord[],
  now: Date,
): SubscriptionsHomeSummary {
  const active = subscriptions.filter(
    (sub) => sub.status === SubscriptionStatusEnum.Active,
  );

  const renewals: { record: HomeRenewal; days: number }[] = [];
  for (const sub of active) {
    const day = billingDay(sub.nextBillingDate);
    if (day === null) continue;
    const days = daysFromToday(day, now);
    if (days < 0 || days > RENEWS_SOON_DAYS) continue;
    renewals.push({
      record: {
        id: sub.id,
        name: sub.name,
        renewsOn: day,
        amount: sub.amount,
        currency: sub.currency,
      },
      days,
    });
  }
  renewals.sort(
    (a, b) => a.days - b.days || a.record.name.localeCompare(b.record.name),
  );

  const monthly = calculateMonthlyEquivalents(subscriptions)
    .map(({ currency, amount }) => formatMoney({ amount, currency }))
    .join(' + ');

  return {
    active: active.length,
    monthly,
    renewingSoon: renewals.map((entry) => entry.record),
  };
}

// --- Groceries -------------------------------------------------------------

export interface GroceriesHomeSummary {
  listCount: number;
  /** Unchecked List Lines across every list. */
  itemsLeft: number;
  /**
   * Known spend: each List Line counts its Catalog Item's numeric price, the
   * same rule the Groceries page total uses. Lines with no price add nothing.
   */
  knownSpend: number;
}

export function summarizeGroceries(input: {
  lists: readonly GroceryList[];
  catalog: readonly CatalogItem[];
}): GroceriesHomeSummary {
  const priceById = new Map<string, number>();
  for (const item of input.catalog) {
    if (typeof item.price === 'number' && Number.isFinite(item.price)) {
      priceById.set(item.id, item.price);
    }
  }

  let itemsLeft = 0;
  let knownSpend = 0;
  for (const list of input.lists) {
    for (const line of list.lines) {
      if (!line.checked) itemsLeft += 1;
      const price = priceById.get(line.catalogItemId);
      if (price !== undefined) knownSpend += price;
    }
  }

  return { listCount: input.lists.length, itemsLeft, knownSpend };
}

// --- Addresses and mobile numbers ------------------------------------------

export interface CountedRecordsSummary {
  count: number;
  /** Usage locations across every record. */
  places: number;
  /** Usage locations marked changed (updated on the other service). */
  updatedPlaces: number;
}

export function summarizeCountedRecords(
  records: readonly {
    usageLocations: readonly { changed: boolean }[];
  }[],
): CountedRecordsSummary {
  let places = 0;
  let updatedPlaces = 0;
  for (const record of records) {
    places += record.usageLocations.length;
    updatedPlaces += record.usageLocations.filter((l) => l.changed).length;
  }
  return { count: records.length, places, updatedPlaces };
}

/** "Tue 21 Oct", the weekday date a renewal row shows. */
export function formatRenewalDay(day: Date): string {
  return format(day, 'EEE d MMM');
}

/** The date caption above the hero: "Sunday, 18 October". */
export function formatDateCaption(now: Date): string {
  return format(now, 'EEEE, d MMMM');
}

/** Whether an ISO timestamp parses to a real date. */
export function isParseableTimestamp(iso: string): boolean {
  return !Number.isNaN(new Date(iso).getTime());
}

/** Every vault-derived number the Home spaces and cards read. */
export interface HomeSummaryData {
  tasks: TasksHomeSummary;
  subscriptions: SubscriptionsHomeSummary;
  groceries: GroceriesHomeSummary;
  addresses: CountedRecordsSummary;
  mobile: CountedRecordsSummary;
}

/**
 * Read-only views over the groceries payload that the Web v2.0 pages share:
 * a Grocery List's progress, its open List Lines grouped in shop-walk order,
 * and how many Grocery Lists carry each Catalog Item. Nothing here writes.
 */

import {
  GROCERY_CATEGORY_ORDER,
  type CatalogItem,
  type GroceryCategoryType,
  type GroceryList,
  type ListLine,
} from '@myorganiser/vault-core';

export interface ListProgress {
  total: number;
  checked: number;
  /** Lines not yet checked. */
  left: number;
  /** True when the list has lines and every one is checked. */
  allBought: boolean;
}

export function summarizeListProgress(
  lines: readonly ListLine[],
): ListProgress {
  const checked = lines.filter((line) => line.checked).length;
  return {
    total: lines.length,
    checked,
    left: lines.length - checked,
    allBought: lines.length > 0 && checked === lines.length,
  };
}

/** A List Line beside the Catalog Item it references (undefined when missing). */
export interface ResolvedLine {
  line: ListLine;
  item: CatalogItem | undefined;
}

export interface CategoryGroup {
  category: GroceryCategoryType;
  lines: ResolvedLine[];
}

/**
 * A category as it arrives from decrypted data, folded into the vocabulary:
 * anything the order does not know groups under Other.
 */
export function toKnownCategory(
  category: string | undefined,
): GroceryCategoryType {
  return (GROCERY_CATEGORY_ORDER as readonly string[]).includes(category ?? '')
    ? (category as GroceryCategoryType)
    : 'other';
}

/**
 * Groups List Lines by their Catalog Item's category in shop-walk order
 * (GROCERY_CATEGORY_ORDER). Empty categories are omitted; lines keep their
 * order inside a group.
 */
export function groupLinesByCategory(
  lines: readonly ListLine[],
  catalog: readonly CatalogItem[],
): CategoryGroup[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const buckets = new Map<GroceryCategoryType, ResolvedLine[]>();

  for (const line of lines) {
    const item = byId.get(line.catalogItemId);
    const category = toKnownCategory(item?.category);
    const bucket = buckets.get(category) ?? [];
    bucket.push({ line, item });
    buckets.set(category, bucket);
  }

  return GROCERY_CATEGORY_ORDER.filter((category) => buckets.has(category)).map(
    (category) => ({ category, lines: buckets.get(category) ?? [] }),
  );
}

/** How many Grocery Lists carry at least one List Line for each Catalog Item. */
export function countListsPerCatalogItem(
  lists: readonly GroceryList[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const id of new Set(list.lines.map((line) => line.catalogItemId))) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** `1 list`, `4 lists`; pass `plural` when adding "s" is wrong. */
export function pluralize(
  count: number,
  singular: string,
  plural?: string,
): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** `just now`, `5 minutes ago`, `2 hours ago`, `yesterday`, `3 days ago`. */
export function formatRelativeTime(
  iso: string,
  now: Date = new Date(),
): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60 * 1000) return 'just now';

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (elapsed >= ms) {
      return relativeFormat.format(-Math.floor(elapsed / ms), unit);
    }
  }
  return 'just now';
}

/**
 * When a Grocery List last changed: the newest of the list's own `updatedAt`
 * and its List Lines' `updatedAt`, because adding, ticking or editing a line
 * does not touch the list record itself.
 */
export function lastListActivity(list: GroceryList): string {
  let latest = list.updatedAt;
  for (const line of list.lines) {
    if (Date.parse(line.updatedAt) > Date.parse(latest))
      latest = line.updatedAt;
  }
  return latest;
}

/** `Updated 2 hours ago`, or `Created 3 days ago` for a list never edited since. */
export function formatListActivity(
  list: GroceryList,
  now: Date = new Date(),
): string {
  const latest = lastListActivity(list);
  const neverUpdated = latest === list.createdAt;
  return `${neverUpdated ? 'Created' : 'Updated'} ${formatRelativeTime(
    latest,
    now,
  )}`;
}

/** What a List Line shows when its Catalog Item cannot be found. */
export const UNKNOWN_ITEM_NAME = 'Unknown item';

/** Which layout a groceries component renders: the desktop page or the phone screen. */
export type GroceriesLayout = 'desktop' | 'phone';

/**
 * Catalog Items whose name contains `query`, ignoring case and surrounding
 * spaces. An empty query matches every item. Order is preserved.
 */
export function searchCatalog<T extends Pick<CatalogItem, 'name'>>(
  catalog: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...catalog];
  return catalog.filter((item) => item.name.toLowerCase().includes(needle));
}

/**
 * Trip Board spend summary helpers.
 * Prices live on the CatalogItem (durable identity); ListLine is trip-local
 * state (checked, amount). A line only contributes to "known spend" when its
 * referenced CatalogItem has a numeric price — missing prices are never
 * silently treated as $0.
 */

import type { CatalogItem, ListLine } from '@myorganiser/vault-core';

export interface ListSpendSummary {
  /** Sum of prices for lines whose Catalog Item has a known price. */
  known: number;
  /** Count of lines whose Catalog Item has no price set. */
  unpricedCount: number;
  /** Count of lines whose Catalog Item has a known price. */
  pricedCount: number;
  /** Known spend restricted to Checked Items only. */
  checkedKnown: number;
}

/**
 * Resolves the CatalogItem referenced by a ListLine, or undefined if the
 * reference is missing (should not happen after normalization, but defends
 * against stale UI state mid-mutation).
 */
export function resolveCatalogItem(
  line: ListLine,
  catalog: CatalogItem[],
): CatalogItem | undefined {
  return catalog.find((item) => item.id === line.catalogItemId);
}

/**
 * Summarizes known spend + unpriced count for a set of List Lines against
 * the vault's Catalog Item price data.
 */
export function summarizeListSpend(
  lines: ListLine[],
  catalog: CatalogItem[],
): ListSpendSummary {
  let known = 0;
  let unpricedCount = 0;
  let pricedCount = 0;
  let checkedKnown = 0;

  for (const line of lines) {
    const catalogItem = resolveCatalogItem(line, catalog);
    const price = catalogItem?.price;

    if (typeof price === 'number' && Number.isFinite(price)) {
      known += price;
      pricedCount += 1;
      if (line.checked) checkedKnown += price;
    } else {
      unpricedCount += 1;
    }
  }

  return { known, unpricedCount, pricedCount, checkedKnown };
}

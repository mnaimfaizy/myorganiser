/**
 * Formats a plain number as a fixed US-dollar string, e.g. `$12.50` — always
 * two decimals, always `$`, no currency conversion and no locale. Distinct
 * from `formatMoney`, which is `Intl`-based and takes a `CurrencyCode`; this
 * is for amounts that are already dollars and need no locale formatting.
 */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

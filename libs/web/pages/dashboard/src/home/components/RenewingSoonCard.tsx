import Link from 'next/link';

import type { HomeRenewalRow } from '../home-view';

export interface RenewingSoonCardProps {
  rows: readonly HomeRenewalRow[];
  loading: boolean;
}

/** Up to five active subscriptions renewing within the week. */
export function RenewingSoonCard({ rows, loading }: RenewingSoonCardProps) {
  return (
    <section
      aria-labelledby="home-renewing-title"
      className="flex flex-col rounded-panel border border-border bg-raised-surface p-5"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2
          id="home-renewing-title"
          className="m-0 font-display text-title text-foreground"
        >
          Renewing soon
        </h2>
        <Link
          href="/dashboard/subscriptions"
          className="text-caption font-semibold text-brand-text"
        >
          All subscriptions
        </Link>
      </div>
      {loading ? (
        <p className="m-0 text-body-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="m-0 text-body-sm text-muted-foreground">
          Nothing renews this week.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex min-h-[52px] items-center gap-3 border-t border-border-subtle"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-sm text-foreground">
                  {row.name}
                </span>
                <span className="text-caption text-muted-foreground">
                  {row.when}
                </span>
              </span>
              <span className="text-body-sm font-semibold tabular-nums text-foreground">
                {row.amount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

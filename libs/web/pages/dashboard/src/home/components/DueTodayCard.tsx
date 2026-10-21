import Link from 'next/link';

import type { HomeDueRow } from '../home-view';
import { HomeStatePill } from './HomeStatePill';

export interface DueTodayCardProps {
  rows: readonly HomeDueRow[];
  loading: boolean;
}

/** Up to five open Tasks due today or overdue. Read-only: no checkboxes here. */
export function DueTodayCard({ rows, loading }: DueTodayCardProps) {
  return (
    <section
      aria-labelledby="home-due-today-title"
      className="flex flex-col rounded-panel border border-border bg-raised-surface p-5"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2
          id="home-due-today-title"
          className="m-0 font-display text-title text-foreground"
        >
          Due today
        </h2>
        <Link
          href="/dashboard/tasks"
          className="text-caption font-semibold text-brand-text"
        >
          All tasks
        </Link>
      </div>
      {loading ? (
        <p className="m-0 text-body-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="m-0 text-body-sm text-muted-foreground">
          Nothing due today.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex min-h-[52px] items-center gap-3 border-t border-border-subtle"
            >
              <span className="min-w-0 flex-1 text-body-sm text-foreground">
                {row.title}
              </span>
              <HomeStatePill pill={row.pill} surface="desktop" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

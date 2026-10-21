import { Illustration } from '@myorganiser/web-ui';
import Link from 'next/link';

import type { HomeView } from '../home-view';
import { HomeProgress } from './HomeProgress';

export interface HomeTodayCardProps {
  view: HomeView;
}

/** The phone's unlocked headline: what is due today, and how far through it. */
export function HomeTodayCard({ view }: HomeTodayCardProps) {
  const progress = view.progress;
  return (
    <section
      aria-label="Today"
      className="flex items-center gap-3.5 rounded-panel bg-navy p-4.5 text-navy-foreground"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-label-caps text-navy-accent">TODAY</span>
        <span className="font-display text-title text-navy-foreground">
          {view.todayTitle}
        </span>
        {progress && (
          <HomeProgress done={progress.done} total={progress.total} />
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-caption text-navy-muted-foreground">
            {view.todayMeta}
          </span>
          <Link
            href="/dashboard/tasks"
            aria-label="Open today's tasks"
            className="shrink-0 p-1 text-caption font-semibold text-navy-accent no-underline"
          >
            Open
          </Link>
        </div>
      </div>
      <Illustration kind="tasks" size={64} />
    </section>
  );
}

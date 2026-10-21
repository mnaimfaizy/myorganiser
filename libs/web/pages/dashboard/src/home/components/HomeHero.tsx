import { Button, Illustration } from '@myorganiser/web-ui';
import { Plus } from 'lucide-react';
import Link from 'next/link';

import type { HomeView } from '../home-view';
import { HomeProgress } from './HomeProgress';
import { QuickAddMenu } from './QuickAddMenu';

export interface HomeHeroProps {
  view: HomeView;
}

const OUTLINE_ON_NAVY =
  'border-navy-raised bg-transparent text-navy-foreground hover:bg-navy-raised';

/** The desktop hero: the day, the greeting, today at a glance, and the way in. */
export function HomeHero({ view }: HomeHeroProps) {
  return (
    <section
      aria-labelledby="home-hero-title"
      className="relative flex flex-wrap items-center gap-6 overflow-hidden rounded-2xl bg-navy p-8 text-navy-foreground"
    >
      <div
        aria-hidden="true"
        className="absolute -top-[120px] -right-[60px] size-[320px] rounded-full bg-navy-raised"
      />
      <div className="relative flex min-w-0 flex-1 basis-[420px] flex-col gap-3">
        <span className="text-label-caps text-navy-accent uppercase">
          {view.dateCaption}
        </span>
        <h1
          id="home-hero-title"
          className="m-0 font-display text-display font-extrabold text-navy-foreground"
        >
          {`${view.greeting}, ${view.firstName}`}
        </h1>
        <p className="m-0 text-body text-navy-muted-foreground">
          {view.heroLine}
        </p>
        {view.unlocked ? (
          <>
            {view.progress && (
              <div className="flex max-w-[420px] flex-col gap-1.5">
                <div className="flex items-baseline justify-between text-body-sm text-navy-muted-foreground">
                  <span>Today&apos;s tasks</span>
                  <span className="tabular-nums">
                    {`${view.progress.done} of ${view.progress.total} done`}
                  </span>
                </div>
                <HomeProgress
                  done={view.progress.done}
                  total={view.progress.total}
                />
              </div>
            )}
            <div className="mt-1.5 flex flex-wrap gap-3">
              <QuickAddMenu>
                <Button variant="brand">
                  <Plus aria-hidden="true" />
                  Quick add
                </Button>
              </QuickAddMenu>
              <Button variant="outline" className={OUTLINE_ON_NAVY} asChild>
                <Link href="/dashboard/tasks">Open today&apos;s tasks</Link>
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-3">
            <Button variant="brand" asChild>
              <Link href="/dashboard/vault">Unlock vault</Link>
            </Button>
            <Button variant="outline" className={OUTLINE_ON_NAVY} asChild>
              <Link href="/dashboard/vault">Use recovery key</Link>
            </Button>
          </div>
        )}
      </div>
      <div className="relative">
        <Illustration kind={view.unlocked ? 'home' : 'vault'} size={140} />
      </div>
    </section>
  );
}

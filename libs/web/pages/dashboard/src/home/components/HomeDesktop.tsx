import type { HomeView } from '../home-view';
import { DueTodayCard } from './DueTodayCard';
import { HomeHero } from './HomeHero';
import { InstallStrip } from './InstallStrip';
import { NewVideosCard } from './NewVideosCard';
import { RenewingSoonCard } from './RenewingSoonCard';
import { SpaceCard } from './SpaceCard';

export interface HomeDesktopProps {
  view: HomeView;
}

/** The Home page on desktop: hero, install offer, spaces, then what is coming up. */
export function HomeDesktop({ view }: HomeDesktopProps) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 p-8">
      <HomeHero view={view} />
      <InstallStrip />
      <section
        aria-labelledby="home-spaces-title"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="home-spaces-title"
            className="m-0 font-display text-title text-foreground"
          >
            Your spaces
          </h2>
          <span className="text-body-sm text-muted-foreground">
            End-to-end encrypted · only you can read them
          </span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {view.spaces.map((space) => (
            <SpaceCard key={space.key} space={space} />
          ))}
        </div>
      </section>
      {view.unlocked && (
        <section
          aria-label="Coming up"
          className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4"
        >
          <DueTodayCard rows={view.dueRows} loading={view.summaryPending} />
          <RenewingSoonCard
            rows={view.renewalRows}
            loading={view.summaryPending}
          />
          {view.youtubeVisible && (
            <NewVideosCard state={view.youtube} rows={view.videoRows} />
          )}
        </section>
      )}
    </div>
  );
}

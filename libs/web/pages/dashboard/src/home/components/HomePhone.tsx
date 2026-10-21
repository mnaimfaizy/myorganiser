import { IconButton } from '@myorganiser/web-ui';
import { Plus } from 'lucide-react';

import type { HomeView } from '../home-view';
import { HomeLockedCard } from './HomeLockedCard';
import { HomePhoneHeader } from './HomePhoneHeader';
import { HomeTodayCard } from './HomeTodayCard';
import { InstallStrip } from './InstallStrip';
import { QuickAddMenu } from './QuickAddMenu';
import { SpaceTile } from './SpaceTile';

export interface HomePhoneProps {
  view: HomeView;
  onLock: () => void;
}

/**
 * The Home page on phone. Tasks is not a tile: the Today card covers it. The
 * quick-add FAB sits above the tab bar and only exists while unlocked.
 */
export function HomePhone({ view, onLock }: HomePhoneProps) {
  const tiles = view.spaces.filter((space) => space.key !== 'tasks');
  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-24">
      <HomePhoneHeader view={view} onLock={onLock} />
      {view.unlocked ? <HomeTodayCard view={view} /> : <HomeLockedCard />}
      <InstallStrip />
      <section
        aria-labelledby="home-phone-spaces-title"
        className="flex flex-col gap-3"
      >
        <div className="flex items-baseline justify-between">
          <h2
            id="home-phone-spaces-title"
            className="m-0 font-display text-body font-bold text-foreground"
          >
            Your spaces
          </h2>
          <span className="text-caption text-muted-foreground">Encrypted</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((space) => (
            <SpaceTile key={space.key} space={space} />
          ))}
        </div>
      </section>
      {view.unlocked && (
        <QuickAddMenu>
          <IconButton
            variant="brand"
            size="fab"
            label="Quick add"
            icon={<Plus aria-hidden="true" />}
            className="fixed right-4 bottom-[calc(var(--toast-offset,0px)+1rem)] z-10 md:hidden"
          />
        </QuickAddMenu>
      )}
    </div>
  );
}

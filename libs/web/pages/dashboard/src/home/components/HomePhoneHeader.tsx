import { IconButton } from '@myorganiser/web-ui';
import { Lock } from 'lucide-react';

import { AccountMenu } from '../../components/AccountMenu';
import type { HomeView } from '../home-view';

export interface HomePhoneHeaderProps {
  view: HomeView;
  onLock: () => void;
}

const CHIP =
  'inline-flex h-8 items-center gap-2 rounded-full px-3 text-caption font-semibold';

/**
 * The phone's Home header: the account square, the greeting and the only h1
 * on phone, and the vault state with its lock control.
 */
export function HomePhoneHeader({ view, onLock }: HomePhoneHeaderProps) {
  return (
    <header className="flex min-h-14 items-center gap-3">
      <AccountMenu variant="phone" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-caption text-muted-foreground">
          {view.greeting}
        </span>
        <h1 className="m-0 truncate font-display text-title text-foreground">
          {view.firstName}
        </h1>
      </div>
      {view.unlocked ? (
        <>
          {view.synced && (
            <span className={`${CHIP} bg-trust-soft text-trust-text`}>
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-trust"
              />
              Synced
            </span>
          )}
          <IconButton
            variant="outline"
            label="Lock vault"
            icon={<Lock aria-hidden="true" />}
            className="text-brand"
            onClick={onLock}
          />
        </>
      ) : (
        <span className={`${CHIP} bg-warning-soft text-warning-text`}>
          <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
          Locked
        </span>
      )}
    </header>
  );
}

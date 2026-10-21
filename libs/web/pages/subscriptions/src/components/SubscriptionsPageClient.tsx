'use client';

import { useIsMobileState } from '@myorganiser/web-ui';
import type { VaultHandle } from '@myorganiser/web-vault';
import { VaultGate } from '@myorganiser/web-vault-ui';

import { useSubscriptionsPage } from '../hooks/use-subscriptions-page';
import { SubscriptionsBoard } from './subscriptions-board';

export interface SubscriptionsPageClientProps {
  /** Desktop only: the subscription whose detail panel opens on first render. */
  initialSelectedId?: string;
}

interface SubscriptionsInnerProps extends SubscriptionsPageClientProps {
  handle: VaultHandle;
}

function SubscriptionsInner({
  handle,
  initialSelectedId,
}: SubscriptionsInnerProps) {
  const page = useSubscriptionsPage(handle);
  // Render nothing until the breakpoint is decided, so a phone never paints
  // the desktop board on the first frame.
  const isPhone = useIsMobileState();

  if (isPhone === undefined) {
    return null;
  }

  return (
    <SubscriptionsBoard
      page={page}
      variant={isPhone ? 'phone' : 'desktop'}
      initialSelectedId={initialSelectedId}
    />
  );
}

export function SubscriptionsPageClient({
  initialSelectedId,
}: SubscriptionsPageClientProps) {
  return (
    <VaultGate title="Subscriptions">
      {({ handle }) =>
        handle ? (
          <SubscriptionsInner
            handle={handle}
            initialSelectedId={initialSelectedId}
          />
        ) : null
      }
    </VaultGate>
  );
}

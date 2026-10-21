'use client';

import { useIsMobileState } from '@myorganiser/web-ui';
import type { VaultHandle } from '@myorganiser/web-vault';
import { VaultGate } from '@myorganiser/web-vault-ui';

import { useAddressesPage } from '../hooks/use-addresses-page';
import { AddressesBoard } from './addresses-board';

interface AddressesInnerProps {
  handle: VaultHandle;
}

function AddressesInner({ handle }: AddressesInnerProps) {
  const page = useAddressesPage(handle);
  // Render nothing until the breakpoint is decided, so a phone never paints
  // the desktop list on the first frame.
  const isPhone = useIsMobileState();

  if (isPhone === undefined) {
    return null;
  }

  return <AddressesBoard page={page} variant={isPhone ? 'phone' : 'desktop'} />;
}

export function AddressesPageClient() {
  return (
    <VaultGate title="Addresses">
      {({ handle }) => (handle ? <AddressesInner handle={handle} /> : null)}
    </VaultGate>
  );
}

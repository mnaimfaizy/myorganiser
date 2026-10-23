'use client';

import { useIsMobileState } from '@myorganiser/web-ui';
import type { VaultHandle } from '@myorganiser/web-vault';
import { VaultGate } from '@myorganiser/web-vault-ui';

import { useMobileNumbersPage } from '../hooks/use-mobile-numbers-page';
import { MobileNumbersBoard } from './mobile-numbers-board';

interface MobileNumbersInnerProps {
  handle: VaultHandle;
}

function MobileNumbersInner({ handle }: MobileNumbersInnerProps) {
  const page = useMobileNumbersPage(handle);
  // Render nothing until the breakpoint is decided, so a phone never paints
  // the desktop list on the first frame.
  const isPhone = useIsMobileState();

  if (isPhone === undefined) {
    return null;
  }

  return (
    <MobileNumbersBoard page={page} variant={isPhone ? 'phone' : 'desktop'} />
  );
}

export function MobileNumbersPageClient() {
  return (
    <VaultGate title="Mobile Numbers">
      {({ handle }) => (handle ? <MobileNumbersInner handle={handle} /> : null)}
    </VaultGate>
  );
}

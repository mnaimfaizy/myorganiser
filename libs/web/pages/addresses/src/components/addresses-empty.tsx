'use client';

import { Plus } from 'lucide-react';
import { Button, EmptyPage, EmptyScreen } from '@myorganiser/web-ui';

interface AddressesEmptyProps {
  onAdd: () => void;
  variant: 'desktop' | 'phone';
}

const DESKTOP_TIPS = [
  'Copy any line in one click',
  'A checklist of who needs your new address',
  'Mark old addresses without losing them',
] as const;

/**
 * The first-run state for Addresses. On phone the shell already draws the
 * title, so EmptyScreen's `<h1>` is kept for the outline but visually hidden.
 */
const AddressesEmpty = ({ onAdd, variant }: AddressesEmptyProps) => {
  if (variant === 'phone') {
    return (
      <EmptyScreen
        illustration="addresses"
        title="Addresses"
        heading="No addresses yet"
        line="Save the places you live or have lived, and track who needs your new address when you move."
        className="min-h-0 grow [&>h1]:sr-only"
        action={
          <Button variant="brand" size="lg" onClick={onAdd}>
            <Plus aria-hidden="true" />
            Add address
          </Button>
        }
      />
    );
  }

  return (
    <EmptyPage
      illustration="addresses"
      title="Addresses"
      heading="No addresses yet"
      line="Save the places you live or have lived. When you move, list everyone who needs your new address and tick them off as you go."
      tips={DESKTOP_TIPS}
      action={
        <Button variant="brand" size="lg" onClick={onAdd}>
          <Plus aria-hidden="true" />
          Add address
        </Button>
      }
    />
  );
};

export { AddressesEmpty };
export type { AddressesEmptyProps };

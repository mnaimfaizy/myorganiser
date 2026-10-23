'use client';

import { Plus } from 'lucide-react';
import { Button, EmptyPage, EmptyScreen } from '@myorganiser/web-ui';

interface MobileNumbersEmptyProps {
  onAdd: () => void;
  variant: 'desktop' | 'phone';
}

const DESKTOP_TIPS = [
  'Copy or call in one click',
  'Track who has each number on file',
  'Country codes formatted for you',
] as const;

/**
 * The first-run state for Mobile numbers. On phone the shell already draws the
 * title, so EmptyScreen's `<h1>` is kept for the outline but visually hidden.
 */
const MobileNumbersEmpty = ({ onAdd, variant }: MobileNumbersEmptyProps) => {
  if (variant === 'phone') {
    return (
      <EmptyScreen
        illustration="mobile"
        title="Mobile numbers"
        heading="No mobile numbers yet"
        line="Keep your numbers in one place and copy or call them in a tap."
        className="min-h-0 grow [&>h1]:sr-only"
        action={
          <Button variant="brand" size="lg" onClick={onAdd}>
            <Plus aria-hidden="true" />
            Add mobile number
          </Button>
        }
      />
    );
  }

  return (
    <EmptyPage
      illustration="mobile"
      title="Mobile numbers"
      heading="No mobile numbers yet"
      line="Keep your numbers in one place, copy them in a click, and track which organisations have each one on file."
      tips={DESKTOP_TIPS}
      action={
        <Button variant="brand" size="lg" onClick={onAdd}>
          <Plus aria-hidden="true" />
          Add mobile number
        </Button>
      }
    />
  );
};

export { MobileNumbersEmpty };
export type { MobileNumbersEmptyProps };

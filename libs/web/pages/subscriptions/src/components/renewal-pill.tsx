import { cn } from '@myorganiser/web-ui';

import type { RenewalLabel } from '../utils/subscription-summary';

export interface RenewalPillProps {
  /** From formatRenewal. Null renders nothing: the caller shows its own placeholder. */
  renewal: RenewalLabel | null;
  /** Desktop list slot: a fixed 112px width keeps the pills in one column. */
  fixedWidth?: boolean;
  className?: string;
}

/**
 * The renewal pill, sentence case ("In 3 days", "2 Nov"). Amber when the
 * renewal is soon, neutral otherwise. It is not a StatusPill, which is uppercase.
 */
const RenewalPill = ({
  renewal,
  fixedWidth = false,
  className,
}: RenewalPillProps) => {
  if (renewal === null) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-full px-2.5 py-1 text-caption font-semibold',
        renewal.soon
          ? 'bg-warning-soft text-warning-text'
          : 'bg-subtle text-subtle-foreground',
        fixedWidth && 'w-28 shrink-0',
        className,
      )}
    >
      {renewal.label}
    </span>
  );
};

export { RenewalPill };

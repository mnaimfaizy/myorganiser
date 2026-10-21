import Link from 'next/link';

import { cn } from '@myorganiser/web-ui';

import { ADMIN_SECTIONS } from '../../lib/adminNav';

export type OverviewNoteTone = 'trust' | 'warning' | 'danger' | 'muted';

const NOTE_CLASS = {
  trust: 'text-trust-text',
  warning: 'text-warning-text',
  danger: 'text-error-text',
  muted: 'text-muted-foreground',
} as const satisfies Record<OverviewNoteTone, string>;

export interface OverviewLinkCardProps {
  label: string;
  value: string;
  /** The note line, or null when the card has none. */
  note: string | null;
  noteTone: OverviewNoteTone;
  /** The phone grid's smaller card. */
  compact?: boolean;
}

/** A key-number card that links to the user directory. */
export function OverviewLinkCard({
  label,
  value,
  note,
  noteTone,
  compact = false,
}: OverviewLinkCardProps) {
  return (
    <Link
      href={ADMIN_SECTIONS.users.url}
      className={cn(
        'flex min-w-0 flex-col rounded-panel border border-border bg-raised-surface shadow-card transition-colors hover:bg-outline-hover',
        compact ? 'gap-1 p-3' : 'gap-1.5 p-4',
      )}
    >
      <span className="text-label-caps text-muted-foreground">{label}</span>
      <span
        className={cn(
          'font-display text-foreground',
          compact ? 'text-title' : 'text-display',
        )}
      >
        {value}
      </span>
      {note !== null && (
        <span className={cn('text-caption', NOTE_CLASS[noteTone])}>{note}</span>
      )}
    </Link>
  );
}

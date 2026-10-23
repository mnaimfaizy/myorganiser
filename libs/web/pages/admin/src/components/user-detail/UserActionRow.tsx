'use client';

import { Button, cn } from '@myorganiser/web-ui';

import type { UserDetailVariant } from '../../lib/userDetail';

export interface UserActionRowProps {
  title: string;
  description: string;
  /** The idle button text. */
  actionLabel: string;
  /** Accessible name of the button. Overrides the visible text. */
  actionAriaLabel?: string;
  /** `danger` gives the button the destructive ink. */
  tone: 'default' | 'danger';
  disabled?: boolean;
  /** The id of the visible note that explains a disabled button. */
  describedBy?: string;
  onAction: () => void;
  variant: UserDetailVariant;
  /** Replaces the idle label while the action runs. */
  busyLabel?: string;
}

/**
 * One row of a lifecycle group: a title and a description, with the action
 * on the right. Desktop is an outline button in a bordered row. Phone is a
 * text button in a list row, at least 44px tall so it stays a usable target.
 */
export function UserActionRow({
  title,
  description,
  actionLabel,
  actionAriaLabel,
  tone,
  disabled = false,
  describedBy,
  onAction,
  variant,
  busyLabel,
}: UserActionRowProps) {
  const isPhone = variant === 'phone';
  const isDanger = tone === 'danger';
  const label = busyLabel ?? actionLabel;

  // While the action runs, the accessible name is the busy text itself, so the
  // static aria-label is dropped. Otherwise it would say "Withdraw" over "Withdrawing…".
  const accessibleName = busyLabel ? undefined : actionAriaLabel;

  const button = isPhone ? (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      aria-label={accessibleName}
      aria-describedby={describedBy}
      onClick={onAction}
      className={cn(
        'h-11 shrink-0 px-1.5 text-body-sm font-semibold md:text-body-sm',
        isDanger ? 'text-destructive-text' : 'text-brand-text',
      )}
    >
      {label}
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      aria-label={accessibleName}
      aria-describedby={describedBy}
      onClick={onAction}
      className={cn(
        'h-10 shrink-0 rounded-control-sm px-3.5 text-control-sm font-semibold md:h-10 md:text-control-sm',
        isDanger
          ? 'border-destructive text-destructive-text'
          : 'text-foreground',
      )}
    >
      {label}
    </Button>
  );

  const text = (
    <span className="flex min-w-0 flex-1 flex-col">
      <span
        className={cn(
          'text-foreground',
          isPhone ? 'text-body' : 'text-body-sm font-semibold',
        )}
      >
        {title}
      </span>
      <span className="text-caption text-muted-foreground">{description}</span>
    </span>
  );

  if (isPhone) {
    return (
      <div className="flex min-h-15 items-center gap-3 border-b border-border-subtle py-2 pr-3.5 pl-4 last:border-b-0">
        {text}
        {button}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 border-t border-border-subtle px-6 py-3.5">
      {text}
      {button}
    </div>
  );
}

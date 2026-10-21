'use client';

import * as React from 'react';
import { cn } from '@myorganiser/web-ui';

export interface ChoiceChipProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'type'
> {
  /** Whether the chip is currently chosen. Drives `aria-pressed`. */
  pressed: boolean;
  /** Called with the next pressed state when the chip is clicked. */
  onPressedChange: (next: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * A pressed-toggle chip. It is a native `<button>` with `aria-pressed`, so the
 * role, keyboard activation, and focus come from the browser. Unpressed it is
 * outlined on the raised surface; pressed it fills with the navy ink.
 *
 * The 36px drawn height keeps the artboard proportion. The `after:` layer
 * extends the hit area to 44px vertically without changing the drawn chip, the
 * same trick Button's `sm` size uses for phone touch targets.
 */
const ChoiceChip = React.forwardRef<HTMLButtonElement, ChoiceChipProps>(
  (
    { pressed, onPressedChange, onClick, className, children, ...props },
    ref,
  ) => {
    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        onPressedChange(!pressed);
      },
      [onClick, onPressedChange, pressed],
    );

    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={pressed}
        onClick={handleClick}
        className={cn(
          'relative inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-control-sm border px-3.5 text-control-sm font-semibold transition-colors after:absolute after:-inset-y-1 after:inset-x-0 after:content-[""] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-45',
          pressed
            ? 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed'
            : 'border-control-edge bg-raised-surface text-foreground hover:bg-outline-hover active:bg-outline-pressed',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
ChoiceChip.displayName = 'ChoiceChip';

export { ChoiceChip };

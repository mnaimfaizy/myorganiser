import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../utils';

export type StatusPillTone =
  | 'neutral'
  | 'brand'
  | 'trust'
  | 'success'
  | 'warning'
  | 'danger';

// Each tone is a -soft ground with its -text ink (DESIGN.md: the words always
// sit in -text on -soft, so the pill never relies on its colour alone).
const statusPillTone = {
  neutral: 'bg-subtle text-subtle-foreground',
  brand: 'bg-brand-soft text-brand-text',
  trust: 'bg-trust-soft text-trust-text',
  success: 'bg-success-soft text-success-text',
  warning: 'bg-warning-soft text-warning-text',
  danger: 'bg-destructive-soft text-destructive-text',
} as const satisfies Record<StatusPillTone, string>;

const statusPillVariants = cva(
  'inline-flex items-center whitespace-nowrap rounded-full uppercase',
  {
    variants: {
      tone: statusPillTone,
      size: {
        // The status pill on a card or header: 24px tall.
        default: 'h-6 px-2.5 text-label-caps',
        // The in-row pill, sitting beside 13px meta text.
        sm: 'px-2 py-px text-label-sm',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      size: 'default',
    },
  },
);

export interface StatusPillProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusPillVariants> {
  /** The word that names the state. Required: colour is never the only cue. */
  children: React.ReactNode;
}

const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ className, tone, size, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(statusPillVariants({ tone, size }), className)}
      {...props}
    >
      {children}
    </span>
  ),
);
StatusPill.displayName = 'StatusPill';

export type StatusPillSize = NonNullable<StatusPillProps['size']>;

export { StatusPill };

import * as React from 'react';

import { cn } from '../../utils';

export type ProgressTone = 'brand' | 'success' | 'navy';

// The track sits on the page ground, except on a navy ground, where it is the
// raised navy tone.
const progressTrack = {
  brand: 'bg-secondary',
  success: 'bg-secondary',
  navy: 'bg-navy-raised',
} as const satisfies Record<ProgressTone, string>;

const progressFill = {
  brand: 'bg-brand',
  success: 'bg-success',
  navy: 'bg-navy-accent',
} as const satisfies Record<ProgressTone, string>;

/** Props shared by every Progress. The accessible name is added by ProgressProps. */
export interface ProgressBaseProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'aria-label' | 'aria-labelledby'
> {
  value: number;
  /** Defaults to 0. */
  min?: number;
  /** Defaults to 100. */
  max?: number;
  /** Defaults to brand. Use navy only on a navy ground. */
  tone?: ProgressTone;
}

/** A progressbar is announced by its name, so one is required. */
export type ProgressAccessibleName =
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-labelledby': string; 'aria-label'?: never };

export type ProgressProps = ProgressBaseProps & ProgressAccessibleName;

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, min = 0, max = 100, tone = 'brand', ...props }, ref) => {
    const clamped = Math.min(max, Math.max(min, value));
    const percent = max > min ? ((clamped - min) / (max - min)) * 100 : 0;

    return (
      <div
        ref={ref}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full',
          progressTrack[tone],
          className,
        )}
        {...props}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={min}
        aria-valuemax={max}
      >
        {/* The fill width is a runtime percentage, so it is an inline style. */}
        <div
          className={cn('h-full rounded-full', progressFill[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';

export { Progress };

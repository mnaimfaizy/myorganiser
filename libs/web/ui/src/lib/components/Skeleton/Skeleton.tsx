import * as React from 'react';

import { cn } from '../../utils';

// A loading placeholder is decorative: the region it stands in for carries the
// accessible state. Motion is gated on motion-safe, so reduced-motion users get
// a still block.
const Skeleton = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    className={cn(
      'motion-safe:animate-pulse rounded-md bg-secondary',
      className,
    )}
    {...props}
  />
));
Skeleton.displayName = 'Skeleton';

export { Skeleton };

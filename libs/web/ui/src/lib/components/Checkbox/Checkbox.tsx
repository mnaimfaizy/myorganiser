'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '../../utils';

/**
 * A 20px box on a Radix Checkbox root. The box is the visual control; the
 * hit area is a transparent `::before` that extends it to 44px in both
 * directions, so phone touch targets meet the minimum without enlarging the
 * drawn box. Radius is `rounded-sm` (4px): the nearest existing radius step to
 * the ~5px the artboard shows; the 10–12px control radii would make a 20px box
 * read as a near-circle.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'group peer relative flex size-5 shrink-0 items-center justify-center rounded-sm border border-control-edge bg-raised-surface transition-colors before:absolute before:-inset-3 before:content-[""] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 enabled:data-[state=checked]:border-primary enabled:data-[state=checked]:bg-primary enabled:data-[state=indeterminate]:border-primary enabled:data-[state=indeterminate]:bg-primary aria-[invalid=true]:border-error-edge aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-inset aria-[invalid=true]:ring-error-edge disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-subtle',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-primary-foreground group-data-[disabled]:text-muted-foreground">
      <Check className="size-3.5 group-data-[state=indeterminate]:hidden" />
      <Minus className="hidden size-3.5 group-data-[state=indeterminate]:block" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };

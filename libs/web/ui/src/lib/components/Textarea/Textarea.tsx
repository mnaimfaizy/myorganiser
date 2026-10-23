import * as React from 'react';
import { cn } from '../../utils';
import { fieldBaseClassName } from '../../field-classes';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      fieldBaseClassName,
      'min-h-24 resize-y py-3 text-body md:text-field',
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };

import * as React from 'react';
import { cn } from '../../utils';
import { fieldBaseClassName } from '../../field-classes';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          fieldBaseClassName,
          'h-12 text-body md:h-11 md:text-field file:border-0 file:bg-transparent file:text-body-sm file:font-medium file:text-foreground',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-45 aria-busy:cursor-progress aria-busy:opacity-100 [&_svg]:pointer-events-none [&_svg]:size-icon [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed',
        brand:
          'bg-brand text-brand-foreground hover:bg-brand-hover active:bg-brand-pressed',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary-hover active:bg-secondary-pressed',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive-hover active:bg-destructive-pressed',
        outline:
          'border border-border-strong bg-raised-surface text-foreground hover:bg-outline-hover active:bg-outline-pressed',
        ghost:
          'bg-transparent text-foreground hover:bg-ghost-hover active:bg-ghost-pressed',
        link: 'bg-transparent text-brand-text underline-offset-4 hover:text-brand-text-strong hover:underline active:underline',
      },
      size: {
        // Phone (below md, 768px) is 48px; desktop is 44px.
        // font-semibold is repeated beside each type step: the tuple's own
        // weight (400 for input and body-sm) would otherwise win.
        default:
          'h-12 md:h-11 px-control-x rounded-control text-field font-semibold md:text-body-sm md:font-semibold',
        lg: 'h-12 px-control-x rounded-control text-field font-semibold',
        // 36px visual height. after: extends the hit area to 44px without
        // changing the drawn size.
        sm: "relative h-9 px-3.5 rounded-control-sm text-control-sm font-semibold after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
        icon: 'size-11 rounded-control',
      },
    },
    compoundVariants: [
      // The link variant overrides the size's height and padding. Compound
      // classes are appended after the size classes, so they win in cn().
      { variant: 'link', className: 'h-8 px-1 md:h-8' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * Render the styles onto the single child element instead of a `<button>`.
   * With `asChild`, `loading` does not inject a spinner (Slot requires exactly
   * one child); it only sets `aria-busy` and `aria-disabled`.
   */
  asChild?: boolean;
  /**
   * Shows a spinner before `children` and disables the button. Pass the busy
   * label (for example "Saving…") as `children`.
   */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const classes = cn(buttonVariants({ variant, size, className }));

    if (asChild) {
      return (
        <Slot
          className={classes}
          ref={ref}
          {...props}
          aria-busy={loading ? true : props['aria-busy']}
          aria-disabled={loading || disabled ? true : props['aria-disabled']}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        className={classes}
        ref={ref}
        {...props}
        disabled={loading || disabled}
        aria-busy={loading ? true : props['aria-busy']}
      >
        {loading ? (
          <Loader2
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        ) : null}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../utils';
import { Button, type ButtonProps } from '../Button/Button';

/*
 * Colour is the variant; geometry is the size. They are orthogonal: `brand`
 * on its own is a 44px brand-coloured icon button with the shadow, and the
 * floating action button is `variant="brand" size="fab"`. The FAB is a size
 * (56px, larger icon, rounded-fab) and not a colour, so a brand icon button
 * at 44px does not need to be a FAB.
 *
 * The outline and ghost glyphs take foreground-secondary and the outline edge
 * is the hairline border, as the Buttons sheet draws its icon buttons: the
 * glyph identifies the control, so a heavier edge would only add weight.
 *
 * Every colour class here is applied after Button's default variant classes,
 * so cn() resolves the conflict in this file's favour.
 */
const iconButtonVariants = cva('', {
  variants: {
    variant: {
      outline:
        'border border-border bg-raised-surface text-foreground-secondary hover:bg-outline-hover active:bg-outline-pressed',
      ghost:
        'bg-transparent text-foreground-secondary hover:bg-ghost-hover active:bg-ghost-pressed',
      // No hover or pressed roles exist for the soft destructive tint. Hover
      // darkens to the destructive edge tint; pressed fills solid with
      // destructive-pressed, as Button's destructive variant does.
      destructive:
        'bg-destructive-soft text-destructive-text hover:bg-destructive-edge active:bg-destructive-pressed active:text-destructive-foreground',
      brand:
        'bg-brand text-brand-foreground shadow-brand hover:bg-brand-hover active:bg-brand-pressed',
    },
    size: {
      default: '',
      fab: 'size-14 rounded-fab [&_svg]:size-[22px]',
    },
  },
  defaultVariants: {
    variant: 'ghost',
    size: 'default',
  },
});

export interface IconButtonProps
  extends
    Omit<ButtonProps, 'variant' | 'size' | 'children'>,
    VariantProps<typeof iconButtonVariants> {
  /** Accessible name, set as `aria-label`. Required; icon-only controls have no visible text. */
  label: string;
  /** The glyph to render. `children` is accepted as an alternative. */
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * An icon-only button. Its accessible name is the required `label`.
 *
 * The design calls for a tooltip on every icon-only button on desktop. The
 * tooltip is not built in, because Radix Tooltip needs a TooltipProvider above
 * it. Callers compose it: wrap this in `Tooltip` and `TooltipTrigger asChild`,
 * and give the tooltip the same text as `label`.
 *
 * With `loading`, the spinner replaces the icon so the 44px target does not
 * overflow.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      label,
      icon,
      children,
      className,
      variant,
      size,
      loading = false,
      type = 'button',
      ...props
    },
    ref,
  ) => (
    <Button
      ref={ref}
      type={type}
      size="icon"
      loading={loading}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
      aria-label={label}
    >
      {loading ? undefined : (icon ?? children)}
    </Button>
  ),
);
IconButton.displayName = 'IconButton';

export { IconButton };

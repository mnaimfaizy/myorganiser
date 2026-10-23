import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../utils';

/**
 * Grouped list card (PhoneLists artboard). A `xl` container whose rows are
 * divided by a `border-subtle` hairline, with none after the last row. The
 * section header sits outside the card, above it. Rows carry no domain
 * knowledge: callers decide what goes in each slot.
 *
 * Usage: a page with a table at md and up renders a ListGroup below md, so
 * the same records appear as rows on a phone.
 */
const ListGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex flex-col divide-y divide-border-subtle overflow-hidden rounded-xl border border-border bg-card',
      className,
    )}
    {...props}
  />
));
ListGroup.displayName = 'ListGroup';

/**
 * The section header above a ListGroup ("PRODUCE · 3"). The title is the
 * caps label; `ListGroupHeaderTrailing` is the optional right-hand text.
 */
const ListGroupHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex h-9 items-end justify-between px-4 pb-2', className)}
    {...props}
  />
));
ListGroupHeader.displayName = 'ListGroupHeader';

/**
 * Heading level is `h2`, the usual level beneath a page `h1`. A page that
 * nests sections deeper renders its own heading with these classes instead.
 */
const ListGroupHeaderTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, children, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn('text-label-caps uppercase text-muted-foreground', className)}
    {...props}
  >
    {children}
  </h2>
));
ListGroupHeaderTitle.displayName = 'ListGroupHeaderTitle';

const ListGroupHeaderTrailing = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn('text-caption text-muted-foreground', className)}
    {...props}
  />
));
ListGroupHeaderTrailing.displayName = 'ListGroupHeaderTrailing';

/**
 * Row height is a `size`, not a caller className, because the heights are a
 * fixed design set (56, 64, 68, 72): value rows, default rows, navigation
 * and copy-a-field rows, and checklist rows. A `size` keeps those values in
 * one place. `interactive` gates the hover and focus styles to `<a>` and
 * `<button>` rows, so a checkbox `<label>` row does not show a hover it
 * cannot act on.
 */
const listGroupRowVariants = cva('flex items-center gap-3 pl-4 pr-3', {
  variants: {
    size: {
      value: 'min-h-14',
      default: 'min-h-16',
      navigation: 'min-h-17',
      checklist: 'min-h-18',
    },
    interactive: {
      true: 'text-foreground transition-colors hover:bg-ghost-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
      false: '',
    },
  },
  defaultVariants: {
    size: 'default',
    interactive: false,
  },
});

export interface ListGroupRowProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof listGroupRowVariants> {
  /**
   * Render the row styles onto the single child: a `<label>` for a checkbox
   * row, an `<a>` for a navigation row, or a `<button aria-label>` for a
   * copy-a-field row. Set `interactive` for `<a>` and `<button>` children.
   */
  asChild?: boolean;
}

/**
 * Navigation rows show a trailing chevron. Callers pass lucide's
 * `ChevronRight` as the last `ListGroupRowTrailing` child with
 * `className="text-inactive"`; there is no separate chevron helper.
 */
const ListGroupRow = React.forwardRef<HTMLDivElement, ListGroupRowProps>(
  ({ className, size, interactive, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={ref}
        className={cn(listGroupRowVariants({ size, interactive }), className)}
        {...props}
      />
    );
  },
);
ListGroupRow.displayName = 'ListGroupRow';

const ListGroupRowLeading = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn('flex shrink-0 items-center', className)}
    {...props}
  />
));
ListGroupRowLeading.displayName = 'ListGroupRowLeading';

/**
 * Wraps the title and meta lines. `min-w-0` lets a long title wrap within
 * the row rather than push the trailing slot off it.
 */
const ListGroupRowBody = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn('flex min-w-0 grow flex-col', className)}
    {...props}
  />
));
ListGroupRowBody.displayName = 'ListGroupRowBody';

const ListGroupRowTitle = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span ref={ref} className={cn('text-body', className)} {...props} />
));
ListGroupRowTitle.displayName = 'ListGroupRowTitle';

/**
 * Meta holds a secondary line of text and may hold a `sm` StatusPill. It is
 * a flex row so the pill sits inline beside its text.
 */
const ListGroupRowMeta = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn(
      'flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground',
      className,
    )}
    {...props}
  />
));
ListGroupRowMeta.displayName = 'ListGroupRowMeta';

const ListGroupRowTrailing = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn('flex shrink-0 items-center gap-2', className)}
    {...props}
  />
));
ListGroupRowTrailing.displayName = 'ListGroupRowTrailing';

export {
  ListGroup,
  ListGroupHeader,
  ListGroupHeaderTitle,
  ListGroupHeaderTrailing,
  ListGroupRow,
  ListGroupRowBody,
  ListGroupRowLeading,
  ListGroupRowMeta,
  ListGroupRowTitle,
  ListGroupRowTrailing,
};

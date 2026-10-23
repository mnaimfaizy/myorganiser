'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../utils';

/*
 * A modal bottom sheet built on Radix Dialog: focus is trapped, Escape closes
 * it, and a tap on the scrim closes it.
 *
 * Accessibility contract: every BottomSheetContent needs a BottomSheetTitle
 * and a BottomSheetDescription. If a sheet has no description, pass
 * `aria-describedby={undefined}` to BottomSheetContent deliberately.
 *
 * Safe area: the bottom padding is `calc(var(--spacing) * 6.5 + env(safe-area-inset-bottom))`,
 * written as one arbitrary value. 6.5 spacing steps is 26px. env() resolves to
 * 0 on devices without a bottom inset, so the sheet is 26px there. The inset
 * only takes effect when the page sets `viewport-fit=cover`.
 */

const BottomSheet = DialogPrimitive.Root;

const BottomSheetTrigger = DialogPrimitive.Trigger;

const BottomSheetClose = DialogPrimitive.Close;

const bottomSheetActionVariants = cva(
  'flex min-h-13 w-full items-center justify-start rounded-control px-1 text-left text-body hover:bg-ghost-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  {
    variants: {
      tone: {
        default: 'text-foreground',
        destructive: 'font-semibold text-destructive-text',
      },
    },
    defaultVariants: {
      tone: 'default',
    },
  },
);

/** `tone="destructive"` renders the row in semibold destructive text. */
export interface BottomSheetActionProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>,
    VariantProps<typeof bottomSheetActionVariants> {}

/**
 * An action row in the sheet. It is Radix Close, so it closes the sheet when
 * activated. A handler that calls `event.preventDefault()` keeps the sheet
 * open, because Radix checks defaultPrevented before it closes.
 */
const BottomSheetAction = React.forwardRef<
  HTMLButtonElement,
  BottomSheetActionProps
>(({ className, tone, type = 'button', ...props }, ref) => (
  <DialogPrimitive.Close
    ref={ref}
    type={type}
    className={cn(bottomSheetActionVariants({ tone }), className)}
    {...props}
  />
));
BottomSheetAction.displayName = 'BottomSheetAction';

const BottomSheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 flex flex-col gap-4 rounded-t-panel bg-card px-4 pt-1.5 pb-[calc(var(--spacing)*6.5+env(safe-area-inset-bottom))] shadow-dialog motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:slide-out-to-bottom motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:slide-in-from-bottom',
        className,
      )}
      {...props}
    >
      {/* Decorative grab handle. The pt-1.5 above it is its top spacing, so
          the handle carries no margin of its own. */}
      <div
        aria-hidden="true"
        className="h-1.25 w-9 self-center rounded-full bg-inactive"
      />
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
BottomSheetContent.displayName = 'BottomSheetContent';

const BottomSheetHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col gap-1 text-left', className)}
    {...props}
  />
));
BottomSheetHeader.displayName = 'BottomSheetHeader';

const BottomSheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-display text-title text-foreground', className)}
    {...props}
  />
));
BottomSheetTitle.displayName = 'BottomSheetTitle';

const BottomSheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-body-sm text-foreground-supporting', className)}
    {...props}
  />
));
BottomSheetDescription.displayName = 'BottomSheetDescription';

export {
  BottomSheet,
  BottomSheetAction,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
};

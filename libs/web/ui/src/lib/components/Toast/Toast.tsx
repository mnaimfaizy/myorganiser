'use client';

import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '../../utils';

const ToastProvider = ToastPrimitives.Provider;

/*
 * Viewport position. Desktop (md and up): bottom-right. Phone: full width,
 * with the 16px gutter from p-4, anchored to the bottom edge.
 *
 * Phone has two bottom reserves, each owned by whatever obstructs the bottom
 * of the screen. The phone bottom inset is the larger of the two:
 *   --toast-offset       the phone shell sets this to the tab bar's height
 *                        plus any safe-area inset (apps/web/.../layout.tsx).
 *   --toast-fab-reserve  a page's floating action button sets this while
 *                        mounted (IconButton's `size="fab"` variant), big
 *                        enough to also clear the tab bar beneath it.
 * Each defaults to 0 so a page with neither mounted keeps the toast at the
 * screen edge. Each reserve is set to its obstruction's own top edge; the p-4
 * padding below supplies the final rem of clearance. They are separate custom
 * properties rather than one reassigned value, so max() picks whichever
 * obstruction is tallest regardless of which order Tailwind emits their
 * has-[] rules in.
 *
 * Sheet open, phone only: while any [data-bottom-sheet] (BottomSheet.tsx) is
 * in the document, the viewport pins to the top instead. A sheet can be near
 * full height, so no bottom offset fits every sheet; pinning to the top edge
 * clears all of them. The top sits at the safe-area inset (p-4 supplies the
 * gutter), newest toast nearest the top, so the column flips to flex-col. The
 * selector is `in-[body:has(...)]`, scoped to the viewport's own ancestor
 * chain, so no class is needed on <body>. The variant is prefixed `max-md:`,
 * so md and up keep bottom-right and md:bottom-0 wins there. The viewport is
 * z-[100], above the sheet's z-50, in both states.
 *
 * A CSS variable rather than a prop on ToastViewport or Toaster, because each
 * owner sets it once for the whole subtree without threading it through the
 * toast provider. md:bottom-0 ignores the bottom reserves on desktop, which has
 * no tab bar or FAB.
 */
const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      'pointer-events-none fixed inset-x-0 bottom-[max(var(--toast-offset,0px),var(--toast-fab-reserve,0px))] z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 md:bottom-0 md:left-auto md:right-0 md:w-105 md:flex-col max-md:in-[body:has([data-bottom-sheet])]:top-[env(safe-area-inset-top)] max-md:in-[body:has([data-bottom-sheet])]:bottom-auto max-md:in-[body:has([data-bottom-sheet])]:flex-col',
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  'group pointer-events-auto relative flex min-h-13 w-full items-center gap-3 overflow-hidden rounded-control border border-transparent pl-4 pr-1.5 shadow-toast transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none motion-safe:data-[swipe=end]:animate-out motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-80 motion-safe:data-[state=closed]:slide-out-to-right-full motion-safe:data-[state=open]:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default:
          'bg-navy text-navy-foreground [&>svg]:shrink-0 [&>svg]:text-navy-accent',
        destructive:
          'destructive border-destructive-edge bg-raised-surface text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-10 shrink-0 items-center justify-center rounded-md px-3 font-bold text-navy-accent transition-colors hover:bg-navy-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-45 group-[.destructive]:text-destructive-text group-[.destructive]:hover:bg-destructive-faint',
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    aria-label="Dismiss notification"
    className={cn(
      'inline-flex size-11 shrink-0 items-center justify-center rounded-md text-navy-muted-foreground transition-colors hover:text-navy-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus group-[.destructive]:text-foreground group-[.destructive]:hover:text-destructive-text',
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn('text-body-sm font-semibold', className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-body-sm', className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};

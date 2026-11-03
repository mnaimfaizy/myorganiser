'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '../../utils';

const Breadcrumb = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<'nav'> & {
    separator?: React.ReactNode;
  }
>(({ ...props }, ref) => <nav ref={ref} aria-label="breadcrumb" {...props} />);
Breadcrumb.displayName = 'Breadcrumb';

const BreadcrumbList = React.forwardRef<
  HTMLOListElement,
  React.ComponentPropsWithoutRef<'ol'>
>(({ className, ...props }, ref) => (
  <ol
    ref={ref}
    className={cn(
      'flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5',
      className,
    )}
    {...props}
  />
));
BreadcrumbList.displayName = 'BreadcrumbList';

const BreadcrumbItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentPropsWithoutRef<'li'>
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    className={cn('inline-flex items-center gap-1.5', className)}
    {...props}
  />
));
BreadcrumbItem.displayName = 'BreadcrumbItem';

const BreadcrumbLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<'a'> & {
    asChild?: boolean;
  }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : 'a';

  return (
    <Comp
      ref={ref}
      className={cn('transition-colors hover:text-foreground', className)}
      {...props}
    />
  );
});
BreadcrumbLink.displayName = 'BreadcrumbLink';

const BreadcrumbPage = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<'span'>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    role="link"
    aria-disabled="true"
    aria-current="page"
    className={cn('font-normal text-foreground', className)}
    {...props}
  />
));
BreadcrumbPage.displayName = 'BreadcrumbPage';

const BreadcrumbSeparator = ({
  children,
  className,
  ...props
}: React.ComponentProps<'li'>) => (
  <li
    role="presentation"
    aria-hidden="true"
    className={cn('[&>svg]:w-3.5 [&>svg]:h-3.5', className)}
    {...props}
  >
    {children ?? <ChevronRight />}
  </li>
);
BreadcrumbSeparator.displayName = 'BreadcrumbSeparator';

const BreadcrumbEllipsis = ({
  className,
  ...props
}: React.ComponentProps<'span'>) => (
  <span
    role="presentation"
    aria-hidden="true"
    className={cn('flex h-9 w-9 items-center justify-center', className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More</span>
  </span>
);
BreadcrumbEllipsis.displayName = 'BreadcrumbElipssis';

interface BreadcrumbLabelContextValue {
  label: string | null;
  setLabel: (label: string | null) => void;
}

const BreadcrumbLabelContext =
  React.createContext<BreadcrumbLabelContextValue | null>(null);

/**
 * Holds the label a page supplies for the breadcrumb's last segment. The
 * shell (breadcrumb and header title) reads it; a detail page sets it through
 * `useSetBreadcrumbLabel`.
 */
function BreadcrumbLabelProvider({ children }: { children: React.ReactNode }) {
  const [label, setLabel] = React.useState<string | null>(null);

  const contextValue = React.useMemo<BreadcrumbLabelContextValue>(
    () => ({ label, setLabel }),
    [label],
  );

  return (
    <BreadcrumbLabelContext.Provider value={contextValue}>
      {children}
    </BreadcrumbLabelContext.Provider>
  );
}
BreadcrumbLabelProvider.displayName = 'BreadcrumbLabelProvider';

/**
 * The page-supplied last-segment label, or null when none is set or no
 * provider is mounted. Never throws, so the shell renders in isolation.
 */
function useBreadcrumbLabel(): string | null {
  const context = React.useContext(BreadcrumbLabelContext);
  return context?.label ?? null;
}

/**
 * Sets the breadcrumb's last-segment label while the calling component is
 * mounted, and clears it on unmount so the next route never shows a stale
 * name. A no-op when no provider is mounted.
 */
function useSetBreadcrumbLabel(label: string | null): void {
  const context = React.useContext(BreadcrumbLabelContext);
  const setLabel = context?.setLabel;

  React.useEffect(() => {
    if (!setLabel) return;
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
}

/**
 * Sets the breadcrumb's last-segment label for a detail page: "Details" while
 * the record is loading or missing, otherwise a field of the record.
 */
function useDetailBreadcrumbLabel<T>(
  loading: boolean,
  record: T | null | undefined,
  label: (record: T) => string,
): void {
  useSetBreadcrumbLabel(loading || !record ? 'Details' : label(record));
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
  BreadcrumbLabelProvider,
  useBreadcrumbLabel,
  useSetBreadcrumbLabel,
  useDetailBreadcrumbLabel,
};

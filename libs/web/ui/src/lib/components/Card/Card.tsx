import * as React from 'react';

import { cn } from '../../utils';

/**
 * Section card (Data and PhoneLists artboards): a `panel` radius, hairline
 * edge and card-tier shadow. Consumers pass `className` overrides such as
 * `pt-0`; `cn(base, className)` keeps them winning. A card that holds a
 * Table or a ListGroup edge to edge passes `overflow-hidden`, so their grounds
 * keep to the rounded corners.
 */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-panel border border-border bg-card text-card-foreground shadow-card',
      className,
    )}
    {...props}
  />
));
Card.displayName = 'Card';

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Section-card header row (Data sheet "Danger zone"): a single row with a
   * bottom hairline. Leave unset for the default stacked title and
   * description, which carries no line.
   */
  divided?: boolean;
}

/**
 * Default: a column of title and description with `gap-1` and `p-5`, no
 * line, so existing stacked consumers keep their layout. `divided` switches
 * to the section-card row with a bottom hairline.
 */
const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, divided = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        divided
          ? 'flex flex-row items-center gap-2.5 border-b border-border px-5 py-4'
          : 'flex flex-col gap-1 p-5',
        className,
      )}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('font-display text-title', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-body-sm text-foreground-supporting', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

/**
 * Content is flush under the title by default (`pt-0`), so stacked consumers
 * keep their `mt-4` and `pb-2` offsets. Under a `divided` CardHeader, pass
 * `pt-5` (or `p-5`) to pad the content.
 */
const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-5 pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center px-5 pb-5', className)}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};

import * as React from 'react';

import { cn } from '../../utils';

/**
 * Data table (Data artboard). It renders only the rows: the toolbar and
 * pagination belong to the Card that wraps it, so put a `Table` inside a
 * `Card` section, with the toolbar in `CardHeader`.
 *
 * Below md (768px) the page should not show a table at all. Render the same
 * records as a `ListGroup` row list at the page level; this primitive does
 * not switch layouts itself.
 */
const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn('w-full caption-bottom text-body-sm', className)}
      {...props}
    />
  </div>
));
Table.displayName = 'Table';

/**
 * The header row sits on the `background` role and carries the hairline
 * below it. The background and border are set on `thead` and its `tr`
 * because the row is the element that draws the rule.
 */
const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'bg-background [&_tr]:border-b [&_tr]:border-border',
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('[&_tr:last-child]:border-0', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t border-border bg-background [&>tr]:last:border-b-0',
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

/**
 * Data rows take a hairline in `border-subtle` and a ghost hover. Rows have
 * no min-height, so the 60px row height comes from the cells instead (see
 * TableCell).
 */
const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b border-border-subtle transition-colors hover:bg-ghost-hover data-[state=selected]:bg-muted',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

/**
 * The label-caps step already sets its own weight, so no `font-*` class is
 * added here: a class after it would override the Type Scale weight.
 */
const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-auto px-5 py-2.5 text-left align-middle text-label-caps uppercase text-foreground-supporting [&:has([role=checkbox])]:pr-0',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

/**
 * Vertical padding is `py-2.5` (10px) on each side around a 40px content
 * line, which gives the 60px data-row height. The line height comes from the
 * tallest content in the row, so a row with a 40px control or avatar lands on
 * 60px without a min-height that table rows cannot take.
 */
const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'px-5 py-2.5 align-middle [&:has([role=checkbox])]:pr-0',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn('mt-4 text-caption text-muted-foreground', className)}
    {...props}
  />
));
TableCaption.displayName = 'TableCaption';

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};

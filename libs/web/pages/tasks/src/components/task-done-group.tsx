import type * as React from 'react';
import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@myorganiser/web-ui';

interface TaskDoneGroupProps {
  /** Tasks done this week. Renders nothing at zero. */
  count: number;
  /** The done rows, already rendered as `TaskRow`s. */
  children: React.ReactNode;
}

/**
 * The collapsed "Done this week" group under the open groups. Closed by
 * default; the trigger's chevron turns down when open, and Radix supplies
 * `aria-expanded` on the trigger.
 */
const TaskDoneGroup = ({ count, children }: TaskDoneGroupProps) => {
  if (count === 0) {
    return null;
  }

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex h-13 w-full items-center gap-2 rounded-xl border border-border bg-raised-surface px-4 text-left text-body-sm font-semibold text-foreground">
        <ChevronRight
          aria-hidden="true"
          className="size-3 shrink-0 text-foreground-supporting transition-transform group-data-[state=open]:rotate-90"
        />
        {`Done this week · ${count}`}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col overflow-hidden rounded-xl border border-border bg-raised-surface">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
};

export { TaskDoneGroup };
export type { TaskDoneGroupProps };

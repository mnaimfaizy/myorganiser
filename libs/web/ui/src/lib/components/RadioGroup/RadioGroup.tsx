import * as React from 'react';
import { cn } from '../../utils';

export interface RadioGroupProps extends React.FieldsetHTMLAttributes<HTMLFieldSetElement> {
  /** The question the group answers, rendered as the fieldset's legend. */
  legend: React.ReactNode;
}

export interface RadioGroupItemProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
> {
  /** The visible option label. The whole row is the label, so it is the hit area. */
  children: React.ReactNode;
}

/**
 * A labelled group of native radio options. The fieldset carries the group
 * semantics (name association, disabled cascade); the legend is the question
 * the group answers.
 *
 * Children are stacked in a flex column by default. Callers pass `className`
 * to change the layout, e.g. a two-column grid for RadioCards.
 *
 * `disabled` is passed through natively: a disabled fieldset disables every
 * control inside it, and the legend is muted to match.
 */
const RadioGroup = React.forwardRef<HTMLFieldSetElement, RadioGroupProps>(
  ({ className, legend, children, ...props }, ref) => (
    <fieldset
      ref={ref}
      className={cn(
        'group m-0 flex min-w-0 flex-col gap-1 border-0 p-0',
        className,
      )}
      {...props}
    >
      <legend className="mb-1 text-body-sm font-semibold text-foreground group-disabled:text-muted-foreground">
        {legend}
      </legend>
      {children}
    </fieldset>
  ),
);
RadioGroup.displayName = 'RadioGroup';

/**
 * One option in a RadioGroup: a native `<input type="radio">` wrapped in its
 * label, so the row is the 44px touch target on phone and 40px from md.
 *
 * Focus ring sits on the input, not the row. The input is the focusable
 * element, and the ring follows its circular shape (rounded-full) with a 2px
 * offset, matching the Checkbox control. A row-level ring would frame the
 * text as well and read as a card selection.
 *
 * No error styling: `aria-invalid` passes through untouched, because the
 * design shows no error state for radio options.
 */
const RadioGroupItem = React.forwardRef<HTMLInputElement, RadioGroupItemProps>(
  ({ className, children, ...props }, ref) => (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2.5 text-body-sm text-foreground md:min-h-10 has-[input:disabled]:cursor-not-allowed has-[input:disabled]:text-muted-foreground',
        className,
      )}
    >
      <input
        {...props}
        ref={ref}
        type="radio"
        className="size-5 shrink-0 cursor-pointer rounded-full accent-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed"
      />
      <span>{children}</span>
    </label>
  ),
);
RadioGroupItem.displayName = 'RadioGroupItem';

export { RadioGroup, RadioGroupItem };

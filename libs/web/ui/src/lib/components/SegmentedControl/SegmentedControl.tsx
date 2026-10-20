'use client';

import * as React from 'react';
import { cn } from '../../utils';

export interface SegmentedControlOption<T extends string> {
  /** The value this segment writes to `onValueChange` when chosen. */
  value: T;
  /** The visible segment text. */
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Shared by every radio, so the browser treats the segments as one group. */
  name: string;
  /** The selected value. The control is controlled: the caller owns the state. */
  value: T;
  /** Called with the option value the user chose. */
  onValueChange: (value: T) => void;
  /** One segment per option. Columns are equal, one per option. */
  options: readonly SegmentedControlOption<T>[];
  /** The question the control answers, rendered as a visible legend. */
  legend: string;
  /** Mutes the whole group and blocks every segment. */
  disabled?: boolean;
  className?: string;
}

/**
 * A single-choice segmented control. It is a radio group, not a set of
 * `aria-pressed` buttons: a single choice among mutually exclusive options is
 * radio semantics, so the native `<input type="radio">` elements inside a
 * `<fieldset>` supply the role, the arrow-key movement between segments, and
 * the form submission that React Hook Form reads through `name`. Toggle
 * buttons would need hand-rolled arrow keys and would not submit a value.
 *
 * Radix ships no radio-group for this look, and the library already uses
 * native radios (RadioGroup, RadioCard), so this follows the same pattern.
 *
 * Columns are one equal column per option, set through `gridTemplateColumns`
 * rather than a Tailwind class. The column count comes from `options.length`
 * at runtime, and Tailwind only emits classes it can see as literals.
 *
 * Touch target: the segment is 44px tall below md, where it is the phone
 * target size, and 36px from md, where the compact desktop track sits. The
 * native radio is `sr-only`, so the whole segment is the label and the hit
 * area. Focus shows on the segment, not on the hidden input, through
 * `has-[input:focus-visible]`.
 *
 * Selected styling uses `has-[input:checked:enabled]`, so a disabled checked
 * segment reads as disabled rather than as an active choice, as RadioCard does.
 *
 * Generics and forwardRef: `forwardRef` erases the generic, so the component
 * is declared once as a forwardRef over `string`, then cast to a generic
 * signature that keeps `value` and `onValueChange` tied to the option union.
 * The cast is the only place the type is widened.
 */
const SegmentedControlRoot = React.forwardRef<
  HTMLFieldSetElement,
  SegmentedControlProps<string>
>(
  (
    { className, name, value, onValueChange, options, legend, disabled },
    ref,
  ) => {
    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const chosen = options.find(
          (option) => option.value === event.target.value,
        );
        if (chosen) {
          onValueChange(chosen.value);
        }
      },
      [options, onValueChange],
    );

    return (
      <fieldset
        ref={ref}
        disabled={disabled}
        className={cn(
          'group m-0 flex min-w-0 flex-col gap-1 border-0 p-0',
          className,
        )}
      >
        <legend className="mb-1 text-body-sm font-semibold text-foreground group-disabled:text-muted-foreground">
          {legend}
        </legend>
        <div
          className="grid gap-0.5 rounded-control bg-secondary p-1 group-disabled:bg-subtle"
          style={{
            gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
          }}
        >
          {options.map((option) => (
            <label
              key={option.value}
              className="relative flex min-h-11 cursor-pointer items-center justify-center rounded-item px-2 text-center text-body-sm font-medium text-foreground-secondary md:min-h-9 has-[input:checked:enabled]:bg-raised-surface has-[input:checked:enabled]:font-semibold has-[input:checked:enabled]:text-foreground has-[input:checked:enabled]:shadow-segment has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus group-disabled:cursor-not-allowed group-disabled:text-muted-foreground"
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={option.value === value}
                onChange={handleChange}
                className="sr-only"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  },
);
SegmentedControlRoot.displayName = 'SegmentedControl';

const SegmentedControl = SegmentedControlRoot as <T extends string>(
  props: SegmentedControlProps<T> & React.RefAttributes<HTMLFieldSetElement>,
) => React.ReactElement | null;

export { SegmentedControl };

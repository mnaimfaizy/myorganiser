'use client';

import * as React from 'react';
import { cn } from '../../utils';

export interface RadioCardProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'title'
> {
  /** Card heading, rendered as the input's accessible name. */
  title: React.ReactNode;
  /** Supporting text, wired to the input through aria-describedby. */
  description?: React.ReactNode;
}

/**
 * A selectable card wrapping a native `<input type="radio">`, so it works with
 * React Hook Form `register` and native arrow-key navigation within one `name`.
 *
 * Group semantics are the caller's: wrap a set of RadioCards in a `<fieldset>`
 * with a `<legend>`. This component does not render either, because the legend
 * is the question the group answers and only the caller has it.
 *
 * Selected styling is applied only while the input is enabled, so a disabled
 * checked card reads as disabled rather than as an active choice.
 */
const RadioCard = React.forwardRef<HTMLInputElement, RadioCardProps>(
  (
    {
      className,
      title,
      description,
      disabled,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const titleId = `${generatedId}-title`;
    const descriptionId = `${generatedId}-description`;
    const describedBy =
      [ariaDescribedBy, description ? descriptionId : undefined]
        .filter(Boolean)
        .join(' ') || undefined;

    return (
      <label
        className={cn(
          'flex cursor-pointer items-start gap-2.5 rounded-menu border border-border-strong bg-raised-surface p-3.5 has-[input:checked:enabled]:border-brand has-[input:checked:enabled]:bg-brand-soft has-[input:checked:enabled]:ring-1 has-[input:checked:enabled]:ring-inset has-[input:checked:enabled]:ring-brand has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus has-[input:disabled]:cursor-not-allowed has-[input:disabled]:bg-subtle has-[input:disabled]:text-muted-foreground',
          className,
        )}
      >
        <input
          {...props}
          ref={ref}
          type="radio"
          disabled={disabled}
          aria-labelledby={titleId}
          aria-describedby={describedBy}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-brand focus-visible:outline-none disabled:cursor-not-allowed"
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            id={titleId}
            className="text-field font-semibold md:text-body-sm"
          >
            {title}
          </span>
          {description ? (
            <span
              id={descriptionId}
              className="text-caption text-muted-foreground"
            >
              {description}
            </span>
          ) : null}
        </span>
      </label>
    );
  },
);
RadioCard.displayName = 'RadioCard';

export { RadioCard };

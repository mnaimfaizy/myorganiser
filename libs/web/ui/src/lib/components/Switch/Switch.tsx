'use client';

import * as React from 'react';
import { cn } from '../../utils';

export interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'role' | 'defaultValue'
> {
  /** Controlled checked state. Omit to let the switch own its state. */
  checked?: boolean;
  /** Initial checked state when uncontrolled. */
  defaultChecked?: boolean;
  /** Called with the next checked state on every user toggle. */
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * A native `<button role="switch">`, built without Radix because the project
 * ships only `@radix-ui/react-checkbox`. The API mirrors Radix Switch so a
 * later swap is a dependency change, not a call-site change.
 *
 * Accessible name comes from `aria-label`, `aria-labelledby`, or an associated
 * `<label htmlFor>`. A `<button>` is a labelable element, so clicking the label
 * activates the button and toggles the switch.
 */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      className,
      checked: checkedProp,
      defaultChecked = false,
      onCheckedChange,
      onClick,
      disabled,
      ...props
    },
    ref,
  ) => {
    const [uncontrolledChecked, setUncontrolledChecked] =
      React.useState(defaultChecked);
    const isControlled = checkedProp !== undefined;
    const checked = checkedProp ?? uncontrolledChecked;
    const state = checked ? 'checked' : 'unchecked';

    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }
        const next = !checked;
        if (!isControlled) {
          setUncontrolledChecked(next);
        }
        onCheckedChange?.(next);
      },
      [checked, isControlled, onCheckedChange, onClick],
    );

    return (
      <button
        {...props}
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        data-state={state}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          'peer relative inline-flex h-8 w-switch-width shrink-0 cursor-pointer items-center rounded-full p-0.75 transition-colors motion-safe:duration-200 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[""] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 data-[state=checked]:bg-primary data-[state=unchecked]:bg-inactive disabled:cursor-not-allowed disabled:opacity-45',
          className,
        )}
      >
        <span
          data-state={state}
          className="pointer-events-none block size-switch-thumb translate-x-0 rounded-full bg-raised-surface transition-transform motion-safe:duration-200 data-[state=checked]:translate-x-5"
        />
      </button>
    );
  },
);
Switch.displayName = 'Switch';

export { Switch };

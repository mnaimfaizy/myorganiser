import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * tailwind-merge does not read the Tailwind config, so each name the shared
 * theme (libs/design-tokens/tailwind-theme.cjs) adds to a scale is registered
 * here. Unregistered, `text-body` reads as a text colour and
 * `cn('text-foreground text-body')` silently drops the colour, and
 * `cn('rounded-control', 'rounded-fab')` keeps both, leaving CSS order to pick.
 */

/** The named Type Scale steps: `fontSize` in the shared theme. */
export const TYPE_SCALE_STEPS = [
  'display',
  'title-lg',
  'title',
  'body',
  'body-sm',
  'label-caps',
  'caption',
  'label-sm',
  'control-sm',
  'field',
  'value',
] as const;

/** The off-scale radii: `borderRadius` in the shared theme. */
export const RADIUS_STEPS = [
  'control',
  'item',
  'control-sm',
  'menu',
  'fab',
  'panel',
] as const;

/** The named shadows: `boxShadow` in the shared theme. */
export const SHADOW_STEPS = [
  'card',
  'popover',
  'dialog',
  'toast',
  'segment',
  'brand',
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TYPE_SCALE_STEPS] }],
      rounded: [{ rounded: [...RADIUS_STEPS] }],
      shadow: [{ shadow: [...SHADOW_STEPS] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

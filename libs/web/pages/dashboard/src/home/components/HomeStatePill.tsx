import { cn } from '@myorganiser/web-ui';

import type { HomePill, HomePillTone } from '../home-view';

const TONE_CLASS = {
  neutral: 'bg-subtle text-subtle-foreground',
  warning: 'bg-warning-soft text-warning-text',
  trust: 'bg-trust-soft text-trust-text',
  danger: 'bg-destructive-soft text-destructive-text',
} as const satisfies Record<HomePillTone, string>;

export interface HomeStatePillProps {
  pill: HomePill;
  /** Desktop pills are larger than the phone tile's. */
  surface: 'desktop' | 'phone';
}

/** A status label on a space, due item or renewal. The tone is the colour. */
export function HomeStatePill({ pill, surface }: HomeStatePillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full font-semibold',
        surface === 'desktop'
          ? 'px-2.5 py-1 text-label-caps'
          : 'px-2 py-0.5 text-label-sm',
        TONE_CLASS[pill.tone],
      )}
    >
      {pill.label}
    </span>
  );
}

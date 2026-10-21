import { cn } from '@myorganiser/web-ui';

import type { AttentionTone } from '../../lib/overview';

export interface AttentionDotProps {
  tone: AttentionTone;
}

/** The tone dot that leads a Needs attention row. Decorative: the copy says it. */
export function AttentionDot({ tone }: AttentionDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-2.5 shrink-0 rounded-full',
        tone === 'danger' ? 'bg-destructive' : 'bg-warning',
      )}
    />
  );
}

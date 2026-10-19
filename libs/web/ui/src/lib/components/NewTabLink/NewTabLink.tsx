import { ExternalLink } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../utils';

/**
 * Anchor that opens in a new tab. It owns `target` and `rel`, and appends an
 * external-link icon plus a screen-reader-only "(opens in a new tab)" cue so
 * the accessible name announces the behaviour.
 */
export interface NewTabLinkProps extends Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'target' | 'rel'
> {
  href: string;
  children: React.ReactNode;
  className?: string;
  iconClassName?: string;
}

const NewTabLink = React.forwardRef<HTMLAnchorElement, NewTabLinkProps>(
  ({ className, iconClassName = 'h-3.5 w-3.5', children, ...props }, ref) => {
    return (
      <a
        ref={ref}
        className={cn('inline-flex items-center gap-1', className)}
        {...props}
        target="_blank"
        rel="noreferrer"
      >
        {children}
        <ExternalLink className={iconClassName} aria-hidden="true" />{' '}
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  },
);
NewTabLink.displayName = 'NewTabLink';

export { NewTabLink };

'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { type MouseEvent, useCallback } from 'react';

/**
 * True when the previous history entry is plausibly an earlier page of this
 * app: there is one, and the document referrer is same-origin. Otherwise the
 * link falls through to its href (`/`).
 */
function canReturnInApp(): boolean {
  if (window.history.length <= 1) return false;
  if (!document.referrer) return false;
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Back control shown in the hero of the standalone legal pages. Goes back to the
 * previous in-app page when there is one; otherwise navigates to Home.
 */
export function LegalBackLink() {
  const handleClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (!canReturnInApp()) return;
    event.preventDefault();
    window.history.back();
  }, []);

  return (
    <Link
      href="/"
      onClick={handleClick}
      className="mb-2 inline-flex items-center gap-1.5 rounded-control-sm text-sm font-semibold text-navy-muted-foreground hover:text-navy-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-foreground"
    >
      <ChevronLeft aria-hidden="true" className="h-3 w-2 shrink-0" />
      Back
    </Link>
  );
}

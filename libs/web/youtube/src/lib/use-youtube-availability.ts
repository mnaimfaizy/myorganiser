'use client';

import { useEffect, useState } from 'react';
import { getYouTubeAvailability, type YouTubeAccess } from './web-youtube';
import { onYouTubeAvailabilityRecheck } from './youtube-availability-recheck';

export interface YouTubeAvailabilityState {
  available: boolean | null;
  /**
   * The User's YouTube Access from the last answer, or null when it was not
   * asked (switch off, still loading, or the first check failed). Lets a page
   * tell a withdrawal from "switched off".
   */
  access: YouTubeAccess | null;
  loading: boolean;
  error: Error | null;
}

const toError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Whether YouTube exists for the signed-in User: the global switch is on AND
 * the User holds YouTube Access (ADR 0129). Needs a session for the `true`
 * path; fails closed (`available: false`) on any error.
 *
 * Checks once on mount, and again whenever `requestYouTubeAvailabilityRecheck`
 * is called — so a page left open when access is withdrawn learns it from the
 * next 404 instead of from a reload. A re-check keeps the current answer while
 * it runs (the page does not blink to loading), and a re-check that errors
 * keeps it too: a network blip on an open page is not a withdrawal. Only a
 * re-check that answers `false` takes YouTube away.
 */
export function useYouTubeAvailability(): YouTubeAvailabilityState {
  const [state, setState] = useState<YouTubeAvailabilityState>({
    available: null,
    access: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    // Only the latest check may write, so a slow earlier answer cannot
    // overwrite a newer one.
    let latest = 0;

    const check = (isRecheck: boolean) => {
      const id = ++latest;
      getYouTubeAvailability()
        .then(({ available, access }) => {
          if (!cancelled && id === latest) {
            setState({ available, access, loading: false, error: null });
          }
        })
        .catch((error: unknown) => {
          if (!cancelled && id === latest) {
            setState((previous) =>
              isRecheck
                ? { ...previous, error: toError(error) }
                : {
                    available: false,
                    access: null,
                    loading: false,
                    error: toError(error),
                  },
            );
          }
        });
    };

    check(false);
    const unsubscribe = onYouTubeAvailabilityRecheck(() => check(true));

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}

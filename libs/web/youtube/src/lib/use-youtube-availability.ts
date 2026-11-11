'use client';

import { useEffect, useState } from 'react';
import {
  getSettledYouTubeAvailability,
  subscribeToSharedYouTubeAvailability,
} from './shared-youtube-availability';
import type { YouTubeAccess, YouTubeAvailability } from './web-youtube';

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
 * Every mounted instance shares one check (#1358): the sidebar and a page
 * asking together send one request, and an instance mounted later starts from
 * the answer already given. The shared answer is dropped when no instance is
 * mounted, so it does not outlive the dashboard.
 *
 * Checks once on mount, and again whenever `requestYouTubeAvailabilityRecheck`
 * is called — one request for all instances — so a page left open when access is withdrawn learns it from the
 * next 404 instead of from a reload. A re-check keeps the current answer while
 * it runs (the page does not blink to loading), and a re-check that errors
 * keeps it too: a network blip on an open page is not a withdrawal. Only a
 * re-check that answers `false` takes YouTube away.
 */
export function useYouTubeAvailability(): YouTubeAvailabilityState {
  const [state, setState] = useState<YouTubeAvailabilityState>(() => {
    const settled = getSettledYouTubeAvailability();
    return settled
      ? { ...settled, loading: false, error: null }
      : { available: null, access: null, loading: true, error: null };
  });

  useEffect(() => {
    let cancelled = false;
    // Only the latest check may write, so a slow earlier answer cannot
    // overwrite a newer one.
    let latest = 0;

    const follow = (
      check: Promise<YouTubeAvailability>,
      isRecheck: boolean,
    ) => {
      const id = ++latest;
      check
        .then(({ available, access }) => {
          if (!cancelled && id === latest) {
            setState({ available, access, loading: false, error: null });
          }
        })
        .catch((error: unknown) => {
          if (!cancelled && id === latest) {
            // A recheck error keeps an answer already shown. With no answer
            // yet (the recheck overtook the first check), there is nothing to
            // keep, so it fails closed like a first check would.
            setState((previous) =>
              isRecheck && !previous.loading
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

    // A hook mounted after an answer arrived already shows it, so its first
    // check is treated like a recheck: an error keeps that answer.
    const hadAnswer = getSettledYouTubeAvailability() !== null;
    const { check, unsubscribe } = subscribeToSharedYouTubeAvailability(
      (recheck) => follow(recheck, true),
    );
    follow(check, hadAnswer);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}

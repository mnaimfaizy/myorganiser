import {
  getYouTubeAvailability,
  type YouTubeAvailability,
} from './web-youtube';
import { onYouTubeAvailabilityRecheck } from './youtube-availability-recheck';

type RecheckSubscriber = (check: Promise<YouTubeAvailability>) => void;

const subscribers = new Set<RecheckSubscriber>();
let shared: Promise<YouTubeAvailability> | null = null;
let settled: YouTubeAvailability | null = null;
let stopListening: (() => void) | null = null;

function startCheck(): Promise<YouTubeAvailability> {
  const check = getYouTubeAvailability();
  shared = check;
  check.then(
    (answer) => {
      if (shared === check) settled = answer;
    },
    () => {
      // A failed check is never shared: the next subscriber asks again.
      if (shared === check) shared = null;
    },
  );
  return check;
}

/**
 * The last answer a shared check gave, while any `useYouTubeAvailability` is
 * mounted. Lets a hook mounted after the answer arrived start from it rather
 * than from loading.
 */
export function getSettledYouTubeAvailability(): YouTubeAvailability | null {
  return settled;
}

/**
 * Joins the one availability check every mounted `useYouTubeAvailability`
 * shares, so the sidebar and a page asking at the same time send one request
 * (#1358). Returns that check — the one in flight or already answered, or a
 * new one when there is none — and calls `onRecheck` with the fresh check
 * each `requestYouTubeAvailabilityRecheck` starts. A recheck is the
 * invalidation: it replaces the shared check for every subscriber at once.
 *
 * The answer lives only while something is subscribed. When the last
 * subscriber leaves (the dashboard unmounts on sign-out), it is dropped, so
 * the next User never starts from the previous User's answer.
 */
export function subscribeToSharedYouTubeAvailability(
  onRecheck: RecheckSubscriber,
): { check: Promise<YouTubeAvailability>; unsubscribe: () => void } {
  subscribers.add(onRecheck);
  stopListening ??= onYouTubeAvailabilityRecheck(() => {
    const check = startCheck();
    for (const subscriber of subscribers) subscriber(check);
  });

  const check = shared ?? startCheck();

  return {
    check,
    unsubscribe: () => {
      if (!subscribers.delete(onRecheck) || subscribers.size > 0) return;
      stopListening?.();
      stopListening = null;
      shared = null;
      settled = null;
    },
  };
}

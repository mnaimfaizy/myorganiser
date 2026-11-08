import type { YouTubeAvailabilityState } from '@myorganiser/web-youtube';

/**
 * Props the availability notice needs, derived from the availability answer
 * (#1308). The four YouTube pages all gate on `useYouTubeAvailability()`; this
 * keeps the reason precedence in one place instead of four copies of a ternary.
 *
 * Precedence: a User whose YouTube Access was withdrawn is `withdrawn` first —
 * a re-check that errors keeps the previous answer, and a network blip must not
 * turn a permanent withdrawal into "try again"; then a check that errored is
 * `unreachable`; everything else is `unavailable`.
 */
export type UnavailableNoticeReason =
  | 'unavailable'
  | 'unreachable'
  | 'withdrawn';

export interface UnavailableNoticeProps {
  reason: UnavailableNoticeReason;
  /** ISO time of the withdrawal. Only meaningful when `reason` is `withdrawn`. */
  withdrawnAt?: string | null;
}

export function toUnavailableNoticeProps(
  state: Pick<YouTubeAvailabilityState, 'access' | 'error'>,
): UnavailableNoticeProps {
  if (state.access?.state === 'withdrawn') {
    return { reason: 'withdrawn', withdrawnAt: state.access.withdrawnAt };
  }
  if (state.error) {
    return { reason: 'unreachable' };
  }
  return { reason: 'unavailable' };
}

/**
 * The withdrawal date in the design's short form ("14 Oct"), with the year
 * appended when it is not the current year ("14 Oct 2025"). Returns null for an
 * absent or unparsable timestamp, so the notice falls back to a sentence
 * without a date.
 *
 * @param now injected so the year rule is testable without a clock.
 */
export function formatWithdrawalDate(
  iso: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const dayAndMonth = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  }).format(date);

  return date.getFullYear() === now.getFullYear()
    ? dayAndMonth
    : `${dayAndMonth} ${date.getFullYear()}`;
}

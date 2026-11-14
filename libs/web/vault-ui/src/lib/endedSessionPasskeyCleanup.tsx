'use client';

import { onSessionEnded, type SessionEndedEvent } from '@myorganiser/auth';
import { disablePasskeyUnlock } from '@myorganiser/web-vault';
import { useEffect } from 'react';

/**
 * Removes the Passkey Unlock record of a User whose Session the server ended
 * (ADR 0136, decision 6). Only `refresh_rejected` counts: a Platform Admin
 * force-logout and a refresh token reaching its lifetime both arrive as that
 * reason and cannot be told apart, so both remove it. A refresh that merely
 * failed emits nothing, and `signed_out_elsewhere` is covered by the other
 * window's own sign-out. Only that owner's record goes; an event with no
 * owner removes nothing. `disablePasskeyUnlock` swallows storage errors, so
 * this never gets in the way of the redirect to sign-in.
 */
export function removePasskeyUnlockForEndedSession(
  event: SessionEndedEvent,
): void {
  if (event.reason !== 'refresh_rejected' || !event.owner) return;
  disablePasskeyUnlock(event.owner);
}

/**
 * Mount once, in the root layout and before the route's children, so it is
 * subscribed before a guard's cold-load restore can end the Session. A guard
 * subscribes only once its check has passed, which is too late for that case.
 */
export function EndedSessionPasskeyCleanup(): null {
  useEffect(() => onSessionEnded(removePasskeyUnlockForEndedSession), []);
  return null;
}

/**
 * Why a signed-in Session ended without this window asking for it.
 *
 * - `refresh_rejected`: the server refused a token refresh (see
 *   `isRefreshRejectedByServer`), so the Session cannot be continued.
 * - `signed_out_elsewhere`: another window of this browser signed out and
 *   removed the user the windows share.
 *
 * Neither covers a refresh that failed for a network reason, and neither
 * covers this window's own `signOut()` — the caller of that already knows.
 */
export type SessionEndedReason = 'refresh_rejected' | 'signed_out_elsewhere';

export interface SessionEndedEvent {
  reason: SessionEndedReason;
  /**
   * The id of the User whose Session ended, read before the Session was
   * cleared. Set for `refresh_rejected` when a User was signed in; absent
   * when none was. A subscriber that must act on that User's device-local
   * records (the Passkey Unlock record) needs it, since the current-User
   * entry is gone by the time the event fires.
   */
  owner?: string;
}

export type SessionEndedListener = (event: SessionEndedEvent) => void;

export interface SessionEndedSignal {
  /** Subscribe; the returned function unsubscribes and is safe to call twice. */
  subscribe(listener: SessionEndedListener): () => void;
  emit(event: SessionEndedEvent): void;
}

export function createSessionEndedSignal(): SessionEndedSignal {
  const listeners = new Set<SessionEndedListener>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    emit(event) {
      for (const listener of Array.from(listeners)) {
        try {
          listener(event);
        } catch {
          // A listener is a redirect, not part of the request that ended the
          // Session: one that throws must not replace the refresh error the
          // caller is about to receive, nor starve the listeners after it.
        }
      }
    },
  };
}

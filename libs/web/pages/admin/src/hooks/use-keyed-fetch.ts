import { useEffect, useRef, useState } from 'react';

/** How one request ended. A failed request carries no value. */
export type KeyedFetchOutcome<Result> =
  | { ok: true; value: Result }
  | { ok: false };

export interface UseKeyedFetchOptions<Result, State> {
  /**
   * Names the request. A new key starts a new request and drops any response
   * for an older one. `null` means idle: nothing is requested.
   */
  key: string | null;
  /** The state before any request settles. */
  initial: State;
  /** Makes the request for the current key. Read when the key changes. */
  load: () => Promise<Result>;
  /**
   * Folds a settled outcome into the state. Read with `load`, so it sees the
   * values the request was made with. `previous` is the last settled state.
   */
  settle: (previous: State, outcome: KeyedFetchOutcome<Result>) => State;
  /** Waits this long after a key change before requesting. Defaults to 0: no wait. */
  delayMs?: number;
}

export interface KeyedFetchState<State> {
  /** The last settled state. It may answer an older key while `pending`. */
  state: State;
  /** The current key has not settled yet. Always false when the key is `null`. */
  pending: boolean;
}

interface Settled<State> {
  key: string | null;
  state: State;
}

/**
 * Fetches once per key and keeps the last settled result. A result counts as
 * settled only when its key matches the current key, so a response for an old
 * key can never overwrite the state for the current one.
 *
 * `pending` is derived from the keys, not stored. The same key asked for again
 * reads as settled at once, while it is requested afresh in the background.
 */
export function useKeyedFetch<Result, State>({
  key,
  initial,
  load,
  settle,
  delayMs = 0,
}: UseKeyedFetchOptions<Result, State>): KeyedFetchState<State> {
  const [settled, setSettled] = useState<Settled<State>>({
    key: null,
    state: initial,
  });

  // The latest load and settle, read when the key changes. Callers pass new
  // closures every render; only the key decides when to request.
  const requestRef = useRef({ load, settle });
  useEffect(() => {
    requestRef.current = { load, settle };
  });

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const { load: loadKey, settle: settleKey } = requestRef.current;

    const finish = (outcome: KeyedFetchOutcome<Result>) => {
      // A newer key has started; this response is stale.
      if (cancelled) return;
      setSettled((previous) => ({
        key,
        state: settleKey(previous.state, outcome),
      }));
    };

    const request = () => {
      loadKey().then(
        (value) => finish({ ok: true, value }),
        () => finish({ ok: false }),
      );
    };

    if (delayMs <= 0) {
      request();
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(request, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, delayMs]);

  return {
    state: settled.state,
    pending: key !== null && settled.key !== key,
  };
}

'use client';

import {
  normalizeAddresses,
  normalizeGroceries,
  normalizeMobileNumbers,
  normalizeSubscriptions,
  normalizeTasks,
  type VaultHandle,
} from '@myorganiser/web-vault';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';
import { useEffect, useState } from 'react';
import {
  localDateKey,
  summarizeCountedRecords,
  summarizeGroceries,
  summarizeSubscriptions,
  summarizeTasks,
  type HomeSummaryData,
} from '../home-summary';

/** Milliseconds from `from` to the next local midnight strictly after it. */
function msUntilNextLocalMidnight(from: Date): number {
  const nextMidnight = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate() + 1,
    0,
    0,
    0,
    0,
  );
  return nextMidnight.getTime() - from.getTime();
}

/** What a vault with no records reads as: every count zero. */
function emptySummary(now: Date): HomeSummaryData {
  return {
    tasks: summarizeTasks([], now),
    subscriptions: summarizeSubscriptions([], now),
    groceries: summarizeGroceries({ lists: [], catalog: [] }),
    addresses: summarizeCountedRecords([]),
    mobile: summarizeCountedRecords([]),
  };
}

export interface UseHomeSummaryResult {
  /**
   * The clock the summary was derived against. Advances at least once per
   * local day while the hook is mounted, so it never reads a day that has
   * already ended.
   */
  now: Date;
  /** Null until the five blobs have been read while unlocked. */
  summary: HomeSummaryData | null;
}

/**
 * Reads the five vault blobs Home summarises, read-only, while the vault is
 * unlocked. A failed read counts as empty, as the old dashboard cards did.
 */
export function useHomeSummary(
  handle: VaultHandle | null,
): UseHomeSummaryResult {
  const [now, setNow] = useState(() => new Date());
  const [summary, setSummary] = useState<HomeSummaryData | null>(null);

  // Read-only, so there is no overwrite to prevent here — but a dashboard
  // still showing the count from before convergence is the same staleness
  // wearing a quieter face (#587).
  const revision = useLocalVaultRevision();

  // `now` goes stale across local midnight otherwise, so the greeting and
  // both date-based sections keep reading yesterday until a reload (#1290).
  // A sleeping or backgrounded tab misses the scheduled timeout, so the
  // visibility listener catches up at once if the day has already turned
  // over by the time the tab is looked at again.
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const scheduleNextRefresh = () => {
      timeoutId = setTimeout(() => {
        setNow(new Date());
        scheduleNextRefresh();
      }, msUntilNextLocalMidnight(new Date()));
    };
    scheduleNextRefresh();

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      setNow((previous) => {
        const fresh = new Date();
        return localDateKey(fresh) === localDateKey(previous)
          ? previous
          : fresh;
      });
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const unlocked = handle?.isUnlocked === true;

  // Lock drops the summary, so an unlock never flashes the previous counts.
  // Setting null on a value already null is a no-op for React.
  useEffect(() => {
    if (!unlocked) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSummary(null);
    }
  }, [unlocked]);

  // The hook stays mounted across lock and unlock, so the unlock state is a
  // dependency: unlocking the same handle must read the blobs again.
  useEffect(() => {
    if (handle === null || !unlocked) return;

    // Cancellation matters because this effect re-fires on every convergence:
    // an earlier read resolving late must not put a stale summary back over
    // the one a later read just applied.
    let isActive = true;

    Promise.all([
      handle
        .loadDecryptedData<unknown>({ type: 'tasks', defaultValue: [] })
        .catch(() => []),
      handle
        .loadDecryptedData<unknown>({ type: 'subscriptions', defaultValue: [] })
        .catch(() => []),
      handle
        .loadDecryptedData<unknown>({ type: 'groceries', defaultValue: null })
        .catch(() => null),
      handle
        .loadDecryptedData<unknown>({ type: 'addresses', defaultValue: [] })
        .catch(() => []),
      handle
        .loadDecryptedData<unknown>({ type: 'mobileNumbers', defaultValue: [] })
        .catch(() => []),
    ])
      .then(([tasks, subscriptions, groceries, addresses, mobile]) => {
        if (!isActive) return;
        const groceriesValue = normalizeGroceries(groceries).value;
        setSummary({
          tasks: summarizeTasks(normalizeTasks(tasks).value, now),
          subscriptions: summarizeSubscriptions(
            normalizeSubscriptions(subscriptions).value,
            now,
          ),
          groceries: summarizeGroceries({
            lists: groceriesValue.lists,
            catalog: groceriesValue.catalog,
          }),
          addresses: summarizeCountedRecords(
            normalizeAddresses(addresses).value,
          ),
          mobile: summarizeCountedRecords(normalizeMobileNumbers(mobile).value),
        });
      })
      .catch(() => {
        // A throwing normalizer must not leave Home on "Loading…" forever.
        if (isActive) setSummary(emptySummary(now));
      });

    return () => {
      isActive = false;
    };
  }, [handle, unlocked, revision, now]);

  return { now, summary: unlocked ? summary : null };
}

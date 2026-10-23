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
  summarizeCountedRecords,
  summarizeGroceries,
  summarizeSubscriptions,
  summarizeTasks,
  type HomeSummaryData,
} from '../home-summary';

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
  /** The clock this read was taken against, fixed for the life of the page. */
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
  const [now] = useState(() => new Date());
  const [summary, setSummary] = useState<HomeSummaryData | null>(null);

  // Read-only, so there is no overwrite to prevent here — but a dashboard
  // still showing the count from before convergence is the same staleness
  // wearing a quieter face (#587).
  const revision = useLocalVaultRevision();

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

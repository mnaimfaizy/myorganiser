import { formatDistanceStrict, isValid, parseISO } from 'date-fns';

import type { LatestBackupState } from './hooks/useLatestBackup';

/** Which layout a section renders: the desktop card grid or the phone list. */
export type AccountVariant = 'desktop' | 'phone';

/**
 * A phone list row's Select trigger, styled as the row's value: sized to its
 * content, never truncated, no field chrome.
 */
export const PHONE_ROW_SELECT_TRIGGER_CLASS =
  'h-auto w-auto shrink-0 border-transparent bg-transparent px-0 text-body text-muted-foreground [&>span]:overflow-visible [&>span]:whitespace-normal';

/**
 * The one-line summary of the latest export. `null` while loading, so the
 * caller can draw a placeholder instead of text.
 */
export function backupSummaryLine(
  state: LatestBackupState,
  now: Date,
): string | null {
  if (state.status === 'loading') return null;
  if (state.status === 'empty') return 'No backups recorded yet';
  if (state.status === 'error') return 'Last backup: unknown';

  const createdAt = parseISO(state.record.createdAt);
  if (!isValid(createdAt)) return 'Last backup: unknown';

  const when = formatDistanceStrict(createdAt, now, { addSuffix: true });
  return state.record.source === 'google-drive'
    ? `Last backup ${when} to Google Drive`
    : `Last backup ${when}`;
}

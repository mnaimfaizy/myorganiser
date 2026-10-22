import { formatDistanceStrict, isValid, parseISO } from 'date-fns';

import type { LatestBackupState } from './hooks/useLatestBackup';

/** Which layout a section renders: the desktop card grid or the phone list. */
export type AccountVariant = 'desktop' | 'phone';

/**
 * The first letter of up to two words in a name, upper-cased, for an avatar.
 * Copy of the dashboard helper: a page may not import from another page.
 */
export function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

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

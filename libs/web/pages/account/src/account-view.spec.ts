import type {
  LatestBackupRecord,
  LatestBackupState,
} from './hooks/useLatestBackup';
import { backupSummaryLine, initialsOf } from './account-view';

const NOW = new Date('2026-10-22T12:00:00Z');

function loadedState(createdAt: string, source = 'manual'): LatestBackupState {
  const record: LatestBackupRecord = {
    id: 'backup-1',
    event: 'export',
    source,
    status: 'success',
    createdAt,
    schemaVersion: 1,
    sizeBytes: 1024,
  };
  return { status: 'loaded', record };
}

describe('initialsOf', () => {
  it('returns two upper-case initials for a two-word name', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
  });

  it('keeps only the first two initials of a longer name', () => {
    expect(initialsOf('Mary Anne Jane Smith')).toBe('MA');
  });

  it('returns one letter for a single-word name', () => {
    expect(initialsOf('Cher')).toBe('C');
  });

  it('upper-cases lower-case input', () => {
    expect(initialsOf('ada lovelace')).toBe('AL');
  });

  it('ignores repeated and leading spaces', () => {
    expect(initialsOf('  Ada   Lovelace')).toBe('AL');
  });

  it('returns an empty string for an empty or blank name', () => {
    expect(initialsOf('')).toBe('');
    expect(initialsOf('   ')).toBe('');
  });
});

describe('backupSummaryLine', () => {
  it('returns null while the latest backup is loading', () => {
    expect(
      backupSummaryLine({ status: 'loading', record: null }, NOW),
    ).toBeNull();
  });

  it('reports that no backups exist when the state is empty', () => {
    expect(backupSummaryLine({ status: 'empty', record: null }, NOW)).toBe(
      'No backups recorded yet',
    );
  });

  it('reports the last backup as unknown when loading failed', () => {
    const state: LatestBackupState = {
      status: 'error',
      record: null,
      error: new Error('network down'),
    };
    expect(backupSummaryLine(state, NOW)).toBe('Last backup: unknown');
  });

  it('reports the last backup as unknown when createdAt cannot be parsed', () => {
    expect(backupSummaryLine(loadedState('not-a-date'), NOW)).toBe(
      'Last backup: unknown',
    );
  });

  it('names Google Drive when the latest backup came from google-drive', () => {
    expect(
      backupSummaryLine(
        loadedState('2026-10-20T12:00:00Z', 'google-drive'),
        NOW,
      ),
    ).toBe('Last backup 2 days ago to Google Drive');
  });

  it('omits the destination for any other source', () => {
    expect(
      backupSummaryLine(loadedState('2026-10-20T12:00:00Z', 'manual'), NOW),
    ).toBe('Last backup 2 days ago');
  });

  it('uses a future suffix when createdAt is after the injected now', () => {
    expect(
      backupSummaryLine(loadedState('2026-10-24T12:00:00Z', 'manual'), NOW),
    ).toBe('Last backup in 2 days');
  });
});

import '@testing-library/jest-dom';

import { render, screen } from '@testing-library/react';

import type { LatestBackupState } from '../hooks/useLatestBackup';

import { AccountBackupSummary } from './AccountBackupSummary';

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function loadedBackup(
  source: string,
  createdAt: string = new Date(Date.now() - TWO_DAYS_MS).toISOString(),
): LatestBackupState {
  return {
    status: 'loaded',
    record: {
      id: 'backup-1',
      event: 'export',
      source,
      status: 'success',
      createdAt,
      schemaVersion: 1,
      sizeBytes: 2048,
    },
  };
}

const LOADING: LatestBackupState = { status: 'loading', record: null };

describe('AccountBackupSummary', () => {
  it('shows a placeholder instead of summary text while loading, and still links to the Vault', () => {
    const { container } = render(
      <AccountBackupSummary variant="desktop" state={LOADING} />,
    );

    expect(screen.queryByText(/Last backup/)).toBeNull();
    // Skeleton is the decorative placeholder: aria-hidden, animate-pulse.
    const placeholder = container.querySelector('[class*="animate-pulse"]');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link', { name: 'Go to Vault →' })).toHaveAttribute(
      'href',
      '/dashboard/vault',
    );
  });

  it('shows the placeholder and still links the whole phone card to the Vault while loading', () => {
    const { container } = render(
      <AccountBackupSummary variant="phone" state={LOADING} />,
    );

    expect(screen.queryByText(/Last backup/)).toBeNull();
    expect(
      container.querySelector('[class*="animate-pulse"]'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Vault →' })).toHaveAttribute(
      'href',
      '/dashboard/vault',
    );
  });

  it('describes a loaded Google Drive backup relative to now', () => {
    render(
      <AccountBackupSummary
        variant="desktop"
        state={loadedBackup('google-drive')}
      />,
    );

    expect(
      screen.getByText(/Last backup 2 days ago to Google Drive/),
    ).toBeInTheDocument();
  });

  it('omits the Google Drive destination for a loaded backup from another source', () => {
    render(
      <AccountBackupSummary variant="desktop" state={loadedBackup('device')} />,
    );

    expect(
      screen.getByText('Last backup 2 days ago', { exact: true }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/to Google Drive/)).toBeNull();
  });

  it('says the last backup is unknown when the loaded createdAt is not a date', () => {
    render(
      <AccountBackupSummary
        variant="desktop"
        state={loadedBackup('google-drive', 'not-a-date')}
      />,
    );

    expect(screen.getByText('Last backup: unknown')).toBeInTheDocument();
    expect(screen.queryByText(/to Google Drive/)).toBeNull();
  });

  it('says no backups are recorded when the latest backup is empty', () => {
    render(
      <AccountBackupSummary
        variant="desktop"
        state={{ status: 'empty', record: null }}
      />,
    );

    expect(screen.getByText('No backups recorded yet')).toBeInTheDocument();
  });

  it('says the last backup is unknown when the fetch errored', () => {
    render(
      <AccountBackupSummary
        variant="desktop"
        state={{ status: 'error', record: null, error: new Error('boom') }}
      />,
    );

    expect(screen.getByText('Last backup: unknown')).toBeInTheDocument();
  });

  it('explains where backups live and links to the Vault on desktop', () => {
    render(
      <AccountBackupSummary
        variant="desktop"
        state={loadedBackup('google-drive')}
      />,
    );

    expect(
      screen.getByText(
        'Backups, Recovery Key and passphrase live on the Vault page.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Vault →' })).toHaveAttribute(
      'href',
      '/dashboard/vault',
    );
  });

  it('renders the whole phone card as one link to the Vault', () => {
    render(
      <AccountBackupSummary
        variant="phone"
        state={loadedBackup('google-drive')}
      />,
    );

    const link = screen.getByRole('link', {
      name: /Last backup 2 days ago to Google Drive/,
    });
    expect(link).toHaveAttribute('href', '/dashboard/vault');
    expect(link).toHaveTextContent('Go to Vault →');
    expect(
      screen.queryByText(
        'Backups, Recovery Key and passphrase live on the Vault page.',
      ),
    ).toBeNull();
  });
});

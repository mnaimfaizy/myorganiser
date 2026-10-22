/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

import type {
  AdminAuditLogEntry,
  AdminAuditLogListResponse,
} from '@myorganiser/app-api-client';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { createPlatformAdminApi } from '../lib/apiClient';
import { formatAuditTimestamp } from '../lib/formatAuditLog';

import { AuditLogPageClient } from './AuditLogPageClient';

const mockListAuditLogs = jest.fn();

function auditPage(entries: AdminAuditLogEntry[]): {
  data: AdminAuditLogListResponse;
} {
  return {
    data: {
      entries,
      total: entries.length,
      page: 1,
      pageSize: 50,
    },
  };
}

const sampleEntries: AdminAuditLogEntry[] = [
  {
    id: 'audit-1',
    action: 'disable',
    actorUserId: 'actor-1',
    targetUserId: 'target-1',
    actorName: 'Actor 1',
    targetName: 'Target 1',
    actorDeleted: false,
    targetDeleted: false,
    createdAt: '2026-07-16T12:00:00.000Z',
  },
  {
    id: 'audit-2',
    action: 'force_logout',
    actorUserId: 'actor-2',
    targetUserId: 'target-2',
    actorName: 'Actor 2',
    targetName: 'Target 2',
    actorDeleted: false,
    targetDeleted: false,
    createdAt: '2026-07-15T08:30:00.000Z',
  },
  {
    id: 'audit-3',
    action: 'resend_verification',
    actorUserId: 'actor-3',
    targetUserId: 'target-3',
    actorName: 'Actor 3',
    targetName: 'Target 3',
    actorDeleted: false,
    targetDeleted: false,
    createdAt: '2026-07-14T16:45:00.000Z',
  },
];

describe('AuditLogPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      listAuditLogs: mockListAuditLogs,
    });
    mockListAuditLogs.mockResolvedValue(auditPage(sampleEntries));
  });

  it('shows loading state on mount and calls listAuditLogs with pageSize 50', async () => {
    let resolveLoad!: (value: { data: AdminAuditLogListResponse }) => void;
    const pendingLoad = new Promise<{ data: AdminAuditLogListResponse }>(
      (resolve) => {
        resolveLoad = resolve;
      },
    );
    mockListAuditLogs.mockReturnValue(pendingLoad);

    render(<AuditLogPageClient />);

    expect(
      screen.getByRole('heading', { name: 'Admin Audit Log' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    resolveLoad(auditPage(sampleEntries));

    await waitFor(() => {
      expect(mockListAuditLogs).toHaveBeenCalledWith({ pageSize: 50 });
    });

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    });
  });

  it('renders table headers and rows with actor, target, and action labels', async () => {
    render(<AuditLogPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Disable')).toBeInTheDocument();
    });

    expect(mockListAuditLogs).toHaveBeenCalledWith({ pageSize: 50 });
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Actor')).toBeInTheDocument();
    expect(screen.getByText('Target')).toBeInTheDocument();

    expect(screen.getByText('actor-1')).toBeInTheDocument();
    expect(screen.getByText('target-1')).toBeInTheDocument();
    expect(screen.getByText('Force logout')).toBeInTheDocument();
    expect(screen.getByText('actor-2')).toBeInTheDocument();
    expect(screen.getByText('target-2')).toBeInTheDocument();
    expect(screen.getByText('Resend verification')).toBeInTheDocument();
    expect(screen.getByText('actor-3')).toBeInTheDocument();
    expect(screen.getByText('target-3')).toBeInTheDocument();
  });

  it('renders the YouTube access grant and withdraw actions with their labels', async () => {
    mockListAuditLogs.mockResolvedValue(
      auditPage([
        {
          id: 'audit-yt-grant',
          action: 'youtube_access_grant',
          actorUserId: 'actor-yt',
          targetUserId: 'target-yt',
          actorName: 'Actor',
          targetName: 'Target',
          actorDeleted: false,
          targetDeleted: false,
          createdAt: '2026-10-14T09:00:00.000Z',
        },
        {
          id: 'audit-yt-withdraw',
          action: 'youtube_access_withdraw',
          actorUserId: 'actor-yt',
          targetUserId: 'target-yt',
          actorName: 'Actor',
          targetName: 'Target',
          actorDeleted: false,
          targetDeleted: false,
          createdAt: '2026-10-14T10:00:00.000Z',
        },
      ]),
    );

    render(<AuditLogPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Grant YouTube Access')).toBeInTheDocument();
    });

    expect(screen.getByText('Withdraw YouTube Access')).toBeInTheDocument();
    expect(screen.queryByText('youtube_access_grant')).not.toBeInTheDocument();
    expect(
      screen.queryByText('youtube_access_withdraw'),
    ).not.toBeInTheDocument();
  });

  it('formats timestamps with the same Intl options as formatAuditTimestamp', async () => {
    const timestamp = '2026-07-16T12:00:00.000Z';
    mockListAuditLogs.mockResolvedValue(
      auditPage([
        {
          id: 'audit-ts',
          action: 'enable',
          actorUserId: 'actor-ts',
          targetUserId: 'target-ts',
          actorName: 'Actor',
          targetName: 'Target',
          actorDeleted: false,
          targetDeleted: false,
          createdAt: timestamp,
        },
      ]),
    );

    render(<AuditLogPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText(formatAuditTimestamp(timestamp)),
      ).toBeInTheDocument();
    });
  });

  it('shows empty state when the API returns no entries', async () => {
    mockListAuditLogs.mockResolvedValue(auditPage([]));

    render(<AuditLogPageClient />);

    await waitFor(() => {
      expect(screen.getByText('No audit log entries yet.')).toBeInTheDocument();
    });

    expect(mockListAuditLogs).toHaveBeenCalledWith({ pageSize: 50 });
    expect(screen.queryByText('Time')).not.toBeInTheDocument();
  });

  it('shows an error message when listAuditLogs rejects', async () => {
    mockListAuditLogs.mockRejectedValue(new Error('Network error'));

    render(<AuditLogPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText('Unable to load audit log. Please try again.'),
      ).toBeInTheDocument();
    });

    expect(mockListAuditLogs).toHaveBeenCalledWith({ pageSize: 50 });
    expect(screen.queryByText('Time')).not.toBeInTheDocument();
    expect(screen.queryByText('Disable')).not.toBeInTheDocument();
  });

  it('does not surface vault or secret operational fields from bloated entries', async () => {
    const secretFieldValues = [
      'SECRET_VAULT_BLOB',
      'ya29.secret-token',
      'should-never-appear',
      'mk-secret',
    ] as const;

    const bloatedEntry = {
      ...sampleEntries[0],
      vaultCiphertext: 'SECRET_VAULT_BLOB',
      youtubeOAuthToken: 'ya29.secret-token',
      password: 'should-never-appear',
      masterKey: 'mk-secret',
    } as AdminAuditLogEntry;

    mockListAuditLogs.mockResolvedValue(auditPage([bloatedEntry]));

    const { container } = render(<AuditLogPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Disable')).toBeInTheDocument();
    });

    expect(screen.getByText('actor-1')).toBeInTheDocument();
    expect(screen.getByText('target-1')).toBeInTheDocument();

    for (const secretValue of secretFieldValues) {
      expect(container.textContent).not.toContain(secretValue);
    }
  });
});

/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

jest.mock('next/link', () => {
  const React = require('react');

  return {
    __esModule: true,
    default: ({
      children,
      href,
      ...props
    }: {
      children: React.ReactNode;
      href: string;
    }) => React.createElement('a', { href, ...props }, children),
  };
});

import type {
  AdminAuditLogEntry,
  AdminAuditLogListResponse,
} from '@myorganiser/app-api-client';
import { act, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import { createPlatformAdminApi } from '../../lib/apiClient';
import { formatAuditTimestamp } from '../../lib/formatAuditLog';

import { RecentAdminActivity } from './RecentAdminActivity';

const mockListAuditLogs = jest.fn();

function auditPage(entries: AdminAuditLogEntry[]): {
  data: AdminAuditLogListResponse;
} {
  return {
    data: { entries, total: entries.length, page: 1, pageSize: 5 },
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
    action: 'youtube_access_grant',
    actorUserId: 'actor-2',
    targetUserId: null,
    actorName: 'Actor 2',
    targetName: null,
    actorDeleted: false,
    targetDeleted: true,
    createdAt: '2026-07-15T08:30:00.000Z',
  },
];

async function renderActivity() {
  await act(async () => {
    render(<RecentAdminActivity />);
  });
}

describe('RecentAdminActivity', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      listAuditLogs: mockListAuditLogs,
    });
    mockListAuditLogs.mockResolvedValue(auditPage(sampleEntries));
  });

  it('requests five audit entries with pageSize 5', async () => {
    await renderActivity();

    await screen.findByText('Disable');

    expect(mockListAuditLogs).toHaveBeenCalledTimes(1);
    expect(mockListAuditLogs).toHaveBeenCalledWith({ pageSize: 5 });
  });

  it('renders each row with its formatted action label', async () => {
    await renderActivity();

    expect(await screen.findByText('Disable')).toBeInTheDocument();
    expect(screen.getByText('Grant YouTube Access')).toBeInTheDocument();
  });

  it('links a target name to its user detail page', async () => {
    await renderActivity();

    const link = await screen.findByRole('link', { name: 'Target 1' });

    expect(link).toHaveAttribute('href', '/admin/users/target-1');
  });

  it('renders a deleted target as "Deleted user" with no link in that row', async () => {
    await renderActivity();

    await screen.findByText('Grant YouTube Access');

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[1]).getByText('Deleted user')).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the actor as "by <actor name>" and the timestamp in a time element', async () => {
    await renderActivity();

    expect(await screen.findByText('by Actor 1')).toBeInTheDocument();

    const createdAt = sampleEntries[0].createdAt;
    const time = screen.getByText(formatAuditTimestamp(createdAt));
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', createdAt);
  });

  it('shows "by Deleted user" when the entry has no actor', async () => {
    mockListAuditLogs.mockResolvedValue(
      auditPage([
        {
          ...sampleEntries[0],
          actorUserId: null,
          actorName: null,
          actorDeleted: true,
        },
      ]),
    );

    await renderActivity();

    expect(await screen.findByText('by Deleted user')).toBeInTheDocument();
  });

  it('shows the empty message when there are no entries', async () => {
    mockListAuditLogs.mockResolvedValue(auditPage([]));

    await renderActivity();

    expect(
      await screen.findByText('No audit log entries yet.'),
    ).toBeInTheDocument();
  });

  it('shows the error message when the request rejects', async () => {
    mockListAuditLogs.mockRejectedValue(new Error('network down'));

    await renderActivity();

    expect(
      await screen.findByText('Unable to load audit log. Please try again.'),
    ).toBeInTheDocument();
  });

  it('renders the section heading and the Audit log link', async () => {
    await renderActivity();

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Recent admin activity',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit log' })).toHaveAttribute(
      'href',
      '/admin/audit-logs',
    );
  });
});

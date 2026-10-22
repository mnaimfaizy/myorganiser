/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

jest.mock('@myorganiser/auth', () => ({
  ...jest.requireActual('@myorganiser/auth'),
  getCurrentUser: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobileState: jest.fn(),
  useToast: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
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
  AdminUserIdentity,
} from '@myorganiser/app-api-client';
import { getCurrentUser } from '@myorganiser/auth';
import { useIsMobileState, useToast } from '@myorganiser/web-ui';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { useParams } from 'next/navigation';

import { createPlatformAdminApi } from '../lib/apiClient';
import { AUDIT_LOG_MESSAGES } from '../lib/auditLog';

import { UserDetailPageClient } from './UserDetailPageClient';

const mockGetUserById = jest.fn();
const mockGetYouTubeAccessUsage = jest.fn();
const mockGrantYouTubeAccess = jest.fn();
const mockListAuditLogs = jest.fn();
const mockToast = jest.fn();

const userWithPhone: AdminUserIdentity = {
  id: 'u-2',
  name: 'Grace Hopper',
  email: 'grace@example.com',
  firstName: 'Grace',
  lastName: 'Hopper',
  phone: '+1-555-0100',
  role: 'user',
  disabled: true,
  emailVerified: false,
  youtubeAccess: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const userWithoutPhone: AdminUserIdentity = {
  id: 'u-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'platform_admin',
  disabled: false,
  emailVerified: true,
  youtubeAccess: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const emptyAuditPage: AdminAuditLogListResponse = {
  entries: [],
  total: 0,
  page: 1,
  pageSize: 25,
};

// "YouTube Access" is a required admin field and button label. The Platform
// Admin row describes its own scope with "Never vault contents.", so the vault
// pattern names the data the page must never hold rather than the bare word.
// Other YouTube-labelled content (tokens, channel data, sync state) stays sensitive.
const SENSITIVE_PATTERNS = [
  /vault (blob|ciphertext|key|data)/i,
  /youtube(?! access)/i,
  /refresh token/i,
  /channel id/i,
  /password/i,
  /ciphertext/i,
  /unlock/i,
  /subscription sync/i,
  /oauth token/i,
  /master key/i,
];

function expectNoSensitiveContent(container: HTMLElement) {
  const text = container.textContent?.toLowerCase() ?? '';

  for (const pattern of SENSITIVE_PATTERNS) {
    expect(text).not.toMatch(pattern);
  }
}

function createAxios404Error() {
  return Object.assign(new Error('Not Found'), {
    isAxiosError: true,
    response: { status: 404 },
  });
}

function createAuditEntry(index: number): AdminAuditLogEntry {
  return {
    id: `entry-${index}`,
    actorUserId: 'admin-1',
    targetUserId: 'u-2',
    actorName: `Actor ${index}`,
    targetName: 'Grace Hopper',
    actorDeleted: false,
    targetDeleted: false,
    action: 'disable',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function resetPageMocks() {
  mockGetUserById.mockReset();
  mockGetYouTubeAccessUsage.mockReset();
  mockGrantYouTubeAccess.mockReset();
  mockListAuditLogs.mockReset();
  mockToast.mockReset();

  (createPlatformAdminApi as jest.Mock).mockReset();
  (createPlatformAdminApi as jest.Mock).mockReturnValue({
    listUsers: jest.fn(),
    getUserById: mockGetUserById,
    getYouTubeAccessUsage: mockGetYouTubeAccessUsage,
    grantYouTubeAccess: mockGrantYouTubeAccess,
    listAuditLogs: mockListAuditLogs,
  });
  (useToast as jest.Mock).mockReset();
  (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
  (useIsMobileState as jest.Mock).mockReset();
  (useIsMobileState as jest.Mock).mockReturnValue(false);
  (getCurrentUser as jest.Mock).mockReset();
  (useParams as jest.Mock).mockReset();
  (useParams as jest.Mock).mockReturnValue({ userId: 'u-2' });

  mockGetUserById.mockResolvedValue({ data: userWithPhone });
  mockGetYouTubeAccessUsage.mockResolvedValue({
    data: { everGranted: 18, ceiling: 25 },
  });
  mockListAuditLogs.mockResolvedValue({ data: emptyAuditPage });
}

describe('UserDetailPageClient', () => {
  beforeEach(() => {
    resetPageMocks();
  });

  it('renders the display name, the email and phone in the meta line, and the All users link', async () => {
    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Grace Hopper' }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/grace@example\.com/)).toHaveTextContent(
      'grace@example.com · +1-555-0100 · Joined',
    );
    expect(screen.getByRole('link', { name: 'All users' })).toHaveAttribute(
      'href',
      '/admin/users',
    );
    expect(mockGetUserById).toHaveBeenCalledWith({ userId: 'u-2' });
  });

  it('omits the phone from the meta line when phone is absent', async () => {
    (useParams as jest.Mock).mockReturnValue({ userId: 'u-1' });
    mockGetUserById.mockResolvedValue({ data: userWithoutPhone });

    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Ada Lovelace' }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/ada@example\.com/)).toHaveTextContent(
      /^ada@example\.com · Joined /,
    );
  });

  it('shows User not found when the API returns 404', async () => {
    mockGetUserById.mockRejectedValue(createAxios404Error());

    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(screen.getByText('User not found.')).toBeInTheDocument();
    });
  });

  it('shows a generic error when getUserById rejects with a non-404 error', async () => {
    mockGetUserById.mockRejectedValue(new Error('Network error'));

    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText('Unable to load user. Please try again.'),
      ).toBeInTheDocument();
    });
  });

  it('shows User not found when userId is missing and does not call the API', async () => {
    (useParams as jest.Mock).mockReturnValue({});

    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(screen.getByText('User not found.')).toBeInTheDocument();
    });

    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it('does not surface the vault ciphertext, YouTube OAuth token, password or master key', async () => {
    const secretFieldValues = [
      'SECRET_BLOB',
      'yt-sentinel',
      'never-shown',
      'mk-secret',
    ] as const;

    const bloatedUser = {
      ...userWithPhone,
      vaultCiphertext: 'SECRET_BLOB',
      youtubeOAuthToken: 'yt-sentinel',
      password: 'never-shown',
      masterKey: 'mk-secret',
    } as AdminUserIdentity;

    mockGetUserById.mockResolvedValue({ data: bloatedUser });

    const { container } = render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Grace Hopper' }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/grace@example\.com/)).toHaveTextContent(
      'grace@example.com · +1-555-0100',
    );

    for (const secretValue of secretFieldValues) {
      expect(container.textContent).not.toContain(secretValue);
    }

    expectNoSensitiveContent(container);
  });

  it('shows the places left once the usage call resolves', async () => {
    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText('Not granted · 7 of 25 places left'),
      ).toBeInTheDocument();
    });
    expect(mockGetYouTubeAccessUsage).toHaveBeenCalledTimes(1);
  });

  it('shows Loading… in the YouTube Access row while the usage call is pending', async () => {
    mockGetYouTubeAccessUsage.mockReturnValue(new Promise(() => undefined));

    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Not granted · Loading…')).toBeInTheDocument();
    });
  });

  it('shows Unavailable in the YouTube Access row when the usage call fails, and keeps the email and the Grant button on screen', async () => {
    mockGetYouTubeAccessUsage.mockRejectedValue(new Error('Network error'));

    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Not granted · Unavailable')).toBeInTheDocument();
    });
    expect(screen.getByText(/grace@example\.com/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Grant YouTube Access' }),
    ).toBeInTheDocument();
  });

  it('reloads YouTube usage and the audit log after a grant', async () => {
    mockGrantYouTubeAccess.mockResolvedValue({
      data: { ...userWithPhone, youtubeAccess: true },
    });

    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText('Not granted · 7 of 25 places left'),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(mockListAuditLogs).toHaveBeenCalledTimes(1);
    });

    mockGetYouTubeAccessUsage.mockResolvedValue({
      data: { everGranted: 19, ceiling: 25 },
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Grant YouTube Access' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));

    await waitFor(() => {
      expect(
        screen.getByText('Granted · 6 of 25 places left'),
      ).toBeInTheDocument();
    });
    expect(mockGrantYouTubeAccess).toHaveBeenCalledWith({ userId: 'u-2' });
    expect(mockGetYouTubeAccessUsage).toHaveBeenCalledTimes(2);
    expect(mockListAuditLogs).toHaveBeenCalledTimes(2);
    expect(mockListAuditLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'u-2' }),
    );
  });
});

describe('UserDetailPageClient identity, activity, and layout', () => {
  beforeEach(() => {
    resetPageMocks();
  });

  it('shows the status, role, and YouTube Access pills for a granted user', async () => {
    (useParams as jest.Mock).mockReturnValue({ userId: 'u-1' });
    mockGetUserById.mockResolvedValue({
      data: { ...userWithoutPhone, youtubeAccess: true },
    });

    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Ada Lovelace' }),
      ).toBeInTheDocument();
    });

    const identity = screen.getByRole('region', { name: 'Identity' });
    expect(within(identity).getByText('Active')).toBeInTheDocument();
    expect(within(identity).getByText('Admin')).toBeInTheDocument();
    expect(within(identity).getByText('YouTube Access')).toBeInTheDocument();
  });

  it('shows the self-guard note only when the signed-in admin is the viewed User', async () => {
    (getCurrentUser as jest.Mock).mockReturnValue({ id: 'u-2' });

    const self = render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Grace Hopper' }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("You can't disable or demote yourself."),
    ).toBeInTheDocument();

    self.unmount();
    (getCurrentUser as jest.Mock).mockReturnValue({ id: 'someone-else' });

    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Grace Hopper' }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText("You can't disable or demote yourself."),
    ).not.toBeInTheDocument();
  });

  it('queries the audit log for this User and shows five of seven entries with a Full audit log link', async () => {
    mockListAuditLogs.mockResolvedValue({
      data: {
        entries: [1, 2, 3, 4, 5, 6, 7].map(createAuditEntry),
        total: 7,
        page: 1,
        pageSize: 25,
      },
    });

    render(<UserDetailPageClient />);

    const activity = await screen.findByRole('region', {
      name: 'Recent activity',
    });

    await waitFor(() => {
      expect(within(activity).getAllByRole('listitem')).toHaveLength(5);
    });
    expect(mockListAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-2' }),
    );
    expect(within(activity).getByText('Actor 5')).toBeInTheDocument();
    expect(within(activity).queryByText('Actor 6')).not.toBeInTheDocument();
    expect(
      within(activity).getByRole('link', { name: 'Full audit log' }),
    ).toHaveAttribute('href', '/admin/audit-logs');
  });

  it('shows the empty message when there is no activity, and the error message when the audit log fails', async () => {
    const empty = render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    });

    empty.unmount();
    mockListAuditLogs.mockRejectedValue(new Error('Network error'));

    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(screen.getByText(AUDIT_LOG_MESSAGES.error)).toBeInTheDocument();
    });
  });

  it('renders the Access and Sign-in groups and the Users back link on phone', async () => {
    (useIsMobileState as jest.Mock).mockReturnValue(true);

    render(<UserDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Grace Hopper' }),
      ).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'Access' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Sign-in' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute(
      'href',
      '/admin/users',
    );
  });
});

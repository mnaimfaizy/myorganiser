/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
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

import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRouter } from 'next/navigation';

import { createPlatformAdminApi } from '../lib/apiClient';

import { UserDirectoryPageClient } from './UserDirectoryPageClient';

const mockListUsers = jest.fn();
const mockPush = jest.fn();

const sampleUsers: AdminUserIdentity[] = [
  {
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
  },
  {
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
  },
];

const SENSITIVE_PATTERNS = [
  /vault/i,
  /youtube/i,
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

describe('UserDirectoryPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      listUsers: mockListUsers,
      getUserById: jest.fn(),
    });
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
      replace: jest.fn(),
    });
    mockListUsers.mockResolvedValue({
      data: {
        users: sampleUsers,
        total: sampleUsers.length,
        page: 1,
        pageSize: 25,
      },
    });
  });

  it('loads users on mount and renders identity columns', async () => {
    render(<UserDirectoryPageClient />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith({
        q: undefined,
        pageSize: 100,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    });
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('grace@example.com')).toBeInTheDocument();
    expect(screen.getByText('Platform Admin')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getAllByText('Yes')).toHaveLength(2);
    expect(screen.getAllByText('No')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'View' })).toHaveLength(2);
  });

  it('shows empty state when the API returns no users', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [], total: 0, page: 1, pageSize: 25 },
    });

    render(<UserDirectoryPageClient />);

    await waitFor(() => {
      expect(screen.getByText('No users found.')).toBeInTheDocument();
    });

    expect(mockListUsers).toHaveBeenCalledWith({ q: undefined, pageSize: 100 });
  });

  it('shows an error message when listUsers rejects', async () => {
    mockListUsers.mockRejectedValue(new Error('Network error'));

    render(<UserDirectoryPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText('Unable to load users. Please try again.'),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('submits search with a trimmed query', async () => {
    render(<UserDirectoryPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    });

    mockListUsers.mockClear();

    fireEvent.change(screen.getByLabelText('Search users'), {
      target: { value: '  grace  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith({ q: 'grace', pageSize: 100 });
    });
  });

  it('treats whitespace-only search as no query', async () => {
    render(<UserDirectoryPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Search users'), {
      target: { value: 'grace' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith({ q: 'grace', pageSize: 100 });
    });

    mockListUsers.mockClear();

    fireEvent.change(screen.getByLabelText('Search users'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith({
        q: undefined,
        pageSize: 100,
      });
    });
  });

  it('navigates to user detail when a table row is clicked', async () => {
    render(<UserDirectoryPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    });

    const row = screen.getByText('Grace Hopper').closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(row as HTMLTableRowElement);

    expect(mockPush).toHaveBeenCalledWith('/admin/users/u-2');
  });

  it('does not surface vault, YouTube, or secret operational fields', async () => {
    const secretFieldValues = [
      'SECRET_VAULT_BLOB',
      'ya29.secret-token',
      'should-never-appear',
      'mk-secret',
    ] as const;

    const bloatedUser = {
      ...sampleUsers[0],
      vaultCiphertext: 'SECRET_VAULT_BLOB',
      youtubeOAuthToken: 'ya29.secret-token',
      password: 'should-never-appear',
      masterKey: 'mk-secret',
    } as AdminUserIdentity;

    mockListUsers.mockResolvedValue({
      data: { users: [bloatedUser], total: 1, page: 1, pageSize: 25 },
    });

    const { container } = render(<UserDirectoryPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    });

    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Platform Admin')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();

    for (const secretValue of secretFieldValues) {
      expect(container.textContent).not.toContain(secretValue);
    }

    expectNoSensitiveContent(container);
  });
});

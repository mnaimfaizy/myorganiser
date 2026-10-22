/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

import type {
  AdminUserIdentity,
  AdminUserListResponse,
} from '@myorganiser/app-api-client';
import { act, renderHook, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { createPlatformAdminApi } from '../lib/apiClient';

import { useUserDirectory } from './use-user-directory';

const mockListUsers = jest.fn();

type ListResponse = { data: AdminUserListResponse };

function userFixture(id: string): AdminUserIdentity {
  return {
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    firstName: 'First',
    lastName: 'Last',
    role: 'user',
    disabled: false,
    emailVerified: true,
    youtubeAccess: false,
    createdAt: '2026-10-15T12:00:00.000Z',
  };
}

function usersRange(from: number, count: number): AdminUserIdentity[] {
  return Array.from({ length: count }, (_, index) =>
    userFixture(`u${from + index}`),
  );
}

function listResponse(users: AdminUserIdentity[], total: number): ListResponse {
  return { data: { users, total, page: 1, pageSize: 25 } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function lastListParams(): Record<string, unknown> {
  const calls = mockListUsers.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe('useUserDirectory', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      listUsers: mockListUsers,
    });
  });

  it('fetches the first page with default filters and exposes users and total', async () => {
    const users = usersRange(1, 3);
    mockListUsers.mockResolvedValue(listResponse(users, 30));

    const { result } = renderHook(() => useUserDirectory({ mode: 'pages' }));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockListUsers).toHaveBeenCalledTimes(1);
    expect(mockListUsers).toHaveBeenCalledWith({
      q: undefined,
      status: undefined,
      role: undefined,
      sort: 'newest',
      page: 1,
      pageSize: 25,
    });
    expect(result.current.users).toEqual(users);
    expect(result.current.total).toBe(30);
    expect(result.current.error).toBe(false);
  });

  it('resets to page 1 when the status filter changes', async () => {
    mockListUsers.mockImplementation(async () =>
      listResponse(usersRange(1, 2), 60),
    );

    const { result } = renderHook(() => useUserDirectory({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.goToPage(2);
    });
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.page).toBe(2);

    act(() => {
      result.current.setStatus('unverified');
    });
    await waitFor(() =>
      expect(lastListParams()).toEqual(
        expect.objectContaining({ status: 'unverified', page: 1 }),
      ),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.page).toBe(1);
    expect(result.current.status).toBe('unverified');
  });

  it('trims the query before sending it, and sends no q for a blank query', async () => {
    mockListUsers.mockResolvedValue(listResponse([], 0));

    const { result } = renderHook(() => useUserDirectory({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setQuery('  ada ');
    });
    await waitFor(() => expect(lastListParams().q).toBe('ada'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.query).toBe('ada');

    act(() => {
      result.current.setQuery('   ');
    });
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(3));
    expect(lastListParams().q).toBeUndefined();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.query).toBeUndefined();
  });

  it('makes no request and keeps the page when setStatus and setSort get their current values', async () => {
    mockListUsers.mockImplementation(async () =>
      listResponse(usersRange(1, 2), 60),
    );

    const { result } = renderHook(() => useUserDirectory({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.goToPage(2);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.page).toBe(2);

    const callsBefore = mockListUsers.mock.calls.length;

    act(() => {
      result.current.setStatus(undefined);
      result.current.setSort('newest');
    });

    expect(result.current.page).toBe(2);
    expect(mockListUsers).toHaveBeenCalledTimes(callsBefore);
  });

  it('sends role and clears status when setFilters sets a role only', async () => {
    mockListUsers.mockResolvedValue(listResponse([], 0));

    const { result } = renderHook(() => useUserDirectory({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setFilters({ role: 'platform_admin' });
    });

    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2));
    expect(lastListParams()).toEqual(
      expect.objectContaining({ role: 'platform_admin', status: undefined }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.role).toBe('platform_admin');
    expect(result.current.status).toBeUndefined();
  });

  it('replaces the users with the requested page in pages mode', async () => {
    const page1 = usersRange(1, 25);
    const page2 = usersRange(26, 5);
    mockListUsers.mockImplementation(async (params: { page: number }) =>
      listResponse(params.page === 2 ? page2 : page1, 30),
    );

    const { result } = renderHook(() => useUserDirectory({ mode: 'pages' }));
    await waitFor(() => expect(result.current.users).toEqual(page1));

    act(() => {
      result.current.goToPage(2);
    });

    await waitFor(() => expect(result.current.users).toEqual(page2));
    expect(result.current.loading).toBe(false);
    expect(result.current.page).toBe(2);
  });

  it('appends the next page in append mode and stops once every row is loaded', async () => {
    const page1 = usersRange(1, 25);
    const page2 = usersRange(26, 5);
    const secondPage = deferred<ListResponse>();
    mockListUsers.mockImplementation((params: { page: number }) =>
      params.page === 2
        ? secondPage.promise
        : Promise.resolve(listResponse(page1, 30)),
    );

    const { result } = renderHook(() => useUserDirectory({ mode: 'append' }));
    await waitFor(() => expect(result.current.users).toEqual(page1));
    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    expect(result.current.loading).toBe(false);

    await act(async () => {
      secondPage.resolve(listResponse(page2, 30));
    });

    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(result.current.users).toEqual([...page1, ...page2]);
    expect(result.current.hasMore).toBe(false);

    act(() => {
      result.current.loadMore();
    });
    expect(mockListUsers).toHaveBeenCalledTimes(2);
  });

  it('sets error, clears users, and stops loading when the request rejects', async () => {
    mockListUsers.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useUserDirectory({ mode: 'pages' }));

    await waitFor(() => expect(result.current.error).toBe(true));

    expect(result.current.users).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('keeps the newest filter result when an older response arrives last', async () => {
    const initial = deferred<ListResponse>();
    const unverified = deferred<ListResponse>();
    const unverifiedUsers = usersRange(100, 2);
    mockListUsers.mockImplementation((params: { status?: string }) =>
      params.status === 'unverified' ? unverified.promise : initial.promise,
    );

    const { result } = renderHook(() => useUserDirectory({ mode: 'pages' }));
    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.setStatus('unverified');
    });

    await act(async () => {
      unverified.resolve(listResponse(unverifiedUsers, 2));
    });
    await waitFor(() => expect(result.current.users).toEqual(unverifiedUsers));

    await act(async () => {
      initial.resolve(listResponse(usersRange(1, 25), 30));
    });

    expect(result.current.users).toEqual(unverifiedUsers);
    expect(result.current.total).toBe(2);
    expect(result.current.status).toBe('unverified');
    expect(result.current.loading).toBe(false);
  });

  it('ignores loadMore while the next page is still pending', async () => {
    const page1 = usersRange(1, 25);
    const secondPage = deferred<ListResponse>();
    mockListUsers.mockImplementation((params: { page: number }) =>
      params.page === 2
        ? secondPage.promise
        : Promise.resolve(listResponse(page1, 30)),
    );

    const { result } = renderHook(() => useUserDirectory({ mode: 'append' }));
    await waitFor(() => expect(result.current.users).toEqual(page1));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(true));

    const callsBefore = mockListUsers.mock.calls.length;

    act(() => {
      result.current.loadMore();
    });

    expect(mockListUsers).toHaveBeenCalledTimes(callsBefore);

    await act(async () => {
      secondPage.resolve(listResponse(usersRange(26, 5), 30));
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
  });

  it('clamps goToPage(0) to page 1 and floors a fractional page', async () => {
    mockListUsers.mockImplementation(async () =>
      listResponse(usersRange(1, 2), 60),
    );

    const { result } = renderHook(() => useUserDirectory({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.goToPage(2);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(lastListParams().page).toBe(2);

    act(() => {
      result.current.goToPage(0);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(lastListParams().page).toBe(1);
    expect(result.current.page).toBe(1);

    act(() => {
      result.current.goToPage(2.7);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(lastListParams().page).toBe(2);
    expect(result.current.page).toBe(2);
  });

  it('keeps the loaded rows and flags a failed append while loadMoreError is set, and makes loadMore a no-op', async () => {
    const page1 = usersRange(1, 25);
    mockListUsers.mockImplementation((params: { page: number }) =>
      params.page === 2
        ? Promise.reject(new Error('network down'))
        : Promise.resolve(listResponse(page1, 60)),
    );

    const { result } = renderHook(() => useUserDirectory({ mode: 'append' }));
    await waitFor(() => expect(result.current.users).toEqual(page1));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadMoreError).toBe(true));

    expect(result.current.users).toEqual(page1);
    expect(result.current.total).toBe(60);
    expect(result.current.error).toBe(false);
    expect(result.current.loadingMore).toBe(false);

    const callsBefore = mockListUsers.mock.calls.length;

    act(() => {
      result.current.loadMore();
    });

    expect(mockListUsers).toHaveBeenCalledTimes(callsBefore);
  });

  it('clears loadMoreError and replaces the list when a filter change resolves', async () => {
    const page1 = usersRange(1, 25);
    const active = usersRange(200, 3);
    mockListUsers.mockImplementation(
      (params: { page: number; status?: string }) => {
        if (params.page === 2) return Promise.reject(new Error('network down'));
        if (params.status === 'active')
          return Promise.resolve(listResponse(active, 3));
        return Promise.resolve(listResponse(page1, 30));
      },
    );

    const { result } = renderHook(() => useUserDirectory({ mode: 'append' }));
    await waitFor(() => expect(result.current.users).toEqual(page1));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadMoreError).toBe(true));

    act(() => {
      result.current.setStatus('active');
    });

    await waitFor(() => expect(result.current.users).toEqual(active));
    expect(result.current.loadMoreError).toBe(false);
    expect(result.current.status).toBe('active');
    expect(result.current.total).toBe(3);
    expect(result.current.loading).toBe(false);
  });
});

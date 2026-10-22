/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

import type {
  AdminAuditLogEntry,
  AdminAuditLogListResponse,
} from '@myorganiser/app-api-client';
import { act, renderHook, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { createPlatformAdminApi } from '../lib/apiClient';

import { useAuditLog } from './use-audit-log';

const mockListAuditLogs = jest.fn();

type ListResponse = { data: AdminAuditLogListResponse };

function entryFixture(id: string): AdminAuditLogEntry {
  return {
    id,
    actorUserId: 'admin-1',
    targetUserId: 'u1',
    actorName: 'Admin',
    targetName: 'User u1',
    actorDeleted: false,
    targetDeleted: false,
    action: 'enable',
    createdAt: '2026-10-15T12:00:00.000Z',
  };
}

function entriesRange(from: number, count: number): AdminAuditLogEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entryFixture(`e${from + index}`),
  );
}

function listResponse(
  entries: AdminAuditLogEntry[],
  total: number,
): ListResponse {
  return { data: { entries, total, page: 1, pageSize: 25 } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function lastListParams(): Record<string, unknown> {
  const calls = mockListAuditLogs.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe('useAuditLog', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      listAuditLogs: mockListAuditLogs,
    });
  });

  it('fetches the first page with no filters and exposes entries and total', async () => {
    const entries = entriesRange(1, 3);
    mockListAuditLogs.mockResolvedValue(listResponse(entries, 30));

    const { result } = renderHook(() => useAuditLog({ mode: 'pages' }));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockListAuditLogs).toHaveBeenCalledTimes(1);
    expect(mockListAuditLogs).toHaveBeenCalledWith({
      userId: undefined,
      action: undefined,
      page: 1,
      pageSize: 25,
    });
    expect(result.current.entries).toEqual(entries);
    expect(result.current.total).toBe(30);
    expect(result.current.filtered).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('keeps selected actions in table order when toggled on, and sends them as the action filter', async () => {
    mockListAuditLogs.mockResolvedValue(listResponse([], 0));

    const { result } = renderHook(() => useAuditLog({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.toggleAction('enable');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.toggleAction('disable');
    });
    await waitFor(() =>
      expect(lastListParams()).toEqual(
        expect.objectContaining({ action: ['disable', 'enable'], page: 1 }),
      ),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.actions).toEqual(['disable', 'enable']);
    expect(result.current.filtered).toBe(true);
  });

  it('removes an action when it is toggled off, and sends no action filter once none is left', async () => {
    mockListAuditLogs.mockResolvedValue(listResponse([], 0));

    const { result } = renderHook(() => useAuditLog({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.toggleAction('enable');
    });
    await waitFor(() => expect(lastListParams().action).toEqual(['enable']));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.toggleAction('enable');
    });
    await waitFor(() => expect(lastListParams().action).toBeUndefined());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.actions).toEqual([]);
    expect(result.current.filtered).toBe(false);
  });

  it('makes no request when setActions gets the same selection in another order', async () => {
    mockListAuditLogs.mockResolvedValue(listResponse([], 0));

    const { result } = renderHook(() => useAuditLog({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setActions(['enable', 'disable']);
    });
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.actions).toEqual(['disable', 'enable']);

    const callsBefore = mockListAuditLogs.mock.calls.length;

    act(() => {
      result.current.setActions(['disable', 'enable']);
    });

    expect(mockListAuditLogs).toHaveBeenCalledTimes(callsBefore);
  });

  it('resets to page 1 when the action filter changes', async () => {
    mockListAuditLogs.mockImplementation(async () =>
      listResponse(entriesRange(1, 2), 100),
    );

    const { result } = renderHook(() => useAuditLog({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.goToPage(3);
    });
    await waitFor(() => expect(lastListParams().page).toBe(3));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.toggleAction('enable');
    });
    await waitFor(() =>
      expect(lastListParams()).toEqual(
        expect.objectContaining({ action: ['enable'], page: 1 }),
      ),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.page).toBe(1);
  });

  it('sets the user filter, sends its id, and makes no request for the same id again', async () => {
    mockListAuditLogs.mockResolvedValue(listResponse([], 0));

    const { result } = renderHook(() => useAuditLog({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setUser({ id: 'u1', name: 'Ana' });
    });
    await waitFor(() => expect(lastListParams().userId).toBe('u1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toEqual({ id: 'u1', name: 'Ana' });
    expect(result.current.filtered).toBe(true);

    const callsBefore = mockListAuditLogs.mock.calls.length;

    act(() => {
      result.current.setUser({ id: 'u1', name: 'Ana' });
    });

    expect(mockListAuditLogs).toHaveBeenCalledTimes(callsBefore);
  });

  it('clears both filters and resets the page on clearFilters, and makes no request when nothing is set', async () => {
    mockListAuditLogs.mockResolvedValue(listResponse([], 0));

    const { result } = renderHook(() => useAuditLog({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.toggleAction('enable');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.setUser({ id: 'u1', name: 'Ana' });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.goToPage(3);
    });
    await waitFor(() => expect(lastListParams().page).toBe(3));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.clearFilters();
    });
    await waitFor(() =>
      expect(lastListParams()).toEqual(
        expect.objectContaining({
          userId: undefined,
          action: undefined,
          page: 1,
        }),
      ),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.page).toBe(1);
    expect(result.current.actions).toEqual([]);
    expect(result.current.user).toBeUndefined();
    expect(result.current.filtered).toBe(false);

    const callsBefore = mockListAuditLogs.mock.calls.length;

    act(() => {
      result.current.clearFilters();
    });

    expect(mockListAuditLogs).toHaveBeenCalledTimes(callsBefore);
  });

  it('locks every request to a fixed userId, ignores setUser, and clears only the action in clearFilters', async () => {
    mockListAuditLogs.mockResolvedValue(listResponse([], 0));

    const { result } = renderHook(() =>
      useAuditLog({ mode: 'pages', userId: 'u9' }),
    );

    expect(result.current.filtered).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(lastListParams().userId).toBe('u9');

    const callsBeforeSetUser = mockListAuditLogs.mock.calls.length;

    act(() => {
      result.current.setUser({ id: 'u1', name: 'Ana' });
    });

    expect(mockListAuditLogs).toHaveBeenCalledTimes(callsBeforeSetUser);
    expect(result.current.user).toBeUndefined();

    act(() => {
      result.current.toggleAction('enable');
    });
    await waitFor(() => expect(lastListParams().action).toEqual(['enable']));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.clearFilters();
    });
    await waitFor(() => expect(lastListParams().action).toBeUndefined());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(lastListParams().userId).toBe('u9');
    expect(result.current.actions).toEqual([]);
    expect(result.current.user).toBeUndefined();
    expect(result.current.filtered).toBe(true);
  });

  it('replaces the entries with the requested page in pages mode', async () => {
    const page1 = entriesRange(1, 25);
    const page2 = entriesRange(26, 5);
    mockListAuditLogs.mockImplementation(async (params: { page: number }) =>
      listResponse(params.page === 2 ? page2 : page1, 30),
    );

    const { result } = renderHook(() => useAuditLog({ mode: 'pages' }));
    await waitFor(() => expect(result.current.entries).toEqual(page1));

    act(() => {
      result.current.goToPage(2);
    });

    await waitFor(() => expect(result.current.entries).toEqual(page2));
    expect(result.current.loading).toBe(false);
    expect(result.current.page).toBe(2);
  });

  it('clamps goToPage to at least page 1 and floors a fractional page', async () => {
    mockListAuditLogs.mockImplementation(async () =>
      listResponse(entriesRange(1, 2), 100),
    );

    const { result } = renderHook(() => useAuditLog({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.goToPage(3);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(lastListParams().page).toBe(3);

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

  it('appends each page in append mode, stops when every row is loaded, and ignores loadMore while a page is pending', async () => {
    const page1 = entriesRange(1, 25);
    const page2 = entriesRange(26, 5);
    const secondPage = deferred<ListResponse>();
    mockListAuditLogs.mockImplementation((params: { page: number }) =>
      params.page === 2
        ? secondPage.promise
        : Promise.resolve(listResponse(page1, 30)),
    );

    const { result } = renderHook(() => useAuditLog({ mode: 'append' }));
    await waitFor(() => expect(result.current.entries).toEqual(page1));
    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    expect(result.current.loading).toBe(false);

    const callsWhilePending = mockListAuditLogs.mock.calls.length;

    act(() => {
      result.current.loadMore();
    });
    expect(mockListAuditLogs).toHaveBeenCalledTimes(callsWhilePending);

    await act(async () => {
      secondPage.resolve(listResponse(page2, 30));
    });

    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(result.current.entries).toEqual([...page1, ...page2]);
    expect(result.current.hasMore).toBe(false);

    const callsBeforeExhausted = mockListAuditLogs.mock.calls.length;

    act(() => {
      result.current.loadMore();
    });
    expect(mockListAuditLogs).toHaveBeenCalledTimes(callsBeforeExhausted);
  });

  it('sets error, clears entries and total, and stops loading when the first request rejects', async () => {
    mockListAuditLogs.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useAuditLog({ mode: 'pages' }));

    await waitFor(() => expect(result.current.error).toBe(true));

    expect(result.current.entries).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it('keeps the loaded rows and sets loadMoreError when an append fails, then clears it on a filter change', async () => {
    const page1 = entriesRange(1, 25);
    const filtered = entriesRange(200, 3);
    mockListAuditLogs.mockImplementation(
      (params: { page: number; action?: unknown }) => {
        if (params.page === 2) return Promise.reject(new Error('network down'));
        if (params.action !== undefined)
          return Promise.resolve(listResponse(filtered, 3));
        return Promise.resolve(listResponse(page1, 60));
      },
    );

    const { result } = renderHook(() => useAuditLog({ mode: 'append' }));
    await waitFor(() => expect(result.current.entries).toEqual(page1));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadMoreError).toBe(true));

    expect(result.current.entries).toEqual(page1);
    expect(result.current.total).toBe(60);
    expect(result.current.error).toBe(false);
    expect(result.current.loadingMore).toBe(false);

    const callsBefore = mockListAuditLogs.mock.calls.length;

    act(() => {
      result.current.loadMore();
    });
    expect(mockListAuditLogs).toHaveBeenCalledTimes(callsBefore);

    act(() => {
      result.current.toggleAction('enable');
    });

    await waitFor(() => expect(result.current.entries).toEqual(filtered));
    expect(result.current.loadMoreError).toBe(false);
    expect(result.current.total).toBe(3);
    expect(result.current.loading).toBe(false);
  });

  it('keeps the newest filter result when an older unfiltered response arrives last', async () => {
    const initial = deferred<ListResponse>();
    const enabled = deferred<ListResponse>();
    const enabledEntries = entriesRange(100, 2);
    mockListAuditLogs.mockImplementation((params: { action?: unknown }) =>
      params.action !== undefined ? enabled.promise : initial.promise,
    );

    const { result } = renderHook(() => useAuditLog({ mode: 'pages' }));
    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.toggleAction('enable');
    });

    await act(async () => {
      enabled.resolve(listResponse(enabledEntries, 2));
    });
    await waitFor(() => expect(result.current.entries).toEqual(enabledEntries));

    await act(async () => {
      initial.resolve(listResponse(entriesRange(1, 25), 30));
    });

    expect(result.current.entries).toEqual(enabledEntries);
    expect(result.current.total).toBe(2);
    expect(result.current.actions).toEqual(['enable']);
    expect(result.current.loading).toBe(false);
  });
});

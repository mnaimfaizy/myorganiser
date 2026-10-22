/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

import type {
  AdminFeedbackReportListItemDto,
  AdminFeedbackReportListResponse,
} from '@myorganiser/app-api-client';
import { act, renderHook, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { createPlatformAdminApi } from '../lib/apiClient';
import {
  type FeedbackInboxFilters,
  NO_FEEDBACK_INBOX_FILTERS,
} from '../lib/feedbackInbox';

import { type FeedbackInboxMode, useFeedbackInbox } from './use-feedback-inbox';

const mockListFeedbackReports = jest.fn();

type ListParams = {
  status?: string;
  kind?: string;
  platform?: string;
  trackingIssueNumber?: number;
  page?: number;
  pageSize?: number;
};
type ListResponse = { data: AdminFeedbackReportListResponse };
type ListHandler = (params: ListParams) => Promise<ListResponse>;

function reportFixture(id: string): AdminFeedbackReportListItemDto {
  return {
    id,
    kind: 'bug_report',
    status: 'received',
    title: `Report ${id}`,
    platform: 'web',
    trackingIssueNumber: null,
    reporterUserId: null,
    reporter: null,
    statusChangedAt: null,
    createdAt: '2026-10-15T12:00:00.000Z',
  };
}

function reportsRange(from: number, count: number) {
  return Array.from({ length: count }, (_, index) =>
    reportFixture(`r${from + index}`),
  );
}

function listResponse(
  items: AdminFeedbackReportListItemDto[],
  total: number,
): ListResponse {
  return { data: { items, total, page: 1, pageSize: 25 } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

/** Routes the Received count request (pageSize 1) apart from the list requests. */
function routeRequests(list: ListHandler, receivedTotal = 5) {
  mockListFeedbackReports.mockImplementation((params: ListParams) =>
    params.pageSize === 1
      ? Promise.resolve(listResponse([], receivedTotal))
      : list(params),
  );
}

function listRequests(): ListParams[] {
  return mockListFeedbackReports.mock.calls
    .map((call) => call[0] as ListParams)
    .filter((params) => params.pageSize === 25);
}

function countRequests(): ListParams[] {
  return mockListFeedbackReports.mock.calls
    .map((call) => call[0] as ListParams)
    .filter((params) => params.pageSize === 1);
}

function lastListRequest(): ListParams {
  const requests = listRequests();
  return requests[requests.length - 1];
}

describe('useFeedbackInbox', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      listFeedbackReports: mockListFeedbackReports,
    });
    routeRequests(() => Promise.resolve(listResponse([], 0)));
  });

  it('requests the first page with no filters and reports loading until it settles', async () => {
    routeRequests(() => Promise.resolve(listResponse(reportsRange(1, 3), 3)));

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listRequests()).toEqual([{ page: 1, pageSize: 25 }]);
  });

  it('exposes the reports and total from the response envelope', async () => {
    const rows = reportsRange(1, 3);
    routeRequests(() => Promise.resolve(listResponse(rows, 30)));

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.reports).toEqual(rows);
    expect(result.current.total).toBe(30);
    expect(result.current.page).toBe(1);
    expect(result.current.filtered).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('requests the Received count once, with status received and pageSize 1, and exposes its total', async () => {
    routeRequests(() => Promise.resolve(listResponse([], 0)), 7);

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));

    await waitFor(() => expect(result.current.receivedCount).toBe(7));
    expect(countRequests()).toEqual([{ status: 'received', pageSize: 1 }]);

    act(() => {
      result.current.setFilters({ kind: 'suggestion' });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(countRequests()).toHaveLength(1);
    expect(result.current.receivedCount).toBe(7);
  });

  it('leaves receivedCount undefined when the Received count request fails, and keeps the list', async () => {
    const rows = reportsRange(1, 2);
    mockListFeedbackReports.mockImplementation((params: ListParams) =>
      params.pageSize === 1
        ? Promise.reject(new Error('count down'))
        : Promise.resolve(listResponse(rows, 2)),
    );

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));

    await waitFor(() => expect(countRequests()).toHaveLength(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.receivedCount).toBeUndefined();
    expect(result.current.reports).toEqual(rows);
    expect(result.current.error).toBe(false);
  });

  it.each<[string, Partial<FeedbackInboxFilters>]>([
    ['status', { status: 'planned' }],
    ['kind', { kind: 'suggestion' }],
    ['platform', { platform: 'ios' }],
  ])(
    'sends a %s filter change in the next request and resets to page 1',
    async (_label, filter) => {
      routeRequests(() =>
        Promise.resolve(listResponse(reportsRange(1, 2), 60)),
      );

      const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.goToPage(2);
      });
      await waitFor(() => expect(lastListRequest().page).toBe(2));
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setFilters(filter);
      });
      await waitFor(() =>
        expect(lastListRequest()).toEqual(
          expect.objectContaining({ ...filter, page: 1 }),
        ),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.page).toBe(1);
      expect(result.current.filtered).toBe(true);
    },
  );

  it('makes no new list request when a filter is set to the value it already has', async () => {
    routeRequests(() => Promise.resolve(listResponse([], 0)));

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setFilters({ status: 'planned' });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const requestsBefore = listRequests().length;

    act(() => {
      result.current.setFilters({ status: 'planned' });
    });

    expect(listRequests()).toHaveLength(requestsBefore);
  });

  it('sends a valid tracking issue number as trackingIssueNumber', async () => {
    routeRequests(() => Promise.resolve(listResponse([], 0)));

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setFilters({ trackingIssue: '42' });
    });
    await waitFor(() => expect(lastListRequest().trackingIssueNumber).toBe(42));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.filters.trackingIssue).toBe('42');
    expect(result.current.filtered).toBe(true);
  });

  it('makes no new list request for tracking issue text that is not a number, but keeps the typed text', async () => {
    routeRequests(() => Promise.resolve(listResponse([], 0)));

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const requestsBefore = listRequests().length;

    act(() => {
      result.current.setFilters({ trackingIssue: 'abc' });
    });

    expect(listRequests()).toHaveLength(requestsBefore);
    expect(result.current.filters.trackingIssue).toBe('abc');
    expect(result.current.filtered).toBe(false);
  });

  it('clears every filter and refetches the unfiltered first page on clearFilters', async () => {
    routeRequests(() => Promise.resolve(listResponse([], 0)));

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setFilters({
        status: 'planned',
        kind: 'bug_report',
        platform: 'android',
        trackingIssue: '42',
      });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.filtered).toBe(true);

    act(() => {
      result.current.clearFilters();
    });
    await waitFor(() =>
      expect(lastListRequest()).toEqual({ page: 1, pageSize: 25 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.filters).toEqual(NO_FEEDBACK_INBOX_FILTERS);
    expect(result.current.filtered).toBe(false);
    expect(result.current.page).toBe(1);
  });

  it('requests the chosen page in pages mode and replaces the rows, with hasMore from page × 25 against total', async () => {
    const page1 = reportsRange(1, 25);
    const page2 = reportsRange(26, 5);
    routeRequests(async (params) =>
      listResponse(params.page === 2 ? page2 : page1, 30),
    );

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));
    await waitFor(() => expect(result.current.reports).toEqual(page1));
    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.goToPage(2);
    });

    await waitFor(() => expect(result.current.reports).toEqual(page2));
    expect(lastListRequest().page).toBe(2);
    expect(result.current.page).toBe(2);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasMore).toBe(false);
  });

  it('appends the next page to the loaded rows in append mode, and shows loadingMore instead of loading while it runs', async () => {
    const page1 = reportsRange(1, 25);
    const page2 = reportsRange(26, 5);
    const secondPage = deferred<ListResponse>();
    routeRequests((params) =>
      params.page === 2
        ? secondPage.promise
        : Promise.resolve(listResponse(page1, 30)),
    );

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'append' }));
    await waitFor(() => expect(result.current.reports).toEqual(page1));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    expect(result.current.loading).toBe(false);

    await act(async () => {
      secondPage.resolve(listResponse(page2, 30));
    });

    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(result.current.reports).toEqual([...page1, ...page2]);
    expect(result.current.hasMore).toBe(false);
  });

  it('makes no request from loadMore once every row is loaded', async () => {
    routeRequests(() => Promise.resolve(listResponse(reportsRange(1, 3), 3)));

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'append' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(false);

    const requestsBefore = listRequests().length;

    act(() => {
      result.current.loadMore();
    });

    expect(listRequests()).toHaveLength(requestsBefore);
  });

  it('keeps the loaded rows and sets loadMoreError when an append fails, and holds loadMore until a filter change', async () => {
    const page1 = reportsRange(1, 25);
    const filteredRows = reportsRange(200, 3);
    routeRequests((params) => {
      if (params.page === 2) return Promise.reject(new Error('network down'));
      if (params.status !== undefined)
        return Promise.resolve(listResponse(filteredRows, 3));
      return Promise.resolve(listResponse(page1, 60));
    });

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'append' }));
    await waitFor(() => expect(result.current.reports).toEqual(page1));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadMoreError).toBe(true));

    expect(result.current.reports).toEqual(page1);
    expect(result.current.total).toBe(60);
    expect(result.current.error).toBe(false);
    expect(result.current.loadingMore).toBe(false);

    const requestsBefore = listRequests().length;

    act(() => {
      result.current.loadMore();
    });
    expect(listRequests()).toHaveLength(requestsBefore);

    act(() => {
      result.current.setFilters({ status: 'planned' });
    });

    await waitFor(() => expect(result.current.reports).toEqual(filteredRows));
    expect(result.current.loadMoreError).toBe(false);
    expect(result.current.total).toBe(3);
  });

  it('sets error, clears the rows and total, and stops loading when the first request fails', async () => {
    routeRequests(() => Promise.reject(new Error('network down')));

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));

    await waitFor(() => expect(result.current.error).toBe(true));

    expect(result.current.reports).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.loadMoreError).toBe(false);
  });

  it('keeps the newest filter result when an older unfiltered response arrives last', async () => {
    const initial = deferred<ListResponse>();
    const planned = deferred<ListResponse>();
    const plannedRows = reportsRange(100, 2);
    routeRequests((params) =>
      params.status === 'planned' ? planned.promise : initial.promise,
    );

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));
    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.setFilters({ status: 'planned' });
    });

    await act(async () => {
      planned.resolve(listResponse(plannedRows, 2));
    });
    await waitFor(() => expect(result.current.reports).toEqual(plannedRows));

    await act(async () => {
      initial.resolve(listResponse(reportsRange(1, 25), 30));
    });

    expect(result.current.reports).toEqual(plannedRows);
    expect(result.current.total).toBe(2);
    expect(result.current.filters.status).toBe('planned');
    expect(result.current.loading).toBe(false);
  });

  it('ignores a second loadMore while the next page is still pending', async () => {
    const page1 = reportsRange(1, 25);
    const secondPage = deferred<ListResponse>();
    routeRequests((params) =>
      params.page === 2
        ? secondPage.promise
        : Promise.resolve(listResponse(page1, 60)),
    );

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'append' }));
    await waitFor(() => expect(result.current.reports).toEqual(page1));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(true));

    act(() => {
      result.current.loadMore();
    });

    expect(listRequests().map((params) => params.page)).toEqual([1, 2]);

    await act(async () => {
      secondPage.resolve(listResponse(reportsRange(26, 25), 60));
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
  });

  it.each<[number, number]>([
    [0, 1],
    [2.7, 2],
  ])('clamps goToPage(%p) to page %p', async (requested, expected) => {
    routeRequests(() => Promise.resolve(listResponse(reportsRange(1, 2), 100)));

    const { result } = renderHook(() => useFeedbackInbox({ mode: 'pages' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.goToPage(3);
    });
    await waitFor(() => expect(lastListRequest().page).toBe(3));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.goToPage(requested);
    });
    await waitFor(() => expect(lastListRequest().page).toBe(expected));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.page).toBe(expected);
  });

  it('resets to page 1 after a mode switch and requests page 1', async () => {
    routeRequests(() => Promise.resolve(listResponse(reportsRange(1, 2), 60)));

    const { result, rerender } = renderHook(
      ({ mode }: { mode: FeedbackInboxMode }) => useFeedbackInbox({ mode }),
      { initialProps: { mode: 'pages' as FeedbackInboxMode } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.goToPage(2);
    });
    await waitFor(() => expect(lastListRequest().page).toBe(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ mode: 'append' });
    await waitFor(() => expect(lastListRequest().page).toBe(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.page).toBe(1);
  });
});

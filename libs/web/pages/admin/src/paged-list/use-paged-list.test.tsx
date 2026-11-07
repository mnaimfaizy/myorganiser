import { useState } from 'react';

import { act, renderHook, waitFor } from '@testing-library/react';

import {
  type PagedListMode,
  type PagedListPage,
  usePagedList,
} from './use-paged-list';

interface Row {
  id: string;
}

type Page = PagedListPage<Row>;

const PAGE_SIZE = 2;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function rows(from: number, count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `r${from + index}`,
  }));
}

/** The page of rows that page `page` holds when every page is PAGE_SIZE long. */
function pageOf(page: number, total: number): Page {
  return { rows: rows((page - 1) * PAGE_SIZE + 1, PAGE_SIZE), total };
}

interface ListProps {
  mode: PagedListMode;
  filterKey: string;
  fetchPage: (page: number) => Promise<Page>;
}

function renderList(initialProps: ListProps) {
  return renderHook(
    (props: ListProps) => usePagedList<Row>({ pageSize: PAGE_SIZE, ...props }),
    { initialProps },
  );
}

/**
 * A filter change and its reset land in one render, as they do when a filter
 * control calls both in one event handler.
 */
function renderFiltered(
  fetchFor: (filter: string, page: number) => Promise<Page>,
) {
  return renderHook(() => {
    const [filterKey, setFilterKey] = useState('all');
    const list = usePagedList<Row>({
      mode: 'pages',
      pageSize: PAGE_SIZE,
      filterKey,
      fetchPage: (page) => fetchFor(filterKey, page),
    });
    const changeFilter = (next: string) => {
      setFilterKey(next);
      list.resetToFirstPage();
    };
    return { ...list, changeFilter };
  });
}

describe('usePagedList', () => {
  it('loads page 1 in pages mode, then exposes its rows, total, and hasMore', async () => {
    const first = deferred<Page>();
    const fetchPage = jest.fn((_page: number) => first.promise);

    const { result } = renderList({
      mode: 'pages',
      filterKey: 'all',
      fetchPage,
    });

    expect(result.current).toEqual(
      expect.objectContaining({
        loading: true,
        loadingMore: false,
        rows: [],
        total: 0,
        page: 1,
      }),
    );

    await act(async () => {
      first.resolve(pageOf(1, 5));
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(1);
    expect(result.current).toEqual(
      expect.objectContaining({
        loading: false,
        rows: rows(1, PAGE_SIZE),
        total: 5,
        hasMore: true,
        error: false,
      }),
    );
  });

  it('replaces the rows on goToPage, clamps goToPage(0) to page 1, and floors a fractional page', async () => {
    const fetchPage = jest.fn((page: number) =>
      Promise.resolve(pageOf(page, 5)),
    );

    const { result } = renderList({
      mode: 'pages',
      filterKey: 'all',
      fetchPage,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.goToPage(2);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual(rows(3, PAGE_SIZE));
    expect(result.current.page).toBe(2);

    act(() => {
      result.current.goToPage(0);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchPage).toHaveBeenLastCalledWith(1);
    expect(result.current.page).toBe(1);
    expect(result.current.rows).toEqual(rows(1, PAGE_SIZE));

    act(() => {
      result.current.goToPage(2.7);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchPage).toHaveBeenLastCalledWith(2);
    expect(result.current.page).toBe(2);
  });

  it('appends the next page in append mode, with loadingMore set and loading clear', async () => {
    const second = deferred<Page>();
    const fetchPage = jest.fn((page: number) =>
      page === 2 ? second.promise : Promise.resolve(pageOf(1, 4)),
    );

    const { result } = renderList({
      mode: 'append',
      filterKey: 'all',
      fetchPage,
    });
    await waitFor(() =>
      expect(result.current.rows).toEqual(rows(1, PAGE_SIZE)),
    );

    act(() => {
      result.current.loadMore();
    });

    expect(fetchPage).toHaveBeenLastCalledWith(2);
    expect(result.current.loadingMore).toBe(true);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      second.resolve(pageOf(2, 4));
    });

    expect(result.current.loadingMore).toBe(false);
    expect(result.current.rows).toEqual([...rows(1, 2), ...rows(3, 2)]);
    expect(result.current.hasMore).toBe(false);
  });

  it('makes loadMore a no-op when there is nothing more to append', async () => {
    const fetchPage = jest.fn((_page: number) => Promise.resolve(pageOf(1, 2)));

    const { result } = renderList({
      mode: 'append',
      filterKey: 'all',
      fetchPage,
    });
    await waitFor(() =>
      expect(result.current.rows).toEqual(rows(1, PAGE_SIZE)),
    );
    expect(result.current.hasMore).toBe(false);

    act(() => {
      result.current.loadMore();
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.current.loadingMore).toBe(false);
  });

  it('retryLoadMore is a no-op without a load-more error', async () => {
    const fetchPage = jest.fn((_page: number) => Promise.resolve(pageOf(1, 2)));

    const { result } = renderList({
      mode: 'append',
      filterKey: 'all',
      fetchPage,
    });
    await waitFor(() =>
      expect(result.current.rows).toEqual(rows(1, PAGE_SIZE)),
    );
    expect(result.current.loadMoreError).toBe(false);

    act(() => {
      result.current.retryLoadMore();
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.current.loadingMore).toBe(false);
  });

  it('ignores loadMore while the next page is still pending', async () => {
    const second = deferred<Page>();
    const fetchPage = jest.fn((page: number) =>
      page === 2 ? second.promise : Promise.resolve(pageOf(1, 6)),
    );

    const { result } = renderList({
      mode: 'append',
      filterKey: 'all',
      fetchPage,
    });
    await waitFor(() =>
      expect(result.current.rows).toEqual(rows(1, PAGE_SIZE)),
    );

    act(() => {
      result.current.loadMore();
    });
    expect(result.current.loadingMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(pageOf(2, 6));
    });
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.rows).toEqual(rows(1, 4));
  });

  it('keeps the loaded rows and total on a failed append, flags loadMoreError, and holds loadMore', async () => {
    const fetchPage = jest.fn((page: number) =>
      page === 2
        ? Promise.reject(new Error('network down'))
        : Promise.resolve(pageOf(1, 6)),
    );

    const { result } = renderList({
      mode: 'append',
      filterKey: 'all',
      fetchPage,
    });
    await waitFor(() =>
      expect(result.current.rows).toEqual(rows(1, PAGE_SIZE)),
    );

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadMoreError).toBe(true));

    expect(result.current.rows).toEqual(rows(1, PAGE_SIZE));
    expect(result.current.total).toBe(6);
    expect(result.current.error).toBe(false);
    expect(result.current.loadingMore).toBe(false);

    act(() => {
      result.current.loadMore();
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('retryLoadMore re-requests the failed page, and appends its rows on success', async () => {
    let page2Attempts = 0;
    const fetchPage = jest.fn((page: number) => {
      if (page !== 2) return Promise.resolve(pageOf(1, 6));
      page2Attempts += 1;
      return page2Attempts === 1
        ? Promise.reject(new Error('network down'))
        : Promise.resolve(pageOf(2, 6));
    });

    const { result } = renderList({
      mode: 'append',
      filterKey: 'all',
      fetchPage,
    });
    await waitFor(() =>
      expect(result.current.rows).toEqual(rows(1, PAGE_SIZE)),
    );

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadMoreError).toBe(true));

    act(() => {
      result.current.retryLoadMore();
    });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenLastCalledWith(2);
    expect(result.current.loadMoreError).toBe(false);
    expect(result.current.loadingMore).toBe(true);

    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(result.current.rows).toEqual(rows(1, 4));
    expect(result.current.loadMoreError).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('sets error, blanks the rows and total, and stops loading when a replace request rejects', async () => {
    const fetchPage = jest.fn((_page: number) =>
      Promise.reject(new Error('network down')),
    );

    const { result } = renderList({
      mode: 'pages',
      filterKey: 'all',
      fetchPage,
    });

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.rows).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.loadMoreError).toBe(false);
  });

  it('resetToFirstPage on a filter change returns to page 1 and replaces the list', async () => {
    const fetchFor = jest.fn((filter: string, page: number) =>
      Promise.resolve(
        filter === 'all'
          ? pageOf(page, 6)
          : { rows: [{ id: `${filter}-1` }], total: 1 },
      ),
    );

    const { result } = renderFiltered(fetchFor);
    await waitFor(() =>
      expect(result.current.rows).toEqual(rows(1, PAGE_SIZE)),
    );

    act(() => {
      result.current.goToPage(2);
    });
    await waitFor(() => expect(result.current.page).toBe(2));
    await waitFor(() =>
      expect(result.current.rows).toEqual(rows(3, PAGE_SIZE)),
    );

    act(() => {
      result.current.changeFilter('mine');
    });

    await waitFor(() =>
      expect(result.current.rows).toEqual([{ id: 'mine-1' }]),
    );
    expect(result.current.page).toBe(1);
    expect(result.current.total).toBe(1);
    expect(result.current.hasMore).toBe(false);
    expect(fetchFor).toHaveBeenLastCalledWith('mine', 1);
  });

  it('ignores a late response for the old filter key after the filter has changed', async () => {
    const oldFirst = deferred<Page>();
    const mineFirst = deferred<Page>();
    const fetchFor = jest.fn((filter: string, _page: number) =>
      filter === 'all' ? oldFirst.promise : mineFirst.promise,
    );

    const { result } = renderFiltered(fetchFor);
    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.changeFilter('mine');
    });

    await act(async () => {
      mineFirst.resolve({ rows: [{ id: 'mine-1' }], total: 1 });
    });
    await waitFor(() =>
      expect(result.current.rows).toEqual([{ id: 'mine-1' }]),
    );

    await act(async () => {
      oldFirst.resolve(pageOf(1, 30));
    });

    expect(result.current.rows).toEqual([{ id: 'mine-1' }]);
    expect(result.current.total).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('reads as page 1 after a mode switch, and a later loadMore appends from page 2', async () => {
    const fetchPage = jest.fn((page: number) =>
      Promise.resolve(pageOf(page, 6)),
    );

    const { result, rerender } = renderList({
      mode: 'pages',
      filterKey: 'all',
      fetchPage,
    });
    await waitFor(() =>
      expect(result.current.rows).toEqual(rows(1, PAGE_SIZE)),
    );

    act(() => {
      result.current.goToPage(2);
    });
    await waitFor(() =>
      expect(result.current.rows).toEqual(rows(3, PAGE_SIZE)),
    );

    rerender({ mode: 'append', filterKey: 'all', fetchPage });
    await waitFor(() =>
      expect(result.current.rows).toEqual(rows(1, PAGE_SIZE)),
    );
    expect(result.current.page).toBe(1);
    expect(fetchPage).toHaveBeenLastCalledWith(1);

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.rows).toEqual(rows(1, 4)));
    expect(result.current.page).toBe(2);
    expect(fetchPage).toHaveBeenLastCalledWith(2);
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';

import { type KeyedFetchOutcome, useKeyedFetch } from './use-keyed-fetch';

type Settle = (previous: string, outcome: KeyedFetchOutcome<string>) => string;

interface FetchProps {
  key: string | null;
  load: () => Promise<string>;
  settle: Settle;
  delayMs?: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Each call to `load` takes the next deferred, in call order. */
function queueLoads(...responses: Deferred<string>[]) {
  let call = 0;
  return jest.fn(() => responses[call++].promise);
}

const passThrough: Settle = (_previous, outcome) =>
  outcome.ok ? outcome.value : 'failed';

function renderFetch(initialProps: FetchProps) {
  return renderHook(
    (props: FetchProps) =>
      useKeyedFetch<string, string>({ initial: 'initial', ...props }),
    { initialProps },
  );
}

describe('useKeyedFetch', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('requests once per key, stays pending until the response settles, then folds it in', async () => {
    const response = deferred<string>();
    const load = queueLoads(response);
    const settle = jest.fn(passThrough);

    const { result } = renderFetch({ key: 'A', load, settle });

    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ state: 'initial', pending: true });

    await act(async () => {
      response.resolve('alpha');
    });

    expect(result.current).toEqual({ state: 'alpha', pending: false });
    expect(settle).toHaveBeenCalledWith('initial', {
      ok: true,
      value: 'alpha',
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('folds a rejected request into settle as a failed outcome and clears pending', async () => {
    const response = deferred<string>();
    const load = queueLoads(response);
    const settle = jest.fn(passThrough);

    const { result } = renderFetch({ key: 'A', load, settle });

    await act(async () => {
      response.reject(new Error('network down'));
    });

    expect(settle).toHaveBeenCalledWith('initial', { ok: false });
    expect(result.current).toEqual({ state: 'failed', pending: false });
  });

  it('ignores an old key response that arrives while the new key is still pending', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const load = queueLoads(first, second);
    const settle = jest.fn(passThrough);

    const { result, rerender } = renderFetch({ key: 'A', load, settle });
    rerender({ key: 'B', load, settle });
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve('stale');
    });
    expect(result.current).toEqual({ state: 'initial', pending: true });

    await act(async () => {
      second.resolve('fresh');
    });
    expect(result.current).toEqual({ state: 'fresh', pending: false });
  });

  it('keeps the current key result when the old key response arrives after it', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const load = queueLoads(first, second);
    const settle = jest.fn(passThrough);

    const { result, rerender } = renderFetch({ key: 'A', load, settle });
    rerender({ key: 'B', load, settle });

    await act(async () => {
      second.resolve('fresh');
    });
    expect(result.current).toEqual({ state: 'fresh', pending: false });

    await act(async () => {
      first.resolve('stale');
    });
    expect(result.current).toEqual({ state: 'fresh', pending: false });
  });

  it('goes pending on a key change and keeps the previous settled state until the new key settles', async () => {
    const alpha = deferred<string>();
    const beta = deferred<string>();
    const load = queueLoads(alpha, beta);
    const settle = jest.fn(passThrough);

    const { result, rerender } = renderFetch({ key: 'A', load, settle });
    await act(async () => {
      alpha.resolve('alpha');
    });
    expect(result.current).toEqual({ state: 'alpha', pending: false });

    rerender({ key: 'B', load, settle });
    expect(result.current).toEqual({ state: 'alpha', pending: true });

    await act(async () => {
      beta.resolve('beta');
    });
    expect(result.current).toEqual({ state: 'beta', pending: false });
  });

  it('makes no request for a null key, and drops a late response once the key goes null', async () => {
    const first = deferred<string>();
    const load = queueLoads(first);
    const settle = jest.fn(passThrough);

    const { result, rerender } = renderFetch({ key: null, load, settle });
    expect(load).not.toHaveBeenCalled();
    expect(result.current).toEqual({ state: 'initial', pending: false });

    rerender({ key: 'A', load, settle });
    expect(result.current.pending).toBe(true);

    rerender({ key: null, load, settle });
    expect(result.current).toEqual({ state: 'initial', pending: false });

    await act(async () => {
      first.resolve('late');
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ state: 'initial', pending: false });
  });

  it('passes the last settled state to settle as previous, so results accumulate', async () => {
    const alpha = deferred<string>();
    const beta = deferred<string>();
    const load = queueLoads(alpha, beta);
    const accumulate = jest.fn<string, [string, KeyedFetchOutcome<string>]>(
      (previous, outcome) =>
        outcome.ok ? `${previous} ${outcome.value}` : previous,
    );

    const { result, rerender } = renderFetch({
      key: 'A',
      load,
      settle: accumulate,
    });
    await act(async () => {
      alpha.resolve('alpha');
    });

    rerender({ key: 'B', load, settle: accumulate });
    await act(async () => {
      beta.resolve('beta');
    });

    expect(accumulate).toHaveBeenLastCalledWith('initial alpha', {
      ok: true,
      value: 'beta',
    });
    expect(result.current).toEqual({
      state: 'initial alpha beta',
      pending: false,
    });
  });

  it('waits delayMs after a key change before requesting', () => {
    jest.useFakeTimers();
    const response = deferred<string>();
    const load = queueLoads(response);
    const settle = jest.fn(passThrough);

    const { result } = renderFetch({ key: 'A', load, settle, delayMs: 300 });
    expect(load).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(true);

    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(load).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('cancels the delayed request when the key changes inside the delay, so only the last key is requested', () => {
    jest.useFakeTimers();
    const response = deferred<string>();
    const load = queueLoads(response);
    const settle = jest.fn(passThrough);

    const { rerender } = renderFetch({
      key: 'A',
      load,
      settle,
      delayMs: 300,
    });

    act(() => {
      jest.advanceTimersByTime(200);
    });
    rerender({ key: 'B', load, settle, delayMs: 300 });

    // The first timer would have fired at t=300. It must not fire.
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(load).not.toHaveBeenCalled();

    // The second timer fires at t=500, one request for B.
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not re-request on a re-render with the same key, and reads the latest load and settle at the next key change', async () => {
    const firstLoad = jest.fn(() => Promise.resolve('one'));
    const secondLoad = jest.fn(() => Promise.resolve('two'));
    const firstSettle = jest.fn(passThrough);
    const latestSettle = jest.fn(
      (_previous: string, outcome: KeyedFetchOutcome<string>) =>
        outcome.ok ? `latest ${outcome.value}` : 'failed',
    );

    const { result, rerender } = renderFetch({
      key: 'A',
      load: firstLoad,
      settle: firstSettle,
    });
    await waitFor(() => expect(result.current.pending).toBe(false));

    rerender({ key: 'A', load: secondLoad, settle: latestSettle });
    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(secondLoad).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);

    rerender({ key: 'B', load: secondLoad, settle: latestSettle });
    await waitFor(() => expect(result.current.pending).toBe(false));

    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(secondLoad).toHaveBeenCalledTimes(1);
    expect(latestSettle).toHaveBeenCalledWith('one', {
      ok: true,
      value: 'two',
    });
    expect(result.current.state).toBe('latest two');
  });
});

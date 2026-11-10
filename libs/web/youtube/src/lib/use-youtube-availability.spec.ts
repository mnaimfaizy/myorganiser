/**
 * @jest-environment jsdom
 */
jest.mock('./web-youtube', () => ({
  getYouTubeAvailability: jest.fn(),
}));

import { act, renderHook, waitFor } from '@testing-library/react';
import type { YouTubeAccess, YouTubeAvailability } from './web-youtube';
import { getYouTubeAvailability } from './web-youtube';
import { subscribeToSharedYouTubeAvailability } from './shared-youtube-availability';
import {
  useYouTubeAvailability,
  type YouTubeAvailabilityState,
} from './use-youtube-availability';
import { requestYouTubeAvailabilityRecheck } from './youtube-availability-recheck';

const mockGetYouTubeAvailability = getYouTubeAvailability as jest.Mock;

const GRANTED: YouTubeAccess = { state: 'granted', withdrawnAt: null };
const WITHDRAWN: YouTubeAccess = {
  state: 'withdrawn',
  withdrawnAt: '2026-10-14T09:00:00.000Z',
};

const answer = (
  available: boolean,
  access: YouTubeAccess | null,
): YouTubeAvailability => ({ available, access });

interface Deferred {
  promise: Promise<YouTubeAvailability>;
  resolve: (value: YouTubeAvailability) => void;
  reject: (reason: unknown) => void;
}

function createDeferred(): Deferred {
  let resolve!: (value: YouTubeAvailability) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<YouTubeAvailability>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Records every render so a test can assert what the first render showed.
function mountRecording() {
  const renders: YouTubeAvailabilityState[] = [];
  const hook = renderHook(() => {
    const state = useYouTubeAvailability();
    renders.push(state);
    return state;
  });
  return { ...hook, renders };
}

describe('useYouTubeAvailability', () => {
  beforeEach(() => {
    mockGetYouTubeAvailability.mockReset();
  });

  it('starts with loading true, access null, and calls getYouTubeAvailability once', () => {
    mockGetYouTubeAvailability.mockImplementation(
      () => new Promise<YouTubeAvailability>(() => undefined),
    );

    const { result } = renderHook(() => useYouTubeAvailability());

    expect(result.current).toEqual({
      available: null,
      access: null,
      loading: true,
      error: null,
    });
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(1);
  });

  it('sets available true and exposes the granted access when getYouTubeAvailability resolves granted', async () => {
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const { result } = renderHook(() => useYouTubeAvailability());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current).toEqual({
      available: true,
      access: GRANTED,
      loading: false,
      error: null,
    });
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(1);
  });

  it('sets available false and exposes the withdrawn access when getYouTubeAvailability resolves withdrawn', async () => {
    mockGetYouTubeAvailability.mockResolvedValue(answer(false, WITHDRAWN));

    const { result } = renderHook(() => useYouTubeAvailability());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current).toEqual({
      available: false,
      access: WITHDRAWN,
      loading: false,
      error: null,
    });
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(1);
  });

  it('sets available false with null access when the switch is off', async () => {
    mockGetYouTubeAvailability.mockResolvedValue(answer(false, null));

    const { result } = renderHook(() => useYouTubeAvailability());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current).toEqual({
      available: false,
      access: null,
      loading: false,
      error: null,
    });
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(1);
  });

  it('stores the same Error instance and leaves access null when the first check rejects with Error', async () => {
    const rejection = new Error('network failure');
    mockGetYouTubeAvailability.mockRejectedValue(rejection);

    const { result } = renderHook(() => useYouTubeAvailability());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.available).toBe(false);
    expect(result.current.access).toBeNull();
    expect(result.current.error).toBe(rejection);
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(1);
  });

  it('normalizes non-Error rejections into Error instances', async () => {
    mockGetYouTubeAvailability.mockRejectedValue('service unavailable');

    const { result } = renderHook(() => useYouTubeAvailability());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.available).toBe(false);
    expect(result.current.access).toBeNull();
    expect(result.current.error).toEqual(new Error('service unavailable'));
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(1);
  });

  it('does not call getYouTubeAvailability again on rerender after settled', async () => {
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const { result, rerender } = renderHook(() => useYouTubeAvailability());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    rerender();

    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(1);
  });

  it('a check that resolves after the last instance unmounts does not seed the next mount', async () => {
    let resolveAvailability!: (value: YouTubeAvailability) => void;

    mockGetYouTubeAvailability.mockImplementationOnce(
      () =>
        new Promise<YouTubeAvailability>((resolve) => {
          resolveAvailability = resolve;
        }),
    );

    const pending = renderHook(() => useYouTubeAvailability());
    pending.unmount();

    // The only instance is gone while its check is still in flight.
    await act(async () => {
      resolveAvailability(answer(true, GRANTED));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    mockGetYouTubeAvailability.mockResolvedValue(answer(false, WITHDRAWN));
    const next = mountRecording();

    expect(next.renders[0]).toEqual({
      available: null,
      access: null,
      loading: true,
      error: null,
    });
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(next.result.current).toEqual({
        available: false,
        access: WITHDRAWN,
        loading: false,
        error: null,
      });
    });
  });

  it('flips to unavailable when a re-check requested after mount answers false', async () => {
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const { result } = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // The switch is turned off after mount: the next availability check answers false with no access signal.
    mockGetYouTubeAvailability.mockResolvedValue(answer(false, null));
    await act(async () => {
      requestYouTubeAvailabilityRecheck();
    });

    await waitFor(() => {
      expect(result.current).toEqual({
        available: false,
        access: null,
        loading: false,
        error: null,
      });
    });
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);
  });

  it('exposes the withdrawal when a re-check requested after mount answers withdrawn', async () => {
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const { result } = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Access is withdrawn after mount: the next availability check answers withdrawn.
    mockGetYouTubeAvailability.mockResolvedValue(answer(false, WITHDRAWN));
    await act(async () => {
      requestYouTubeAvailabilityRecheck();
    });

    await waitFor(() => {
      expect(result.current).toEqual({
        available: false,
        access: WITHDRAWN,
        loading: false,
        error: null,
      });
    });
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);
  });

  it('replaces the previous access when a re-check answers with different access', async () => {
    mockGetYouTubeAvailability.mockResolvedValue(answer(false, WITHDRAWN));

    const { result } = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Access is reinstated after mount: the re-check answers granted.
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));
    await act(async () => {
      requestYouTubeAvailabilityRecheck();
    });

    await waitFor(() => {
      expect(result.current).toEqual({
        available: true,
        access: GRANTED,
        loading: false,
        error: null,
      });
    });
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);
  });

  it('keeps available true when an ordinary re-check still answers true', async () => {
    const recheck = createDeferred();
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const { result } = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockGetYouTubeAvailability.mockReturnValue(recheck.promise);
    act(() => {
      requestYouTubeAvailabilityRecheck();
    });
    await act(async () => {
      recheck.resolve(answer(true, GRANTED));
    });

    expect(result.current).toEqual({
      available: true,
      access: GRANTED,
      loading: false,
      error: null,
    });
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);
  });

  it('keeps the current answer, without loading, while a re-check is pending', async () => {
    const recheck = createDeferred();
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const { result } = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockGetYouTubeAvailability.mockReturnValue(recheck.promise);
    act(() => {
      requestYouTubeAvailabilityRecheck();
    });

    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({
      available: true,
      access: GRANTED,
      loading: false,
      error: null,
    });

    await act(async () => {
      recheck.resolve(answer(true, GRANTED));
    });
  });

  it('keeps the previous answer and records the error when a re-check rejects with Error', async () => {
    const rejection = new Error('network blip');
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const { result } = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockGetYouTubeAvailability.mockRejectedValue(rejection);
    await act(async () => {
      requestYouTubeAvailabilityRecheck();
    });

    await waitFor(() => {
      expect(result.current.error).toBe(rejection);
    });
    expect(result.current).toEqual({
      available: true,
      access: GRANTED,
      loading: false,
      error: rejection,
    });
  });

  it('keeps the previous withdrawn access and records the error when a re-check rejects', async () => {
    const rejection = new Error('network blip');
    mockGetYouTubeAvailability.mockResolvedValue(answer(false, WITHDRAWN));

    const { result } = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockGetYouTubeAvailability.mockRejectedValue(rejection);
    await act(async () => {
      requestYouTubeAvailabilityRecheck();
    });

    await waitFor(() => {
      expect(result.current.error).toBe(rejection);
    });
    expect(result.current).toEqual({
      available: false,
      access: WITHDRAWN,
      loading: false,
      error: rejection,
    });
  });

  it('wraps a non-Error re-check rejection in an Error and keeps the previous answer', async () => {
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const { result } = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockGetYouTubeAvailability.mockRejectedValue('network blip');
    await act(async () => {
      requestYouTubeAvailabilityRecheck();
    });

    await waitFor(() => {
      expect(result.current.error).toEqual(new Error('network blip'));
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.available).toBe(true);
    expect(result.current.access).toEqual(GRANTED);
    expect(result.current.loading).toBe(false);
  });

  it('shares one re-check across every mounted instance', async () => {
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const first = renderHook(() => useYouTubeAvailability());
    const second = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(first.result.current.loading).toBe(false);
      expect(second.result.current.loading).toBe(false);
    });

    mockGetYouTubeAvailability.mockResolvedValue(answer(false, WITHDRAWN));
    await act(async () => {
      requestYouTubeAvailabilityRecheck();
    });

    await waitFor(() => {
      expect(first.result.current.available).toBe(false);
      expect(second.result.current.available).toBe(false);
    });
    expect(first.result.current.access).toEqual(WITHDRAWN);
    expect(second.result.current.access).toEqual(WITHDRAWN);
    // One shared initial check + one shared re-check, not one per instance.
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);
  });

  it('a re-check still reaches the instance that stays mounted when another unmounts', async () => {
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const first = renderHook(() => useYouTubeAvailability());
    const second = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(first.result.current.loading).toBe(false);
      expect(second.result.current.loading).toBe(false);
    });

    first.unmount();

    mockGetYouTubeAvailability.mockResolvedValue(answer(false, WITHDRAWN));
    await act(async () => {
      requestYouTubeAvailabilityRecheck();
    });

    await waitFor(() => {
      expect(second.result.current).toEqual({
        available: false,
        access: WITHDRAWN,
        loading: false,
        error: null,
      });
    });
  });

  it('calls only the subscribers still subscribed when a re-check starts', async () => {
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));
    const stayed = jest.fn();
    const left = jest.fn();

    const kept = subscribeToSharedYouTubeAvailability(stayed);
    const dropped = subscribeToSharedYouTubeAvailability(left);
    dropped.unsubscribe();

    requestYouTubeAvailabilityRecheck();

    expect(stayed).toHaveBeenCalledTimes(1);
    expect(stayed).toHaveBeenCalledWith(expect.any(Promise));
    expect(left).not.toHaveBeenCalled();
    kept.unsubscribe();
  });

  it('lets the latest requested re-check win over an earlier one that settles later', async () => {
    const rechecks: Deferred[] = [];
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const { result } = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockGetYouTubeAvailability.mockImplementation(() => {
      const recheck = createDeferred();
      rechecks.push(recheck);
      return recheck.promise;
    });
    act(() => {
      requestYouTubeAvailabilityRecheck();
      requestYouTubeAvailabilityRecheck();
    });
    expect(rechecks).toHaveLength(2);

    // The later-requested re-check answers first; the earlier one settles last.
    await act(async () => {
      rechecks[1].resolve(answer(false, WITHDRAWN));
    });
    await act(async () => {
      rechecks[0].resolve(answer(true, GRANTED));
    });

    expect(result.current).toEqual({
      available: false,
      access: WITHDRAWN,
      loading: false,
      error: null,
    });
  });

  it('ignores a stale re-check rejection once a later re-check has answered', async () => {
    const rechecks: Deferred[] = [];
    mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

    const { result } = renderHook(() => useYouTubeAvailability());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockGetYouTubeAvailability.mockImplementation(() => {
      const recheck = createDeferred();
      rechecks.push(recheck);
      return recheck.promise;
    });
    act(() => {
      requestYouTubeAvailabilityRecheck();
      requestYouTubeAvailabilityRecheck();
    });
    expect(rechecks).toHaveLength(2);

    await act(async () => {
      rechecks[1].resolve(answer(false, WITHDRAWN));
    });
    await act(async () => {
      rechecks[0].reject(new Error('stale'));
    });

    expect(result.current).toEqual({
      available: false,
      access: WITHDRAWN,
      loading: false,
      error: null,
    });
  });

  it('fails closed when a re-check rejects before the first check answers, and ignores the first check when it resolves later', async () => {
    const first = createDeferred();
    const rejection = new Error('recheck failed');
    mockGetYouTubeAvailability
      .mockImplementationOnce(() => first.promise)
      .mockRejectedValueOnce(rejection);

    const { result } = renderHook(() => useYouTubeAvailability());
    expect(result.current.loading).toBe(true);

    act(() => {
      requestYouTubeAvailabilityRecheck();
    });
    await waitFor(() => {
      expect(result.current.error).toBe(rejection);
    });
    expect(result.current).toEqual({
      available: false,
      access: null,
      loading: false,
      error: rejection,
    });

    // The overtaken first check resolves late with a granted answer: the
    // latest-check guard ignores it, so the fail-closed state stays.
    await act(async () => {
      first.resolve(answer(true, GRANTED));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current).toEqual({
      available: false,
      access: null,
      loading: false,
      error: rejection,
    });
    expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);
  });

  describe('shared check across mounted instances', () => {
    it('dedupes the initial check: two instances mounted together call once and both get the answer', async () => {
      mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

      const first = mountRecording();
      const second = mountRecording();

      await waitFor(() => {
        expect(first.result.current.loading).toBe(false);
        expect(second.result.current.loading).toBe(false);
      });
      expect(first.result.current).toEqual({
        available: true,
        access: GRANTED,
        loading: false,
        error: null,
      });
      expect(second.result.current).toEqual({
        available: true,
        access: GRANTED,
        loading: false,
        error: null,
      });
      expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(1);
    });

    it('starts a late-mounted instance from the settled answer on its first render, without a new call', async () => {
      mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

      const first = mountRecording();
      await waitFor(() => {
        expect(first.result.current.loading).toBe(false);
      });

      const late = mountRecording();

      expect(late.renders[0]).toEqual({
        available: true,
        access: GRANTED,
        loading: false,
        error: null,
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(late.result.current).toEqual({
        available: true,
        access: GRANTED,
        loading: false,
        error: null,
      });
      expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(1);
    });

    it('joins a check still in flight without a new call and gets its answer when it resolves', async () => {
      const pending = createDeferred();
      mockGetYouTubeAvailability.mockImplementation(() => pending.promise);

      const first = mountRecording();
      const second = mountRecording();

      expect(second.renders[0]).toEqual({
        available: null,
        access: null,
        loading: true,
        error: null,
      });
      expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending.resolve(answer(true, GRANTED));
      });

      await waitFor(() => {
        expect(first.result.current.loading).toBe(false);
        expect(second.result.current.loading).toBe(false);
      });
      expect(first.result.current).toEqual({
        available: true,
        access: GRANTED,
        loading: false,
        error: null,
      });
      expect(second.result.current).toEqual({
        available: true,
        access: GRANTED,
        loading: false,
        error: null,
      });
      expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(1);
    });

    it('drops the shared answer when the last instance unmounts, so the next mount starts from loading and asks again', async () => {
      mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

      const first = mountRecording();
      const second = mountRecording();
      await waitFor(() => {
        expect(second.result.current.loading).toBe(false);
      });
      first.unmount();
      second.unmount();

      // The next User's check answers differently: the previous answer must not show.
      mockGetYouTubeAvailability.mockResolvedValue(answer(false, WITHDRAWN));
      const next = mountRecording();

      expect(next.renders[0]).toEqual({
        available: null,
        access: null,
        loading: true,
        error: null,
      });
      expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);
      await waitFor(() => {
        expect(next.result.current).toEqual({
          available: false,
          access: WITHDRAWN,
          loading: false,
          error: null,
        });
      });
    });

    it('does not share a failed first check: an instance mounted while the failed one is still mounted asks again', async () => {
      const rejection = new Error('network failure');
      mockGetYouTubeAvailability
        .mockRejectedValueOnce(rejection)
        .mockResolvedValue(answer(true, GRANTED));

      const failed = mountRecording();
      await waitFor(() => {
        expect(failed.result.current.error).toBe(rejection);
      });

      const retry = mountRecording();

      expect(retry.renders[0]).toEqual({
        available: null,
        access: null,
        loading: true,
        error: null,
      });
      expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);
      await waitFor(() => {
        expect(retry.result.current).toEqual({
          available: true,
          access: GRANTED,
          loading: false,
          error: null,
        });
      });
    });

    it('keeps the settled answer for a late mount after a re-check errors, and keeps it when the late mount check also errors', async () => {
      mockGetYouTubeAvailability.mockResolvedValue(answer(true, GRANTED));

      const first = mountRecording();
      await waitFor(() => {
        expect(first.result.current.loading).toBe(false);
      });

      mockGetYouTubeAvailability.mockRejectedValue('network blip');
      await act(async () => {
        requestYouTubeAvailabilityRecheck();
      });
      await waitFor(() => {
        expect(first.result.current.error).toEqual(new Error('network blip'));
      });

      const late = mountRecording();

      expect(late.renders[0]).toEqual({
        available: true,
        access: GRANTED,
        loading: false,
        error: null,
      });
      await waitFor(() => {
        expect(late.result.current.error).toEqual(new Error('network blip'));
      });
      expect(late.result.current.available).toBe(true);
      expect(late.result.current.access).toEqual(GRANTED);
      expect(late.result.current.loading).toBe(false);
      expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(3);
    });

    it('a check that rejects after its last instance left does not drop a newer shared check', async () => {
      const staleCheck = createDeferred();
      const newerCheck = createDeferred();
      const rejection = new Error('stale check failed');
      mockGetYouTubeAvailability
        .mockImplementationOnce(() => staleCheck.promise)
        .mockImplementationOnce(() => newerCheck.promise);

      const departed = mountRecording();
      departed.unmount();

      const waiting = mountRecording();
      expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);

      // The check the departed instance started rejects after it left.
      await act(async () => {
        staleCheck.reject(rejection);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(waiting.result.current).toEqual({
        available: null,
        access: null,
        loading: true,
        error: null,
      });

      // A later mount joins the newer shared check, not a new request.
      const joiner = mountRecording();

      expect(joiner.renders[0]).toEqual({
        available: null,
        access: null,
        loading: true,
        error: null,
      });
      expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);

      await act(async () => {
        newerCheck.resolve(answer(true, GRANTED));
      });

      await waitFor(() => {
        expect(waiting.result.current).toEqual({
          available: true,
          access: GRANTED,
          loading: false,
          error: null,
        });
        expect(joiner.result.current).toEqual({
          available: true,
          access: GRANTED,
          loading: false,
          error: null,
        });
      });
      expect(mockGetYouTubeAvailability).toHaveBeenCalledTimes(2);
    });
  });
});

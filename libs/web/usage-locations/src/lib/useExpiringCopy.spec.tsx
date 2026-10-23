/**
 * Tests for useExpiringCopy.
 *
 * Focus: the copy confirmation lifetime, the 60 s clipboard clear, the
 * "copied elsewhere" guard that stops the clear, timer restart on a second
 * copy, the failure message on a refused write, swallowed clear failures, and
 * the clear surviving an unmount. The pending clear and the copied-elsewhere
 * flag live at module scope in the hook, so every test drains its timers in
 * afterEach. navigator.clipboard is stubbed per test; the hook has no other
 * collaborators.
 */

import { act, renderHook } from '@testing-library/react';
import {
  COPY_EXPIRY_SECONDS,
  COPY_FAILED_MESSAGE,
  useExpiringCopy,
} from './useExpiringCopy';

const CONFIRMATION_MS = 4000;

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard',
);

function installClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

describe('useExpiringCopy', () => {
  let writeText: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    writeText = jest.fn();
    installClipboard({ writeText });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });

  it('writes the value, resolves true, announces the copy and fades the message after 4 s', async () => {
    const { result } = renderHook(() => useExpiringCopy());

    let copied: boolean | undefined;
    await act(async () => {
      copied = await result.current.copy('Postcode', '3121');
    });

    expect(writeText).toHaveBeenCalledWith('3121');
    expect(copied).toBe(true);
    expect(result.current.message).toBe('Postcode copied — clears in 60 s');

    act(() => {
      jest.advanceTimersByTime(CONFIRMATION_MS);
    });

    expect(result.current.message).toBeNull();
  });

  it('announces a copy with no label as "Copied" and still writes the value', async () => {
    const { result } = renderHook(() => useExpiringCopy());

    let copied: boolean | undefined;
    await act(async () => {
      copied = await result.current.copy('', '+61 412 345 678');
    });

    expect(writeText).toHaveBeenCalledWith('+61 412 345 678');
    expect(copied).toBe(true);
    expect(result.current.message).toBe('Copied — clears in 60 s');
  });

  it(`clears the clipboard once, after ${COPY_EXPIRY_SECONDS} s, by writing an empty string`, async () => {
    const { result } = renderHook(() => useExpiringCopy());

    await act(async () => {
      await result.current.copy('Postcode', '3121');
    });

    act(() => {
      jest.advanceTimersByTime(COPY_EXPIRY_SECONDS * 1000 - 1);
    });
    expect(writeText).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenNthCalledWith(2, '');
  });

  it('restarts the confirmation timer on a second copy so the first timer cannot fade the new message', async () => {
    const { result } = renderHook(() => useExpiringCopy());

    await act(async () => {
      await result.current.copy('Postcode', '3121');
    });

    // t = 2 s: the second copy replaces the message and restarts its 4 s fade.
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    await act(async () => {
      await result.current.copy('Unit', '4B');
    });

    // t = 4.5 s: past the first copy's 4 s fade, before the second copy's 6 s fade.
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    expect(result.current.message).toBe('Unit copied — clears in 60 s');

    // t = 6.5 s: past the second copy's fade.
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current.message).toBeNull();
  });

  it('does not clear the clipboard when the user copied something else after our copy', async () => {
    const { result } = renderHook(() => useExpiringCopy());

    await act(async () => {
      await result.current.copy('Postcode', '3121');
    });

    act(() => {
      document.dispatchEvent(new Event('copy'));
      jest.advanceTimersByTime(COPY_EXPIRY_SECONDS * 1000);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalledWith('');
  });

  it('restarts the timer on a second copy and resets the copied-elsewhere flag', async () => {
    const { result } = renderHook(() => useExpiringCopy());

    await act(async () => {
      await result.current.copy('Postcode', '3121');
    });

    // 30 s in: the user copies something else, then we copy again.
    act(() => {
      jest.advanceTimersByTime(30_000);
      document.dispatchEvent(new Event('copy'));
    });
    await act(async () => {
      await result.current.copy('Unit', '4B');
    });

    // The first copy's 60 s mark (t = 60 s) passes with no clear.
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).not.toHaveBeenCalledWith('');

    // The second copy's clear fires 60 s after it (t = 90 s), exactly once.
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(writeText).toHaveBeenCalledTimes(3);
    expect(writeText).toHaveBeenLastCalledWith('');
    expect(writeText.mock.calls.filter(([text]) => text === '')).toHaveLength(
      1,
    );
  });

  it('resolves false, announces the failure message and schedules no clear when the write is refused', async () => {
    writeText.mockRejectedValueOnce(new Error('Permission denied'));
    const { result } = renderHook(() => useExpiringCopy());

    let copied: boolean | undefined;
    await act(async () => {
      copied = await result.current.copy('Postcode', '3121');
    });

    expect(copied).toBe(false);
    expect(result.current.message).toBe(COPY_FAILED_MESSAGE);

    act(() => {
      jest.advanceTimersByTime(COPY_EXPIRY_SECONDS * 1000);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalledWith('');
  });

  it('resolves false and announces the failure message when the Clipboard API is missing or has no writeText', async () => {
    const { result } = renderHook(() => useExpiringCopy());

    installClipboard(undefined);
    let copiedWithoutApi: boolean | undefined;
    await act(async () => {
      copiedWithoutApi = await result.current.copy('Postcode', '3121');
    });

    installClipboard({});
    let copiedWithoutWriteText: boolean | undefined;
    await act(async () => {
      copiedWithoutWriteText = await result.current.copy('Postcode', '3121');
    });

    expect(copiedWithoutApi).toBe(false);
    expect(copiedWithoutWriteText).toBe(false);
    expect(result.current.message).toBe(COPY_FAILED_MESSAGE);
  });

  it('swallows a failed clipboard clear without an unhandled rejection and keeps the hook usable', async () => {
    writeText.mockImplementation(async (text: string) => {
      if (text === '') throw new Error('Document is not focused');
    });
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    try {
      const { result } = renderHook(() => useExpiringCopy());

      await act(async () => {
        await result.current.copy('Postcode', '3121');
      });

      await act(async () => {
        jest.advanceTimersByTime(COPY_EXPIRY_SECONDS * 1000);
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith('');

      let copiedAgain: boolean | undefined;
      await act(async () => {
        copiedAgain = await result.current.copy('Unit', '4B');
      });

      expect(copiedAgain).toBe(true);
      expect(result.current.message).toBe('Unit copied — clears in 60 s');
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('keeps the scheduled clear after unmount', async () => {
    const { result, unmount } = renderHook(() => useExpiringCopy());

    await act(async () => {
      await result.current.copy('Postcode', '3121');
    });

    unmount();

    act(() => {
      jest.advanceTimersByTime(COPY_EXPIRY_SECONDS * 1000);
    });

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenLastCalledWith('');
  });
});

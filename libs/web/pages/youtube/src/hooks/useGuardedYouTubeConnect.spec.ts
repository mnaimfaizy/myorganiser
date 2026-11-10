import { act, renderHook } from '@testing-library/react';
import { useYouTubeConnect } from './index';
import { useGuardedYouTubeConnect } from './useGuardedYouTubeConnect';

jest.mock('./index', () => ({
  useYouTubeConnect: jest.fn(),
}));

describe('useGuardedYouTubeConnect', () => {
  const CONNECT_ERROR =
    'Could not start the YouTube connection. Please try again.';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts with no connect error', () => {
    (useYouTubeConnect as jest.Mock).mockReturnValue({
      connect: jest.fn(),
    });

    const { result } = renderHook(() => useGuardedYouTubeConnect());

    expect(result.current.connectError).toBeNull();
  });

  it('keeps the error state at null and calls connect once when connect resolves', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    (useYouTubeConnect as jest.Mock).mockReturnValue({ connect });

    const { result } = renderHook(() => useGuardedYouTubeConnect());
    await act(async () => {
      await result.current.handleConnect();
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(result.current.connectError).toBeNull();
  });

  it('sets the connect error without rejecting when connect rejects', async () => {
    const connect = jest
      .fn()
      .mockRejectedValue(new Error('auth-url request failed'));
    (useYouTubeConnect as jest.Mock).mockReturnValue({ connect });

    const { result } = renderHook(() => useGuardedYouTubeConnect());

    // Awaiting handleConnect directly proves the rejection does not escape it.
    await act(async () => {
      await expect(result.current.handleConnect()).resolves.toBeUndefined();
    });

    expect(result.current.connectError).toBe(CONNECT_ERROR);
  });

  it('clears the connect error when handleConnect is called again', async () => {
    let attempts = 0;
    const connect = jest.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('auth-url request failed');
    });
    (useYouTubeConnect as jest.Mock).mockReturnValue({ connect });

    const { result } = renderHook(() => useGuardedYouTubeConnect());
    await act(async () => {
      await result.current.handleConnect();
    });
    expect(result.current.connectError).toBe(CONNECT_ERROR);

    await act(async () => {
      await result.current.handleConnect();
    });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(result.current.connectError).toBeNull();
  });
});

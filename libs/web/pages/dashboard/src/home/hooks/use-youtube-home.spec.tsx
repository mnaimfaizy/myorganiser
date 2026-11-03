/* eslint-disable import/first -- jest.mock must precede application imports */
jest.mock('../../hooks/useYouTubeNavVisible', () => ({
  useYouTubeNavVisible: jest.fn(),
}));

jest.mock('../../lib/apiClient', () => ({
  createYouTubeApi: jest.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react';
import { useYouTubeNavVisible } from '../../hooks/useYouTubeNavVisible';
import { createYouTubeApi } from '../../lib/apiClient';
import { useYouTubeHome } from './use-youtube-home';

const videos = [
  {
    videoId: 'v1',
    title: 'First upload',
    thumbnail: null,
    publishedAt: '2026-11-01T00:00:00Z',
  },
  {
    videoId: 'v2',
    title: 'Second upload',
    thumbnail: null,
    publishedAt: '2026-10-30T00:00:00Z',
  },
];

const videosPage = {
  videos,
  total: 2,
  page: 1,
  limit: 6,
  totalPages: 1,
  message: '',
};

const subscriptionRows = [
  { enabled: true },
  { enabled: false },
  { enabled: true },
];

const mockGetConnectionStatus = jest.fn();
const mockGetVideos = jest.fn();
const mockGetSubscriptions = jest.fn();

describe('useYouTubeHome', () => {
  beforeEach(() => {
    mockGetConnectionStatus.mockReset();
    mockGetVideos.mockReset();
    mockGetSubscriptions.mockReset();
    (createYouTubeApi as jest.Mock).mockReset();
    (useYouTubeNavVisible as jest.Mock).mockReset();

    (useYouTubeNavVisible as jest.Mock).mockReturnValue(true);
    (createYouTubeApi as jest.Mock).mockReturnValue({
      getConnectionStatus: mockGetConnectionStatus,
      getVideos: mockGetVideos,
      getSubscriptions: mockGetSubscriptions,
    });
    mockGetConnectionStatus.mockResolvedValue({
      data: { connected: true, status: 'ok', message: '' },
    });
    mockGetVideos.mockResolvedValue({ data: videosPage });
    mockGetSubscriptions.mockResolvedValue({ data: subscriptionRows });
  });

  it('reports not visible and calls no YouTube endpoint when the nav gate is closed', () => {
    (useYouTubeNavVisible as jest.Mock).mockReturnValue(false);

    const { result } = renderHook(() => useYouTubeHome());

    expect(result.current.visible).toBe(false);
    expect(createYouTubeApi).not.toHaveBeenCalled();
    expect(mockGetConnectionStatus).not.toHaveBeenCalled();
    expect(mockGetVideos).not.toHaveBeenCalled();
    expect(mockGetSubscriptions).not.toHaveBeenCalled();
  });

  it('reads as disconnected and skips the videos and channel reads when the account is not connected', async () => {
    mockGetConnectionStatus.mockResolvedValue({
      data: { connected: false, status: 'none', message: '' },
    });

    const { result } = renderHook(() => useYouTubeHome());

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'disconnected' });
    });
    expect(result.current.visible).toBe(true);
    expect(mockGetVideos).not.toHaveBeenCalled();
    expect(mockGetSubscriptions).not.toHaveBeenCalled();
  });

  it('loads the latest six videos and counts only the enabled channels when connected', async () => {
    const { result } = renderHook(() => useYouTubeHome());

    await waitFor(() => {
      expect(result.current.state).toEqual({
        status: 'loaded',
        channels: 2,
        videos,
      });
    });
    expect(mockGetVideos).toHaveBeenCalledWith({ sort: 'latest', limit: 6 });
    expect(mockGetSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('keeps the videos and reads the channel count as null when the subscriptions payload is not a list', async () => {
    mockGetSubscriptions.mockResolvedValue({
      data: { error: 'unexpected' },
    });

    const { result } = renderHook(() => useYouTubeHome());

    await waitFor(() => {
      expect(result.current.state).toEqual({
        status: 'loaded',
        channels: null,
        videos,
      });
    });
  });

  it('keeps the videos and reads the channel count as null when the subscriptions read rejects', async () => {
    mockGetSubscriptions.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useYouTubeHome());

    await waitFor(() => {
      expect(result.current.state).toEqual({
        status: 'loaded',
        channels: null,
        videos,
      });
    });
  });

  it('reads as error, not disconnected, when the status endpoint answers with an HTTP error body', async () => {
    // Regression for the bug this spec guards: the old raw-fetch code parsed
    // a non-2xx body as success data, so this error body read as
    // `{ connected: false }` and rendered "Not connected". The generated
    // client rejects on non-2xx, so the hook must land on the error state.
    mockGetConnectionStatus.mockRejectedValue({
      response: { status: 500, data: { connected: false, message: 'boom' } },
    });

    const { result } = renderHook(() => useYouTubeHome());

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'error' });
    });
    expect(mockGetVideos).not.toHaveBeenCalled();
  });

  it('reads as error when the request fails with no response (network error)', async () => {
    mockGetConnectionStatus.mockRejectedValue(new Error('Network Error'));

    const { result } = renderHook(() => useYouTubeHome());

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'error' });
    });
  });
});

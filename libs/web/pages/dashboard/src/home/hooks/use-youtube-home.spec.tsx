/* eslint-disable import/first */
jest.mock('../../hooks/useYouTubeNavVisible', () => ({
  useYouTubeNavVisible: jest.fn(),
}));

jest.mock('@myorganiser/auth', () => ({
  getAccessToken: jest.fn(),
}));

jest.mock('@myorganiser/core', () => ({
  getApiBaseUrl: jest.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react';
import { getAccessToken } from '@myorganiser/auth';
import { getApiBaseUrl } from '@myorganiser/core';
import { useYouTubeNavVisible } from '../../hooks/useYouTubeNavVisible';
import { useYouTubeHome } from './use-youtube-home';

const VIDEOS_PATH = '/videos?sort=latest&limit=6';

const videos = [
  { videoId: 'v1', title: 'First upload' },
  { videoId: 'v2', title: 'Second upload' },
];

const subscriptionRows = [
  { enabled: true },
  { enabled: false },
  { enabled: true },
];

/** Routes each YouTube API path to a JSON body, as the backend would. */
function stubYouTubeApi(routes: Record<string, unknown>): jest.Mock {
  return jest.fn(async (url: string) => {
    const path = url.replace('https://api.test/youtube', '');
    return { json: async () => routes[path] };
  });
}

describe('useYouTubeHome', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (useYouTubeNavVisible as jest.Mock).mockReturnValue(true);
    (getApiBaseUrl as jest.Mock).mockReturnValue('https://api.test');
    (getAccessToken as jest.Mock).mockReturnValue(null);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reports not visible and sends no request when the nav gate is closed', () => {
    (useYouTubeNavVisible as jest.Mock).mockReturnValue(false);

    const { result } = renderHook(() => useYouTubeHome());

    expect(result.current.visible).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads as disconnected when the status says the account is not connected', async () => {
    fetchMock.mockImplementation(
      stubYouTubeApi({ '/status': { connected: false } }),
    );

    const { result } = renderHook(() => useYouTubeHome());

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'disconnected' });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads the latest videos and the enabled channel count when connected', async () => {
    fetchMock.mockImplementation(
      stubYouTubeApi({
        '/status': { connected: true },
        [VIDEOS_PATH]: { videos },
        '/subscriptions': subscriptionRows,
      }),
    );

    const { result } = renderHook(() => useYouTubeHome());

    await waitFor(() => {
      expect(result.current.state).toEqual({
        status: 'loaded',
        channels: 2,
        videos,
      });
    });
    expect(result.current.visible).toBe(true);
  });

  it.each<[string, () => Promise<unknown>]>([
    ['rejects', () => Promise.reject(new TypeError('Failed to fetch'))],
    [
      'is not a list',
      async () => ({ json: async () => ({ error: 'unexpected' }) }),
    ],
  ])(
    'keeps the videos and reads the channel count as null when /subscriptions %s',
    async (_label, subscriptionsResponse) => {
      const apiRoutes = stubYouTubeApi({
        '/status': { connected: true },
        [VIDEOS_PATH]: { videos },
      });
      fetchMock.mockImplementation((url: string) =>
        url.endsWith('/subscriptions')
          ? subscriptionsResponse()
          : apiRoutes(url),
      );

      const { result } = renderHook(() => useYouTubeHome());

      await waitFor(() => {
        expect(result.current.state).toEqual({
          status: 'loaded',
          channels: null,
          videos,
        });
      });
    },
  );

  it('reads as error when a request rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useYouTubeHome());

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'error' });
    });
  });

  it('calls the YouTube endpoints with the bearer token when one exists', async () => {
    (getAccessToken as jest.Mock).mockReturnValue('token-abc');
    fetchMock.mockImplementation(
      stubYouTubeApi({
        '/status': { connected: true },
        [VIDEOS_PATH]: { videos },
        '/subscriptions': subscriptionRows,
      }),
    );

    const { result } = renderHook(() => useYouTubeHome());

    await waitFor(() => {
      expect(result.current.state.status).toBe('loaded');
    });

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toEqual(
      expect.arrayContaining([
        'https://api.test/youtube/status',
        `https://api.test/youtube${VIDEOS_PATH}`,
        'https://api.test/youtube/subscriptions',
      ]),
    );
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc',
          }),
        }),
      );
    }
  });
});

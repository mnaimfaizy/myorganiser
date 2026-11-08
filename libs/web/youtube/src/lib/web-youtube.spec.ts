const mockGetAvailability = jest.fn();
const mockGetAccess = jest.fn();

jest.mock('@myorganiser/core', () => ({
  getApiBaseUrl: jest.fn(),
}));

jest.mock('@myorganiser/auth', () => ({
  getAccessToken: jest.fn(),
  getAuthAxios: jest.fn(),
}));

jest.mock('@myorganiser/app-api-client', () => ({
  Configuration: jest.fn(function Configuration(config) {
    return config;
  }),
  YouTubeApi: jest.fn(function YouTubeApi() {
    return {
      getAvailability: mockGetAvailability,
      getAccess: mockGetAccess,
    };
  }),
}));

import { Configuration, YouTubeApi } from '@myorganiser/app-api-client';
import { getAccessToken, getAuthAxios } from '@myorganiser/auth';
import { getApiBaseUrl } from '@myorganiser/core';
import { getYouTubeAvailability } from './web-youtube';

const API_BASE = 'http://api.test';

describe('getYouTubeAvailability', () => {
  const authAxios = { name: 'auth-axios' };

  beforeEach(() => {
    (getApiBaseUrl as jest.Mock).mockReset();
    (getApiBaseUrl as jest.Mock).mockReturnValue(API_BASE);
    (getAccessToken as jest.Mock).mockReset();
    (getAccessToken as jest.Mock).mockReturnValue('access-token');
    (getAuthAxios as jest.Mock).mockReset();
    (getAuthAxios as jest.Mock).mockReturnValue(authAxios);
    mockGetAvailability.mockReset();
    mockGetAccess.mockReset();
    (Configuration as jest.Mock).mockClear();
    (YouTubeApi as jest.Mock).mockClear();
  });

  it('constructs the public availability client first, then the access client, and calls each endpoint once', async () => {
    mockGetAvailability.mockResolvedValue({ data: { available: true } });
    mockGetAccess.mockResolvedValue({ data: { granted: true } });

    await getYouTubeAvailability();

    expect(Configuration).toHaveBeenCalledTimes(2);
    expect(Configuration).toHaveBeenNthCalledWith(1, { basePath: API_BASE });
    expect(YouTubeApi).toHaveBeenCalledTimes(2);
    expect(YouTubeApi).toHaveBeenNthCalledWith(1, { basePath: API_BASE });
    expect(mockGetAvailability).toHaveBeenCalledTimes(1);
    expect(mockGetAccess).toHaveBeenCalledTimes(1);
  });

  it('returns available with granted access when the switch is on and YouTube Access is granted', async () => {
    mockGetAvailability.mockResolvedValue({ data: { available: true } });
    mockGetAccess.mockResolvedValue({
      data: { granted: true, state: 'granted' },
    });

    await expect(getYouTubeAvailability()).resolves.toEqual({
      available: true,
      access: { state: 'granted', withdrawnAt: null },
    });
  });

  it('returns not_granted access and available false when the switch is on and access is not granted', async () => {
    mockGetAvailability.mockResolvedValue({ data: { available: true } });
    mockGetAccess.mockResolvedValue({
      data: { granted: false, state: 'not_granted' },
    });

    await expect(getYouTubeAvailability()).resolves.toEqual({
      available: false,
      access: { state: 'not_granted', withdrawnAt: null },
    });
  });

  it('returns withdrawn access with the recorded withdrawal time', async () => {
    mockGetAvailability.mockResolvedValue({ data: { available: true } });
    mockGetAccess.mockResolvedValue({
      data: {
        granted: false,
        state: 'withdrawn',
        withdrawnAt: '2026-10-14T09:00:00.000Z',
      },
    });

    await expect(getYouTubeAvailability()).resolves.toEqual({
      available: false,
      access: {
        state: 'withdrawn',
        withdrawnAt: '2026-10-14T09:00:00.000Z',
      },
    });
  });

  it('returns withdrawn access with a null withdrawnAt when the date was not recorded', async () => {
    mockGetAvailability.mockResolvedValue({ data: { available: true } });
    mockGetAccess.mockResolvedValue({
      data: { granted: false, state: 'withdrawn' },
    });

    await expect(getYouTubeAvailability()).resolves.toEqual({
      available: false,
      access: { state: 'withdrawn', withdrawnAt: null },
    });
  });

  it.each([
    [
      'granted true with no state (older backend)',
      { granted: true },
      { available: true, access: { state: 'granted', withdrawnAt: null } },
    ],
    [
      'granted false with no state (older backend)',
      { granted: false },
      { available: false, access: { state: 'not_granted', withdrawnAt: null } },
    ],
    [
      'a non-boolean granted with no state',
      { granted: 'yes' },
      { available: false, access: { state: 'not_granted', withdrawnAt: null } },
    ],
  ])(
    'maps %s to the matching access state',
    async (_label, accessData, expected) => {
      mockGetAvailability.mockResolvedValue({ data: { available: true } });
      mockGetAccess.mockResolvedValue({ data: accessData });

      await expect(getYouTubeAvailability()).resolves.toEqual(expected);
    },
  );

  it('returns available false with null access and never calls the access endpoint when the switch is off, even for a granted User', async () => {
    mockGetAvailability.mockResolvedValue({ data: { available: false } });
    mockGetAccess.mockResolvedValue({
      data: { granted: true, state: 'granted' },
    });

    await expect(getYouTubeAvailability()).resolves.toEqual({
      available: false,
      access: null,
    });

    expect(mockGetAccess).not.toHaveBeenCalled();
    expect(YouTubeApi).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['string "yes"', 'yes'],
    ['number 1', 1],
    ['null', null],
    ['undefined', undefined],
  ])(
    'returns available false with null access when available is a non-boolean value (%s)',
    async (_label, available) => {
      mockGetAvailability.mockResolvedValue({ data: { available } });

      await expect(getYouTubeAvailability()).resolves.toEqual({
        available: false,
        access: null,
      });
      expect(mockGetAccess).not.toHaveBeenCalled();
    },
  );

  it('propagates getAvailability rejection unchanged', async () => {
    const rejection = new Error('network failure');
    mockGetAvailability.mockRejectedValue(rejection);

    await expect(getYouTubeAvailability()).rejects.toBe(rejection);
  });

  it('propagates getAccess rejection unchanged, so the hook fails closed on it', async () => {
    const rejection = new Error('access lookup failed');
    mockGetAvailability.mockResolvedValue({ data: { available: true } });
    mockGetAccess.mockRejectedValue(rejection);

    await expect(getYouTubeAvailability()).rejects.toBe(rejection);
  });

  it('builds the access client with a bearer token provider and the auth axios instance', async () => {
    mockGetAvailability.mockResolvedValue({ data: { available: true } });
    mockGetAccess.mockResolvedValue({ data: { granted: true } });

    await getYouTubeAvailability();

    expect(Configuration).toHaveBeenNthCalledWith(2, {
      basePath: API_BASE,
      accessToken: expect.any(Function),
    });
    expect(YouTubeApi).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ basePath: API_BASE }),
      undefined,
      authAxios,
    );

    const accessConfig = (YouTubeApi as jest.Mock).mock.calls[1][0];
    expect(accessConfig.accessToken()).toBe('access-token');

    (getAccessToken as jest.Mock).mockReturnValue(undefined);
    expect(accessConfig.accessToken()).toBe('');
  });
});

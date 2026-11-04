/* eslint-disable import/first -- jest.mock must precede application imports */

const mockToast = jest.fn();
const mockApi = {
  getConnectionStatus: jest.fn(),
  getNotificationSettings: jest.fn(),
  updateNotificationSettings: jest.fn(),
};

jest.mock('../lib/apiClient', () => ({ createYouTubeApi: () => mockApi }));
jest.mock('@myorganiser/web-ui', () => ({
  useToast: () => ({ toast: mockToast }),
}));
jest.mock('@myorganiser/core', () => ({ detectTimeZone: jest.fn() }));

import { detectTimeZone } from '@myorganiser/core';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useYouTubeDigestSettings } from './use-youtube-digest-settings';

function axiosError(message: string) {
  return Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: { status: 500, data: { message } },
  });
}

describe('useYouTubeDigestSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (detectTimeZone as jest.Mock).mockReturnValue('Australia/Sydney');
    mockApi.getConnectionStatus.mockResolvedValue({
      data: { connected: true },
    });
    mockApi.getNotificationSettings.mockResolvedValue({
      data: { enabled: true, preferredWeekday: 3 },
    });
    mockApi.updateNotificationSettings.mockResolvedValue({ data: {} });
  });

  it('loads status and settings through the generated client', async () => {
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.weekday).toBe(3));
    expect(result.current.connected).toBe(true);
    expect(result.current.enabled).toBe(true);
    expect(result.current.loadError).toBeNull();
  });

  it('surfaces a failed load and recovers on retry', async () => {
    mockApi.getConnectionStatus.mockRejectedValueOnce(
      axiosError('Server down'),
    );
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.loadError).toBe('Server down'));

    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.weekday).toBe(3));
    expect(result.current.loadError).toBeNull();
  });

  it('surfaces a failed settings fetch after a connected status', async () => {
    mockApi.getNotificationSettings.mockRejectedValueOnce(
      axiosError('No settings'),
    );
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.loadError).toBe('No settings'));
  });

  it('toasts the server message when save fails', async () => {
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.connected).toBe(true));
    mockApi.updateNotificationSettings.mockRejectedValueOnce(
      axiosError('Nope'),
    );
    await act(() => result.current.save());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Nope', variant: 'destructive' }),
    );
    expect(result.current.saving).toBe(false);
  });

  it('sends the detected time zone', async () => {
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.weekday).toBe(3));
    await act(() => result.current.save());
    expect(mockApi.updateNotificationSettings).toHaveBeenCalledWith({
      notificationSettingsBody: {
        enabled: true,
        preferredWeekday: 3,
        timeZone: 'Australia/Sydney',
      },
    });
  });

  it('sends UTC when detection returns null', async () => {
    (detectTimeZone as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.weekday).toBe(3));
    await act(() => result.current.save());
    expect(
      mockApi.updateNotificationSettings.mock.calls[0][0]
        .notificationSettingsBody.timeZone,
    ).toBe('UTC');
  });
});

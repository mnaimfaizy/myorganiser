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
import { AxiosError, type AxiosResponse } from 'axios';

import { useYouTubeDigestSettings } from './use-youtube-digest-settings';

function axiosError(message: string) {
  return Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: { status: 500, data: { message } },
  });
}

// The backend answers 404 { message: 'Not Found' } when YouTube is off or the
// User has no YouTube Access. A real AxiosError keeps isAxiosError true.
function notFoundError() {
  const response = {
    status: 404,
    statusText: 'Not Found',
    headers: {},
    config: { headers: {} },
    data: { message: 'Not Found' },
  } as AxiosResponse;
  return new AxiosError(
    'Request failed',
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    response,
  );
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
    expect(result.current.settingsLoaded).toBe(true);
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
    expect(result.current.connected).toBe(true);
    expect(result.current.settingsLoaded).toBe(false);
  });

  it('treats a 404 status load as YouTube off, without an error', async () => {
    mockApi.getConnectionStatus.mockRejectedValueOnce(notFoundError());
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(mockApi.getConnectionStatus).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.loadError).toBeNull();
    expect(result.current.connected).toBe(false);
    expect(result.current.settingsLoaded).toBe(false);
    expect(mockApi.getNotificationSettings).not.toHaveBeenCalled();
  });

  it('treats a 404 settings load as not connected, without an error', async () => {
    mockApi.getNotificationSettings.mockRejectedValueOnce(notFoundError());
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() =>
      expect(mockApi.getNotificationSettings).toHaveBeenCalled(),
    );
    await act(async () => {});
    expect(result.current.loadError).toBeNull();
    expect(result.current.connected).toBe(false);
    expect(result.current.settingsLoaded).toBe(false);
  });

  it('stays unloaded while the first settings request is pending', async () => {
    mockApi.getNotificationSettings.mockImplementation(
      () => new Promise(() => {}),
    );
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() =>
      expect(mockApi.getNotificationSettings).toHaveBeenCalled(),
    );
    expect(result.current.settingsLoaded).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it('stays unloaded while a Retry is pending after a failed load', async () => {
    let calls = 0;
    mockApi.getNotificationSettings.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(axiosError('Boom'));
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.loadError).toBe('Boom'));
    expect(result.current.settingsLoaded).toBe(false);

    act(() => result.current.retryLoad());
    await waitFor(() =>
      expect(mockApi.getNotificationSettings).toHaveBeenCalledTimes(2),
    );
    expect(result.current.loadError).toBeNull();
    expect(result.current.settingsLoaded).toBe(false);
  });

  it('treats a 200 status with connected false as off, without loading settings', async () => {
    mockApi.getConnectionStatus.mockResolvedValue({
      data: { connected: false },
    });
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(mockApi.getConnectionStatus).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.connected).toBe(false);
    expect(result.current.settingsLoaded).toBe(false);
    expect(result.current.loadError).toBeNull();
    expect(mockApi.getNotificationSettings).not.toHaveBeenCalled();
  });

  it('ignores a settings response that arrives after unmount', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    let resolveSettings: (value: unknown) => void = () => {};
    mockApi.getNotificationSettings.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSettings = resolve;
        }),
    );
    const { unmount } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() =>
      expect(mockApi.getNotificationSettings).toHaveBeenCalled(),
    );
    unmount();
    await act(async () => {
      resolveSettings({ data: { enabled: false, preferredWeekday: 5 } });
    });
    expect(consoleError).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('save sends nothing before the settings have loaded', async () => {
    mockApi.getNotificationSettings.mockImplementation(
      () => new Promise(() => {}),
    );
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() =>
      expect(mockApi.getNotificationSettings).toHaveBeenCalled(),
    );
    await act(() => result.current.save());
    expect(mockApi.updateNotificationSettings).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('after a Retry succeeds, shows the stored values and saves the edits', async () => {
    let calls = 0;
    mockApi.getNotificationSettings.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw axiosError('Boom');
      return { data: { enabled: false, preferredWeekday: 5 } };
    });
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.loadError).toBe('Boom'));

    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.settingsLoaded).toBe(true));
    expect(result.current.enabled).toBe(false);
    expect(result.current.weekday).toBe(5);
    expect(result.current.loadError).toBeNull();

    act(() => {
      result.current.setEnabled(true);
      result.current.setWeekday(2);
    });
    await act(() => result.current.save());
    expect(mockApi.updateNotificationSettings).toHaveBeenCalledWith({
      notificationSettingsBody: {
        enabled: true,
        preferredWeekday: 2,
        timeZone: 'Australia/Sydney',
      },
    });
  });

  it('toasts the server message when save fails', async () => {
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.settingsLoaded).toBe(true));
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
    await waitFor(() => expect(result.current.settingsLoaded).toBe(true));
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
    await waitFor(() => expect(result.current.settingsLoaded).toBe(true));
    await act(() => result.current.save());
    expect(
      mockApi.updateNotificationSettings.mock.calls[0][0]
        .notificationSettingsBody.timeZone,
    ).toBe('UTC');
  });
});

describe('useYouTubeDigestSettings edits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (detectTimeZone as jest.Mock).mockReturnValue('UTC');
    mockApi.getConnectionStatus.mockResolvedValue({
      data: { connected: true },
    });
    mockApi.getNotificationSettings.mockResolvedValue({
      data: { enabled: true, preferredWeekday: 3 },
    });
    mockApi.updateNotificationSettings.mockResolvedValue({ data: {} });
  });

  it('sends the edited values and toasts on success', async () => {
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.settingsLoaded).toBe(true));
    act(() => {
      result.current.setEnabled(false);
      result.current.setWeekday(5);
    });
    await act(() => result.current.save());
    expect(mockApi.updateNotificationSettings).toHaveBeenCalledWith({
      notificationSettingsBody: {
        enabled: false,
        preferredWeekday: 5,
        timeZone: 'UTC',
      },
    });
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Saved',
      description: 'Weekly digest settings updated.',
    });
  });

  it('sends nothing when the weekday is invalid and says why', async () => {
    const { result } = renderHook(() => useYouTubeDigestSettings());
    await waitFor(() => expect(result.current.settingsLoaded).toBe(true));
    act(() => result.current.setWeekday(9));
    await act(() => result.current.save());
    expect(mockApi.updateNotificationSettings).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Not saved',
      description: 'Select a day.',
      variant: 'destructive',
    });
  });
});

/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

import type { AdminOverviewResponse } from '@myorganiser/app-api-client';
import { act, renderHook, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ReactNode } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';

import { AdminOverviewProvider, useAdminOverview } from './use-admin-overview';

const mockGetAdminOverview = jest.fn();

const overviewFixture: AdminOverviewResponse = {
  users: 148,
  usersJoinedLast7Days: 6,
  platformAdmins: 3,
  unverified: 12,
  unverifiedOverAWeek: 5,
  disabled: 4,
  youtubeAccessPlacesUsed: 20,
  youtubeAccessPlacesLeft: 5,
  youtubeAccessCeiling: 25,
  feedbackReportsReceived: 2,
};

function wrapper({ children }: { children: ReactNode }) {
  return <AdminOverviewProvider>{children}</AdminOverviewProvider>;
}

describe('useAdminOverview', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      getAdminOverview: mockGetAdminOverview,
    });
  });

  it('fetches the overview once on mount and exposes the data', async () => {
    mockGetAdminOverview.mockResolvedValue({ data: overviewFixture });

    const { result } = renderHook(() => useAdminOverview(), { wrapper });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetAdminOverview).toHaveBeenCalledTimes(1);
    expect(result.current.overview).toEqual(overviewFixture);
    expect(result.current.error).toBe(false);
  });

  it('sets error and leaves overview null when the request rejects', async () => {
    mockGetAdminOverview.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useAdminOverview(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe(true);
    });

    expect(result.current.overview).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('reload() clears the error, fetches again, and exposes the new data', async () => {
    mockGetAdminOverview.mockImplementation(() =>
      mockGetAdminOverview.mock.calls.length === 1
        ? Promise.reject(new Error('network down'))
        : Promise.resolve({ data: overviewFixture }),
    );

    const { result } = renderHook(() => useAdminOverview(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe(true);
    });

    act(() => {
      result.current.reload();
    });

    expect(result.current.error).toBe(false);
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.overview).toEqual(overviewFixture);
    });

    expect(mockGetAdminOverview).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('throws when used outside AdminOverviewProvider', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      expect(() => renderHook(() => useAdminOverview())).toThrow(
        'useAdminOverview must be used inside AdminOverviewProvider',
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

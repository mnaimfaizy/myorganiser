/* eslint-disable import/first */
jest.mock('@myorganiser/auth', () => ({
  logout: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  useToast: jest.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react';
import { logout } from '@myorganiser/auth';
import { useToast } from '@myorganiser/web-ui';
import { useRouter } from 'next/navigation';
import { useLogOut } from './use-log-out';

describe('useLogOut', () => {
  const push = jest.fn();
  const toast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push });
    (useToast as jest.Mock).mockReturnValue({ toast });
    (logout as jest.Mock).mockResolvedValue(undefined);
  });

  it('sends the User to login once the sign-out succeeds', async () => {
    const { result } = renderHook(() => useLogOut());

    result.current();

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/login');
    });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('stays put and shows a destructive toast when the sign-out is rejected', async () => {
    (logout as jest.Mock).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useLogOut());

    result.current();

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        title: 'Log out failed',
        description: 'You are still signed in. Try again.',
        variant: 'destructive',
      });
    });
    expect(push).not.toHaveBeenCalled();
  });
});

/* eslint-disable import/first */
jest.mock('@myorganiser/auth', () => ({
  getCurrentUser: jest.fn(),
  logout: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  useToast: jest.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react';
import { getCurrentUser, logout } from '@myorganiser/auth';
import { useToast } from '@myorganiser/web-ui';
import { isPasskeyUnlockEnrolled } from '@myorganiser/web-vault';
import { useRouter } from 'next/navigation';
import { useLogOut } from './use-log-out';

// Storage keys as the Passkey Unlock and Local Vault records write them (ADR 0136).
const PASSKEY_RECORD_PREFIX = 'myorganiser_passkey_unlock_v1';
const LOCAL_VAULT_KEY = 'myorganiser_vault_v1:owner-a';

/** A fixture Passkey Unlock wrapping record in its stored shape; the values are placeholders. */
function seedPasskeyRecord(owner: string): void {
  localStorage.setItem(
    `${PASSKEY_RECORD_PREFIX}:${owner}`,
    JSON.stringify({
      version: 1,
      owner,
      credentialId: 'Y3JlZA==',
      prfSalt: 'c2FsdA==',
      wrappedMasterKey: { iv: 'aXY=', ciphertext: 'Y3Q=' },
    }),
  );
}

describe('useLogOut', () => {
  const push = jest.fn();
  const toast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (useRouter as jest.Mock).mockReturnValue({ push });
    (useToast as jest.Mock).mockReturnValue({ toast });
    (getCurrentUser as jest.Mock).mockReturnValue({ id: 'owner-a' });
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

  it('removes only this owner’s passkey record once the sign-out succeeds, and leaves the Local Vault alone', async () => {
    seedPasskeyRecord('owner-a');
    seedPasskeyRecord('owner-b');
    localStorage.setItem(LOCAL_VAULT_KEY, 'local-vault-ciphertext');
    const { result } = renderHook(() => useLogOut());

    result.current();

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/login');
    });
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(isPasskeyUnlockEnrolled('owner-b')).toBe(true);
    expect(localStorage.getItem(LOCAL_VAULT_KEY)).toBe(
      'local-vault-ciphertext',
    );
  });

  it('keeps this owner’s passkey record when the sign-out is rejected', async () => {
    seedPasskeyRecord('owner-a');
    (logout as jest.Mock).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useLogOut());

    result.current();

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Log out failed' }),
      );
    });
    expect(push).not.toHaveBeenCalled();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(true);
  });

  it('still sends the User to login when storage refuses to remove the passkey record', async () => {
    seedPasskeyRecord('owner-a');
    const removeItem = jest
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const { result } = renderHook(() => useLogOut());

    try {
      result.current();

      await waitFor(() => {
        expect(push).toHaveBeenCalledWith('/login');
      });
      expect(removeItem).toHaveBeenCalledWith(
        `${PASSKEY_RECORD_PREFIX}:owner-a`,
      );
      expect(toast).not.toHaveBeenCalled();
    } finally {
      removeItem.mockRestore();
    }
  });
});

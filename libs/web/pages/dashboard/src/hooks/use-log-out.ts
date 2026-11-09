'use client';

import { getCurrentUser, logout } from '@myorganiser/auth';
import { useToast } from '@myorganiser/web-ui';
import { disablePasskeyUnlock } from '@myorganiser/web-vault';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Returns a handler that ends the session and sends the User to sign-in. If
 * the sign-out is rejected the User stays where they are and sees a
 * destructive toast; a failed sign-out must not look like a completed one.
 *
 * A completed sign-out also removes this owner's Passkey Unlock record from
 * this device (ADR 0136, decision 6). Only that record: the Local Vault and
 * the other per-owner records keep their behaviour. A storage failure there
 * never turns a completed sign-out into a failed one.
 */
export function useLogOut(): () => void {
  const router = useRouter();
  const { toast } = useToast();

  return useCallback(() => {
    const owner = getCurrentUser()?.id;
    void logout().then(
      () => {
        if (owner) disablePasskeyUnlock(owner);
        router.push('/login');
      },
      () => {
        toast({
          title: 'Log out failed',
          description: 'You are still signed in. Try again.',
          variant: 'destructive',
        });
      },
    );
  }, [router, toast]);
}

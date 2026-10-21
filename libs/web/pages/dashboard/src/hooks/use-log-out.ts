'use client';

import { logout } from '@myorganiser/auth';
import { useToast } from '@myorganiser/web-ui';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Returns a handler that ends the session and sends the User to sign-in. If
 * the sign-out is rejected the User stays where they are and sees a
 * destructive toast; a failed sign-out must not look like a completed one.
 */
export function useLogOut(): () => void {
  const router = useRouter();
  const { toast } = useToast();

  return useCallback(() => {
    void logout().then(
      () => {
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

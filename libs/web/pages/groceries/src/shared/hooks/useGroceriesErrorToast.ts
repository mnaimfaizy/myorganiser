'use client';

import { useToast } from '@myorganiser/web-ui';
import { useCallback } from 'react';

/**
 * The one failure toast every groceries write shows when the vault rejects it.
 * Both page hooks call this, so the wording cannot drift between them.
 */
export function useGroceriesErrorToast(): () => void {
  const { toast } = useToast();
  return useCallback(() => {
    toast({
      title: 'Error',
      description: 'Failed to save your changes. Please try again.',
      variant: 'destructive',
    });
  }, [toast]);
}

'use client';

import { useCallback } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Illustration,
  Input,
  useIsMobile,
} from '@myorganiser/web-ui';
import { currentPassphraseSchema } from '@myorganiser/web-vault';

import { useVaultUnlock, useVaultDisabledState } from '../hooks';

const vaultUnlockSchema = z.object({
  passphrase: currentPassphraseSchema,
});

type VaultUnlockInput = z.infer<typeof vaultUnlockSchema>;

/** The locked hero: the one place the vault is unlocked, shown above the Access cards. */
export function VaultUnlockCard() {
  const { unlocking, unlock } = useVaultUnlock();
  const disabledState = useVaultDisabledState();
  const isMobile = useIsMobile();

  const form = useForm<VaultUnlockInput>({
    resolver: zodResolver(vaultUnlockSchema),
    defaultValues: {
      passphrase: '',
    },
  });

  const onSubmit = useCallback(
    async (values: VaultUnlockInput) => {
      const result = await unlock(values.passphrase);

      if (result === 'ok') {
        form.reset();
      } else if (result === 'wrong-passphrase') {
        form.setError('passphrase', {
          message: 'That is not your current passphrase.',
        });
      }
      // On 'error', the hook already toasted, so leave the form as-is
    },
    [unlock, form],
  );

  // Only render if vault is locked
  if (disabledState !== 'locked') {
    return null;
  }

  // Below md the illustration and heading share a row; the body and form span both
  // columns. At md the column wrapper becomes a flex column again (display: contents
  // below md).
  return (
    <section className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 rounded-2xl bg-navy p-6 text-navy-foreground md:flex md:flex-wrap md:gap-8 md:p-8">
      <Illustration kind="vault" size={isMobile ? 48 : 112} />
      <div className="contents md:flex md:min-w-0 md:flex-1 md:basis-80 md:flex-col md:gap-3">
        <h1 className="font-display text-title md:text-display">
          Unlock your vault
        </h1>
        <p className="col-span-2 text-body text-navy-muted-foreground">
          Enter your passphrase to unlock your vault on this device for this
          session.
        </p>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="col-span-2 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start"
          >
            <FormField
              control={form.control}
              name="passphrase"
              render={({ field }) => (
                <FormItem className="md:min-w-72 md:flex-1">
                  <FormLabel className="text-navy-foreground">
                    Passphrase
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      className="border-2 border-navy-accent bg-navy-raised text-navy-foreground aria-[invalid=true]:border-error-edge"
                    />
                  </FormControl>
                  <FormMessage className="text-navy-foreground" />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              variant="brand"
              data-testid="vault-unlock-submit"
              disabled={unlocking}
              className="w-full md:mt-6 md:w-auto"
            >
              {unlocking ? 'Unlocking…' : 'Unlock'}
            </Button>
          </form>
        </Form>
      </div>
    </section>
  );
}

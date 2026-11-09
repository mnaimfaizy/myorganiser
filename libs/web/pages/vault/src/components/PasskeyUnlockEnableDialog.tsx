'use client';

import { useCallback } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@myorganiser/web-ui';
import { currentPassphraseSchema } from '@myorganiser/web-vault';

import { usePasskeyUnlockCard } from '../hooks';

const enableSchema = z.object({
  passphrase: currentPassphraseSchema,
});

type EnableInput = z.infer<typeof enableSchema>;

export const PASSKEY_UNLOCK_ENABLE_DESCRIPTION =
  'Enter your current passphrase to turn on Passkey Unlock for this device. The passphrase is checked first, and nothing is saved unless it matches.';

const WRONG_PASSPHRASE_MESSAGE = 'That is not your current passphrase.';

export interface PasskeyUnlockEnableDialogProps {
  /** Controlled open state, owned by the caller. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The passphrase step for turning Passkey Unlock on. Shared by the desktop
 * card and the phone row; each mounts its own instance, and only one layout
 * renders at a time.
 */
export function PasskeyUnlockEnableDialog({
  open,
  onOpenChange,
}: PasskeyUnlockEnableDialogProps) {
  const { busy, enable } = usePasskeyUnlockCard();

  const form = useForm<EnableInput>({
    resolver: zodResolver(enableSchema),
    defaultValues: {
      passphrase: '',
    },
  });

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) form.reset();
      onOpenChange(next);
    },
    [form, onOpenChange],
  );

  const handleCancel = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const onSubmit = useCallback(
    async (values: EnableInput) => {
      const result = await enable(values.passphrase);

      if (result === 'ok') {
        form.reset();
        onOpenChange(false);
      } else if (result === 'wrong-passphrase') {
        form.setError('passphrase', { message: WRONG_PASSPHRASE_MESSAGE });
      }
      // Any other outcome was toasted by the hook; leave the form as-is.
    },
    [enable, form, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-theme(spacing.8))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Turn on Passkey Unlock</DialogTitle>
          <DialogDescription>
            {PASSKEY_UNLOCK_ENABLE_DESCRIPTION}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-3"
          >
            <FormField
              control={form.control}
              name="passphrase"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current passphrase</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="brand"
                data-testid="passkey-unlock-passphrase-submit"
                disabled={busy}
              >
                {busy ? 'Turning on…' : 'Turn on'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useCallback, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { z } from 'zod';

import { Button, IconButton, Input, Label } from '@myorganiser/web-ui';

const PASSPHRASE_FIELD_ID = 'unlock-passphrase';
const PASSPHRASE_ERROR_ID = 'unlock-passphrase-error';

// An empty passphrase is deliberately valid (#1460): it is not rejected
// client-side, and submitting it calls unlockWithPassphrase as any other does.
export const passphraseUnlockSchema = z.object({ passphrase: z.string() });
export type PassphraseUnlockValues = z.infer<typeof passphraseUnlockSchema>;

export interface PassphraseUnlockFormProps {
  /**
   * The gate's form: the gate owns it so the typed passphrase survives the
   * recover-screen toggle and the gate can set the mismatch error.
   */
  form: UseFormReturn<PassphraseUnlockValues>;
  /** Called with the validated values on Enter / Unlock. */
  onSubmit: (values: PassphraseUnlockValues) => void | Promise<void>;
  /** True while the unlock is in flight: the button shows its busy state and cannot be pressed. */
  unlocking: boolean;
}

/**
 * The passphrase field, its show/hide control, the inline error, and the
 * Unlock submit, wrapped in one form so Enter submits. The footer links sit
 * outside this form (the claim offer owns its own form, and forms do not nest).
 * The value and its error live in the gate's React Hook Form instance; the
 * reveal state is local: it is UI state, not a field value.
 */
export function PassphraseUnlockForm({
  form,
  onSubmit,
  unlocking,
}: PassphraseUnlockFormProps) {
  const [revealPassphrase, setRevealPassphrase] = useState(false);
  const error = form.formState.errors.passphrase?.message;

  const toggleRevealPassphrase = useCallback((): void => {
    setRevealPassphrase((previous) => !previous);
  }, []);

  return (
    <form
      aria-label="Unlock your vault"
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4.5"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={PASSPHRASE_FIELD_ID}>Passphrase</Label>
        <div className="relative">
          <Input
            id={PASSPHRASE_FIELD_ID}
            type={revealPassphrase ? 'text' : 'password'}
            autoComplete="current-password"
            {...form.register('passphrase', {
              onChange: () => form.clearErrors('passphrase'),
            })}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? PASSPHRASE_ERROR_ID : undefined}
            className="h-12 pr-12 text-body md:h-12 md:text-body"
          />
          <IconButton
            label="Show passphrase"
            aria-pressed={revealPassphrase}
            aria-controls={PASSPHRASE_FIELD_ID}
            variant="ghost"
            icon={revealPassphrase ? <EyeOff /> : <Eye />}
            onClick={toggleRevealPassphrase}
            className="absolute inset-y-0 right-0 my-auto text-muted-foreground"
          />
        </div>
        {error ? (
          <p
            id={PASSPHRASE_ERROR_ID}
            role="alert"
            className="text-caption text-destructive-text"
          >
            {error}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        variant="brand"
        className="w-full"
        loading={unlocking}
      >
        {unlocking ? 'Unlocking…' : 'Unlock'}
      </Button>
    </form>
  );
}

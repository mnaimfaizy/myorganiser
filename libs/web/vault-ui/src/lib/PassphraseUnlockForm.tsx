'use client';

import { type FormEvent, useCallback, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Button, IconButton, Input, Label } from '@myorganiser/web-ui';

const PASSPHRASE_FIELD_ID = 'unlock-passphrase';
const PASSPHRASE_ERROR_ID = 'unlock-passphrase-error';

export interface PassphraseUnlockFormProps {
  /** The passphrase as typed. The gate owns it so the unlock handler can read it. */
  value: string;
  onChange: (value: string) => void;
  /** Runs on Enter in the field and on the Unlock button. The handler must call `preventDefault` itself. */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** The inline error under the field, or `null` when there is none. */
  error: string | null;
  /** True while the unlock is in flight: the button shows its busy state and cannot be pressed. */
  unlocking: boolean;
}

/**
 * The passphrase field, its show/hide control, the inline error, and the
 * Unlock submit, wrapped in one form so Enter submits. The footer links sit
 * outside this form (the claim offer owns its own form, and forms do not nest).
 * The reveal state is local: it is UI state, not something the gate needs.
 */
export function PassphraseUnlockForm({
  value,
  onChange,
  onSubmit,
  error,
  unlocking,
}: PassphraseUnlockFormProps) {
  const [revealPassphrase, setRevealPassphrase] = useState(false);

  const toggleRevealPassphrase = useCallback((): void => {
    setRevealPassphrase((previous) => !previous);
  }, []);

  return (
    <form
      aria-label="Unlock your vault"
      onSubmit={onSubmit}
      className="flex flex-col gap-4.5"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={PASSPHRASE_FIELD_ID}>Passphrase</Label>
        <div className="relative">
          <Input
            id={PASSPHRASE_FIELD_ID}
            type={revealPassphrase ? 'text' : 'password'}
            autoComplete="current-password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
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

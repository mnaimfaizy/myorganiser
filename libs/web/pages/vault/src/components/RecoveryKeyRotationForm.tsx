'use client';

import { useCallback, useEffect, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  Button,
  DialogFooter,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  useToast,
} from '@myorganiser/web-ui';
import {
  currentPassphraseSchema,
  mintRecoveryKey,
  type MintedRecoveryKey,
} from '@myorganiser/web-vault';

import { downloadTextFile } from '../utils';
import {
  useRecoveryKeyRotation,
  useVaultOperationAvailability,
} from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import { RecoveryKeyMintedSection } from './RecoveryKeyMintedSection';

const rotationFormSchema = z.object({
  currentPassphrase: currentPassphraseSchema,
  confirmRecoveryKey: z.string(),
});

export type RotationFormInput = z.infer<typeof rotationFormSchema>;

export interface RecoveryKeyRotationFormProps {
  /**
   * `dialog` puts Cancel and the rotate submit in a right-aligned footer.
   * `screen` renders a full-width primary submit with a ghost Cancel below it.
   */
  layout: 'dialog' | 'screen';
  /** Leaves the flow without rotating. Closing the dialog discards the minted key. */
  onCancel: () => void;
  /** Called after the rotation succeeds. */
  onDone: () => void;
}

interface RecoveryKeyRotationActionsProps {
  layout: RecoveryKeyRotationFormProps['layout'];
  submitDisabled: boolean;
  rotating: boolean;
  onCancel: () => void;
  onRotate: () => Promise<void>;
}

function RecoveryKeyRotationActions({
  layout,
  submitDisabled,
  rotating,
  onCancel,
  onRotate,
}: RecoveryKeyRotationActionsProps) {
  const submitLabel = rotating ? 'Rotating…' : 'Rotate recovery key';

  if (layout === 'screen') {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          className="w-full"
          data-testid="recovery-key-rotation-submit"
          disabled={submitDisabled}
          onClick={onRotate}
        >
          {submitLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          data-testid="recovery-key-rotation-cancel"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <DialogFooter>
      <Button
        type="button"
        variant="outline"
        data-testid="recovery-key-rotation-cancel"
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button
        type="button"
        data-testid="recovery-key-rotation-submit"
        disabled={submitDisabled}
        onClick={onRotate}
      >
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}

/**
 * The recovery key rotation form, shared by the dialog and the screen. Nothing
 * is written until the User confirms the minted key; the minted key lives only
 * in this component's state, so unmounting the form discards it.
 */
export function RecoveryKeyRotationForm({
  layout,
  onCancel,
  onDone,
}: RecoveryKeyRotationFormProps) {
  const { toast } = useToast();
  const { rotating, rotateRecoveryKey } = useRecoveryKeyRotation();
  const { allowed } = useVaultOperationAvailability(
    VAULT_OPERATIONS.RecoveryKeyRotation,
  );

  const [mintedKey, setMintedKey] = useState<MintedRecoveryKey | null>(null);

  const handlePreventSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
  }, []);

  const form = useForm<RotationFormInput>({
    resolver: zodResolver(rotationFormSchema),
    defaultValues: {
      currentPassphrase: '',
      confirmRecoveryKey: '',
    },
  });

  const handleGenerateKey = useCallback(async () => {
    const valid = await form.trigger('currentPassphrase');
    if (!valid) return;
    const newKey = mintRecoveryKey();
    setMintedKey(newKey);
  }, [form]);

  const handleDownload = useCallback(() => {
    if (!mintedKey) return;
    downloadTextFile(
      'myorganiser-recovery-key.txt',
      `MyOrganiser Recovery Key\n\n${mintedKey}\n\nKeep this safe. Anyone with it can decrypt your vault.`,
    );
  }, [mintedKey]);

  const handleCopy = useCallback(async () => {
    if (!mintedKey) return;

    if (!navigator.clipboard) {
      toast({
        title: 'Copy not available',
        description:
          'Your browser does not support copy to clipboard. Use the Download button or select the key manually.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(mintedKey);
      toast({
        title: 'Copied',
        description: 'Recovery key copied to clipboard.',
      });
    } catch {
      toast({
        title: 'Copy failed',
        description:
          'Could not copy recovery key to clipboard. Use the Download button or select it manually.',
        variant: 'destructive',
      });
    }
  }, [mintedKey, toast]);

  const handleRotate = useCallback(async () => {
    const valid = await form.trigger('currentPassphrase');
    if (!valid) return;
    const currentPassphrase = form.getValues('currentPassphrase');
    if (!mintedKey) return;

    const result = await rotateRecoveryKey({
      currentPassphrase,
      recoveryKey: mintedKey,
    });

    if (result === 'ok') {
      form.reset();
      setMintedKey(null);
      onDone();
    } else if (result === 'wrong-passphrase') {
      form.setError('currentPassphrase', {
        message: 'That is not your current passphrase.',
      });
    }
    // On 'error', the hook already toasted — leave everything as-is
  }, [form, mintedKey, rotateRecoveryKey, onDone]);

  const currentPassphrase = form.watch('currentPassphrase');
  const confirmRecoveryKey = form.watch('confirmRecoveryKey');
  const isPassphraseEmpty = !currentPassphrase?.trim();
  const isConfirmMatched =
    mintedKey !== null && confirmRecoveryKey === mintedKey;

  // Only flag a mismatch once the User has entered at least as much as the
  // minted key — otherwise every keystroke of a correct paste-in-progress
  // would flash as an error before it's had a chance to match.
  useEffect(() => {
    if (
      mintedKey &&
      confirmRecoveryKey &&
      confirmRecoveryKey.length >= mintedKey.length &&
      confirmRecoveryKey !== mintedKey
    ) {
      form.setError('confirmRecoveryKey', {
        message:
          'Recovery key does not match. Check that you pasted it correctly.',
      });
    } else {
      form.clearErrors('confirmRecoveryKey');
    }
  }, [confirmRecoveryKey, mintedKey, form]);

  return (
    <Form {...form}>
      <form onSubmit={handlePreventSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 rounded-xl bg-brand-soft p-3 text-body text-brand-text">
          <p>
            Generating a new recovery key does not change anything by itself —
            nothing is written until you confirm you have it.
          </p>
          <p>
            A Vault Export you saved before rotating still opens with your old
            recovery key — see &quot;Export encrypted vault&quot; on the Vault
            page.
          </p>
        </div>

        <FormField
          control={form.control}
          name="currentPassphrase"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Passphrase to authorize this rotation</FormLabel>
              <FormControl>
                <Input {...field} type="password" disabled={!allowed} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="button"
          data-testid="recovery-key-rotation-mint"
          disabled={!allowed || isPassphraseEmpty || mintedKey !== null}
          onClick={handleGenerateKey}
          className={layout === 'screen' ? 'w-full' : undefined}
        >
          Generate recovery key
        </Button>

        {mintedKey !== null && (
          <RecoveryKeyMintedSection
            mintedKey={mintedKey}
            form={form}
            disabled={!allowed}
            onDownload={handleDownload}
            onCopy={handleCopy}
          />
        )}

        <RecoveryKeyRotationActions
          layout={layout}
          submitDisabled={!allowed || !isConfirmMatched || rotating}
          rotating={rotating}
          onCancel={onCancel}
          onRotate={handleRotate}
        />
      </form>
    </Form>
  );
}

'use client';

import { useCallback } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { type Control, type FieldValues, useForm } from 'react-hook-form';
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
} from '@myorganiser/web-ui';
import {
  changePassphraseSchema,
  ChangePassphraseInput,
  newPassphraseSchema,
} from '@myorganiser/web-vault';
import {
  NewPassphraseFields,
  PASSPHRASE_REWRITE_FACTS,
  type NewPassphraseFieldValues,
} from '@myorganiser/web-vault-ui';

import {
  useChangePassphrase,
  useChangePassphraseMode,
  useVaultOperationAvailability,
} from '../hooks';
import { VAULT_OPERATIONS } from '../policy';

type NewPassphraseInput = z.infer<typeof newPassphraseSchema>;

export interface ChangePassphraseFormProps {
  /**
   * `dialog` puts Cancel and the submit in a right-aligned footer inside the
   * form. `screen` renders a single full-width submit.
   */
  layout: 'dialog' | 'screen';
  /** Required for the dialog layout; closing the dialog discards the form. */
  onCancel?: () => void;
  /** Called after the passphrase change succeeds. */
  onDone: () => void;
}

interface ChangePassphraseSharedFieldsProps<
  TFieldValues extends FieldValues & NewPassphraseFieldValues,
> {
  control: Control<TFieldValues>;
  allowed: boolean;
}

function ChangePassphraseSharedFields<
  TFieldValues extends FieldValues & NewPassphraseFieldValues,
>({ control, allowed }: ChangePassphraseSharedFieldsProps<TFieldValues>) {
  return <NewPassphraseFields control={control} disabled={!allowed} />;
}

interface ChangePassphraseActionsProps {
  layout: ChangePassphraseFormProps['layout'];
  allowed: boolean;
  changing: boolean;
  submitLabel: string;
  onCancel?: () => void;
}

function ChangePassphraseActions({
  layout,
  allowed,
  changing,
  submitLabel,
  onCancel,
}: ChangePassphraseActionsProps) {
  const submit = (
    <Button
      type="submit"
      data-testid="change-passphrase-submit"
      disabled={changing || !allowed}
      className={layout === 'screen' ? 'w-full' : undefined}
    >
      {changing ? 'Changing…' : submitLabel}
    </Button>
  );

  if (layout === 'screen') {
    return submit;
  }

  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      {submit}
    </DialogFooter>
  );
}

/** The trust-soft facts panel: what a passphrase change rewrites and what it does not. */
function ChangePassphraseFacts() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-trust-edge bg-trust-soft p-3 text-body text-trust-text">
      <p>{PASSPHRASE_REWRITE_FACTS.wrapping}</p>
      <p>{PASSPHRASE_REWRITE_FACTS.otherDevices}</p>
    </div>
  );
}

/**
 * The change passphrase form, shared by the dialog and the screen. Owns the
 * React Hook Form state and the Zod schema for the mode the session was
 * unlocked with; the surrounding surface supplies the heading and the policy
 * notice.
 */
export function ChangePassphraseForm({
  layout,
  onCancel,
  onDone,
}: ChangePassphraseFormProps) {
  const { changing, unlockSecret, changePassphrase } = useChangePassphrase();
  const { allowed } = useVaultOperationAvailability(
    VAULT_OPERATIONS.PassphraseChange,
  );
  const mode = useChangePassphraseMode();

  const isRecoveryReset = unlockSecret === 'recovery-key';

  const recoveryForm = useForm<NewPassphraseInput>({
    resolver: zodResolver(newPassphraseSchema),
    defaultValues: {
      newPassphrase: '',
      newPassphraseConfirm: '',
    },
  });

  const passphraseForm = useForm<ChangePassphraseInput>({
    resolver: zodResolver(changePassphraseSchema),
    defaultValues: {
      currentPassphrase: '',
      newPassphrase: '',
      newPassphraseConfirm: '',
    },
  });

  const onSubmitRecovery = useCallback(
    async (values: NewPassphraseInput) => {
      const result = await changePassphrase({
        currentPassphrase: '',
        newPassphrase: values.newPassphrase,
      });

      if (result === 'ok') {
        recoveryForm.reset();
        onDone();
      }
      // On 'error', the hook already toasted, so leave the form as-is
    },
    [changePassphrase, recoveryForm, onDone],
  );

  const onSubmitPassphrase = useCallback(
    async (values: ChangePassphraseInput) => {
      const result = await changePassphrase({
        currentPassphrase: values.currentPassphrase,
        newPassphrase: values.newPassphrase,
      });

      if (result === 'ok') {
        passphraseForm.reset();
        onDone();
      } else if (result === 'wrong-passphrase') {
        passphraseForm.setError('currentPassphrase', {
          message: 'That is not your current passphrase.',
        });
      }
      // On 'error', the hook already toasted, so leave the form as-is
    },
    [changePassphrase, passphraseForm, onDone],
  );

  if (isRecoveryReset) {
    return (
      <Form {...recoveryForm}>
        <form
          onSubmit={recoveryForm.handleSubmit(onSubmitRecovery)}
          className="flex flex-col gap-3"
        >
          <ChangePassphraseFacts />
          <ChangePassphraseSharedFields
            control={recoveryForm.control}
            allowed={allowed}
          />
          <ChangePassphraseActions
            layout={layout}
            allowed={allowed}
            changing={changing}
            submitLabel={mode.submitLabel}
            onCancel={onCancel}
          />
        </form>
      </Form>
    );
  }

  return (
    <Form {...passphraseForm}>
      <form
        onSubmit={passphraseForm.handleSubmit(onSubmitPassphrase)}
        className="flex flex-col gap-3"
      >
        <ChangePassphraseFacts />
        <FormField
          control={passphraseForm.control}
          name="currentPassphrase"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Current passphrase</FormLabel>
              <FormControl>
                <Input {...field} type="password" disabled={!allowed} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <ChangePassphraseSharedFields
          control={passphraseForm.control}
          allowed={allowed}
        />
        <ChangePassphraseActions
          layout={layout}
          allowed={allowed}
          changing={changing}
          submitLabel={mode.submitLabel}
          onCancel={onCancel}
        />
      </form>
    </Form>
  );
}

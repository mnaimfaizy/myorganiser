import { zodResolver } from '@hookform/resolvers/zod';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, waitFor, within } from '@storybook/test';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import {
  PassphraseUnlockForm,
  type PassphraseUnlockFormProps,
  type PassphraseUnlockValues,
  passphraseUnlockSchema,
} from './PassphraseUnlockForm';

/**
 * The story-level args. The real form is owned by the caller (the vault gate in
 * production), so the wrapper creates it from these args and hands it down.
 */
interface PassphraseUnlockStoryArgs extends Omit<
  PassphraseUnlockFormProps,
  'form'
> {
  /** The passphrase the field starts with. */
  initialPassphrase: string;
  /** An error to show on the field, set the way the gate sets its mismatch error. */
  error?: string;
}

/**
 * Creates the React Hook Form instance the gate would own, with the same
 * resolver, and sets the error through `setError` so the story renders the
 * error exactly as the gate does.
 */
function PassphraseUnlockFormWithForm({
  initialPassphrase,
  error,
  onSubmit,
  unlocking,
}: PassphraseUnlockStoryArgs) {
  const form = useForm<PassphraseUnlockValues>({
    resolver: zodResolver(passphraseUnlockSchema),
    defaultValues: { passphrase: initialPassphrase },
  });

  useEffect(() => {
    if (error) {
      form.setError('passphrase', { type: 'mismatch', message: error });
    }
  }, [error, form]);

  return (
    <PassphraseUnlockForm
      form={form}
      onSubmit={onSubmit}
      unlocking={unlocking}
    />
  );
}

/**
 * The passphrase field, show/hide control, inline error, and Unlock submit.
 *
 * `onSubmit` is the gate's handler. React Hook Form's `handleSubmit` calls
 * `preventDefault` itself, so a submit play does not navigate the test-runner
 * iframe.
 *
 * The wrapper is keyed on its story args: `useForm` reads `defaultValues` once,
 * so changing the initial passphrase or the error in the Controls panel
 * remounts the form instead of leaving a stale value on screen.
 */
const meta: Meta<typeof PassphraseUnlockFormWithForm> = {
  component: PassphraseUnlockForm,
  title: 'Vault/PassphraseUnlockForm',
  tags: ['autodocs'],
  render: (args) => (
    <PassphraseUnlockFormWithForm
      key={`${args.initialPassphrase}|${args.error ?? ''}`}
      {...args}
    />
  ),
  args: {
    initialPassphrase: '',
    error: undefined,
    onSubmit: fn(),
    unlocking: false,
  },
};

export default meta;
type Story = StoryObj<typeof PassphraseUnlockFormWithForm>;

/** Nothing typed yet. The field is masked and the reveal control is unpressed. */
export const Default: Story = {};

/** A passphrase has been typed. The field stays masked until the User reveals it. */
export const Filled: Story = {
  args: {
    initialPassphrase: 'correct horse',
  },
};

/**
 * The gate's answer to a wrong passphrase. The error is the one fixed message
 * from the VaultUnlock artboard, and the typed value stays visible so the User
 * can correct it.
 */
export const WrongPassphrase: Story = {
  args: {
    initialPassphrase: 'wrong horse',
    error: "That passphrase didn't unlock your vault. Nothing was changed.",
  },
};

/**
 * The unlock is in flight. The button shows the busy label and cannot be
 * pressed (`aria-busy`, disabled).
 */
export const Unlocking: Story = {
  args: {
    initialPassphrase: 'correct horse',
    unlocking: true,
  },
};

/**
 * The Unlocking state at phone width, matching the UnlockPhone artboard. The
 * form has no width-dependent rules of its own, so this checks that the full
 * width button and the field fit a phone.
 */
export const UnlockingPhone: Story = {
  args: {
    initialPassphrase: 'correct horse',
    unlocking: true,
  },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
};

/**
 * Show/hide toggles the field between masked and plain text. The control's
 * `aria-pressed` flips with it; its name stays "Show passphrase".
 */
export const RevealToggle: Story = {
  args: {
    initialPassphrase: 'correct horse',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    expect(canvas.getByLabelText('Passphrase')).toHaveAttribute(
      'type',
      'password',
    );
    const show = canvas.getByRole('button', { name: 'Show passphrase' });
    expect(show).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(show);

    await waitFor(() => {
      expect(canvas.getByLabelText('Passphrase')).toHaveAttribute(
        'type',
        'text',
      );
    });
    expect(show).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(show);

    await waitFor(() => {
      expect(canvas.getByLabelText('Passphrase')).toHaveAttribute(
        'type',
        'password',
      );
    });
    expect(
      canvas.getByRole('button', { name: 'Show passphrase' }),
    ).toHaveAttribute('aria-pressed', 'false');
  },
};

/**
 * Typing a passphrase and pressing Unlock calls `onSubmit`. The gate uses that
 * call to start the unlock.
 */
export const SubmitFiresOnSubmit: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByLabelText('Passphrase'), 'correct horse');
    await userEvent.click(canvas.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalled();
    });
  },
};

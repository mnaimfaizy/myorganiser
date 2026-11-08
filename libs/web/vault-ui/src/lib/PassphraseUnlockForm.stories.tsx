import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, waitFor, within } from '@storybook/test';
import { type FormEvent, useState } from 'react';

import {
  PassphraseUnlockForm,
  type PassphraseUnlockFormProps,
} from './PassphraseUnlockForm';

/**
 * Holds the typed passphrase locally so the field can be typed into, as the
 * gate does in production. The spy `onChange` still sees every keystroke.
 */
function PassphraseUnlockFormWithState(props: PassphraseUnlockFormProps) {
  const [value, setValue] = useState(props.value);
  return (
    <PassphraseUnlockForm
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange(next);
      }}
    />
  );
}

/**
 * The passphrase field, show/hide control, inline error, and Unlock submit.
 *
 * `onSubmit` mirrors the gate: the component's contract asks the handler to call
 * `preventDefault`, so the mock does, and a submit play does not navigate the
 * test-runner iframe.
 */
const meta: Meta<typeof PassphraseUnlockForm> = {
  component: PassphraseUnlockForm,
  title: 'Vault/PassphraseUnlockForm',
  tags: ['autodocs'],
  render: (args) => <PassphraseUnlockFormWithState {...args} />,
  args: {
    value: '',
    onChange: fn(),
    onSubmit: fn((event: FormEvent<HTMLFormElement>) => event.preventDefault()),
    error: null,
    unlocking: false,
  },
};

export default meta;
type Story = StoryObj<typeof PassphraseUnlockForm>;

/** Nothing typed yet. The field is masked and the reveal control is unpressed. */
export const Default: Story = {};

/** A passphrase has been typed. The field stays masked until the User reveals it. */
export const Filled: Story = {
  args: {
    value: 'correct horse',
  },
};

/**
 * The gate's answer to a wrong passphrase. The error is the one fixed message
 * from the VaultUnlock artboard, and the typed value stays visible so the User
 * can correct it.
 */
export const WrongPassphrase: Story = {
  args: {
    value: 'wrong horse',
    error: "That passphrase didn't unlock your vault. Nothing was changed.",
  },
};

/**
 * The unlock is in flight. The button shows the busy label and cannot be
 * pressed (`aria-busy`, disabled).
 */
export const Unlocking: Story = {
  args: {
    value: 'correct horse',
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
    value: 'correct horse',
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
    value: 'correct horse',
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

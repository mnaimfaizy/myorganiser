import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from '@storybook/test';
import { useState, type FormEvent } from 'react';

import { PassphraseUnlockForm } from './PassphraseUnlockForm';
import { PasskeyUnlockOption } from './PasskeyUnlockOption';
import { VaultGateFrame } from './VaultGateFrame';

/**
 * The passkey option on the locked unlock screen (ADR 0136). Its divider reads
 * "or use your passphrase", so it only makes sense above the passphrase form;
 * the Composed story shows it in that place.
 */
const meta: Meta<typeof PasskeyUnlockOption> = {
  component: PasskeyUnlockOption,
  title: 'Vault/PasskeyUnlockOption',
  tags: ['autodocs'],
  args: {
    unlocking: false,
    onUnlock: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof PasskeyUnlockOption>;

/**
 * Ready to unlock. Pressing the button calls `onUnlock`; the passphrase form
 * below the divider is the fallback.
 */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Unlock with passkey' }),
    );
    expect(args.onUnlock).toHaveBeenCalledTimes(1);
  },
};

/**
 * The passkey check is in flight. The button shows the busy label, is disabled,
 * and carries `aria-busy`.
 */
export const Unlocking: Story = {
  args: {
    unlocking: true,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Checking your passkey…',
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  },
};

function PasskeyUnlockGate() {
  const [value, setValue] = useState('');
  return (
    <VaultGateFrame
      title="Unlock your vault"
      description="Your tasks are encrypted. Unlock them on this device with your passkey or your passphrase."
    >
      <div className="flex flex-col gap-4.5">
        <PasskeyUnlockOption unlocking={false} onUnlock={() => undefined} />
        <PassphraseUnlockForm
          value={value}
          onChange={setValue}
          onSubmit={(event: FormEvent<HTMLFormElement>) =>
            event.preventDefault()
          }
          error={null}
          unlocking={false}
        />
      </div>
    </VaultGateFrame>
  );
}

/**
 * The option as the locked gate shows it: above the passphrase form, inside the
 * shared frame. The divider is what joins the two paths.
 */
export const ComposedAbovePassphraseForm: Story = {
  render: () => <PasskeyUnlockGate />,
};

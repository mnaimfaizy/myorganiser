import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from '@storybook/test';

import { PasskeyUnlockOffer } from './PasskeyUnlockOffer';

/**
 * The one-time Passkey Unlock offer (ADR 0136). Presentational: the caller
 * decides when it is open and runs the enrolment, so the stories pass mock
 * props and need no session or platform.
 */
const meta: Meta<typeof PasskeyUnlockOffer> = {
  component: PasskeyUnlockOffer,
  title: 'Vault/PasskeyUnlockOffer',
  tags: ['autodocs'],
  args: {
    open: true,
    enrolling: false,
    onAccept: fn(),
    onDecline: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof PasskeyUnlockOffer>;

/**
 * The offer open with both choices. Accepting calls `onAccept`; "Not now"
 * calls `onDecline`.
 */
export const Default: Story = {
  play: async ({ args }) => {
    const body = within(document.body);
    expect(
      body.getByRole('dialog', { name: 'Unlock faster with a passkey?' }),
    ).toBeVisible();

    await userEvent.click(body.getByRole('button', { name: 'Set up passkey' }));
    expect(args.onAccept).toHaveBeenCalledTimes(1);

    await userEvent.click(body.getByRole('button', { name: 'Not now' }));
    expect(args.onDecline).toHaveBeenCalledTimes(1);
  },
};

/**
 * Enrolment in flight. The accept button shows the busy label and both buttons
 * are disabled, so the offer cannot be answered twice.
 */
export const Enrolling: Story = {
  args: {
    enrolling: true,
  },
  play: async () => {
    const body = within(document.body);
    expect(body.getByRole('dialog')).toBeVisible();
    expect(body.getByRole('button', { name: 'Setting up…' })).toBeDisabled();
    expect(body.getByRole('button', { name: 'Not now' })).toBeDisabled();
  },
};

'use client';

import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, waitFor, within } from '@storybook/test';

import { UnacknowledgedRecoveryKeyBanner } from './UnacknowledgedRecoveryKeyBanner';

/**
 * Reminds the User that Recovery Key Acknowledgment was never recorded for this
 * vault. On the locked surface (unlock/recover screen) the fact is shown with
 * no actions; on the unlocked surface the User may rotate or claim they already
 * hold the key.
 *
 * The fact is repeated in an sr-only `role="status"` live region so screen
 * readers announce it when the banner appears — the visible text alone is not
 * announced at mount time.
 */
const meta: Meta<typeof UnacknowledgedRecoveryKeyBanner> = {
  component: UnacknowledgedRecoveryKeyBanner,
  title: 'Vault/UnacknowledgedRecoveryKeyBanner',
  tags: ['autodocs'],
  argTypes: {
    surface: {
      control: 'select',
      options: ['locked', 'unlocked'],
      description:
        'Where the banner is shown — locked (fact only) or unlocked (with actions)',
    },
  },
  args: {
    onAlreadyHaveIt: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof UnacknowledgedRecoveryKeyBanner>;

/**
 * Locked unlock/recover screen: the warning fact only, with no Rotate link,
 * no "I already have it" action, and no dismissal. Deliberately unclearable —
 * it does not gate unlock.
 */
export const Locked: Story = {
  args: {
    surface: 'locked',
  },
};

/**
 * Unlocked vault session: the same fact plus a Rotate recovery key link and an
 * "I already have it" button that opens a confirmation dialog.
 */
export const Unlocked: Story = {
  args: {
    surface: 'unlocked',
    rotateHref: '/dashboard/vault',
  },
};

/**
 * The confirmation dialog shown after clicking "I already have it". Dialog
 * content is portalled to document.body, so a play function opens it for the
 * interaction test-runner.
 */
export const ConfirmationDialogOpen: Story = {
  args: {
    surface: 'unlocked',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'I already have it' }),
    );
    await waitFor(() => {
      expect(
        within(document.body).getByRole('dialog', {
          name: "You already have this vault's recovery key?",
        }),
      ).toBeVisible();
    });
  },
};

/**
 * The fact string is fixed-length (~90 characters). On a narrow viewport it
 * wraps within the icon row without truncation. Locked surface isolates the
 * fact layout from the action buttons below.
 */
export const FactWrapsOnNarrowViewport: Story = {
  args: {
    surface: 'locked',
  },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
};

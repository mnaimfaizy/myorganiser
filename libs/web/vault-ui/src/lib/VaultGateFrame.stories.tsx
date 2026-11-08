import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '@myorganiser/web-ui';

import { RecoveryKeyClaimOffer } from './RecoveryKeyClaimOffer';
import { VaultGateFrame } from './VaultGateFrame';

/**
 * The shared frame for gate screens that ask something of the User: the vault
 * illustration, the h1, an optional description, the screen's content, and an
 * optional footer below a hairline. Presentational only, so the children here
 * are a stand-in for the screen's own form.
 */
const meta: Meta<typeof VaultGateFrame> = {
  component: VaultGateFrame,
  title: 'Vault/VaultGateFrame',
  tags: ['autodocs'],
  args: {
    title: 'Unlock your vault',
    children: (
      <Button variant="brand" className="w-full">
        Unlock
      </Button>
    ),
  },
};

export default meta;
type Story = StoryObj<typeof VaultGateFrame>;

/**
 * The full frame as the VaultUnlock artboard shows it: description under the
 * h1, the screen's content, and the Recovery Key Claim Offer in the footer.
 */
export const Default: Story = {
  args: {
    description:
      'Your tasks are encrypted. Enter your passphrase to open them on this device.',
    footer: <RecoveryKeyClaimOffer onClaim={async () => 'no-match'} />,
  },
};

/**
 * The optional description and footer are both omitted. Only the illustration,
 * the h1, and the content remain.
 */
export const TitleOnly: Story = {};

/**
 * The same full frame at phone width. Below md the header group is centred,
 * matching the UnlockPhone artboard. The desktop Default shows it left-aligned.
 */
export const Phone: Story = {
  args: {
    description:
      'Your tasks are encrypted. Enter your passphrase to open them on this device.',
    footer: <RecoveryKeyClaimOffer onClaim={async () => 'no-match'} />,
  },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
};

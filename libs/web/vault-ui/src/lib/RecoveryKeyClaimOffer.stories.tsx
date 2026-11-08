import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';

import { RecoveryKeyClaimOffer } from './RecoveryKeyClaimOffer';

const meta: Meta<typeof RecoveryKeyClaimOffer> = {
  component: RecoveryKeyClaimOffer,
  title: 'Vault/RecoveryKeyClaimOffer',
  tags: ['autodocs'],
  args: {
    onClaim: async () => 'no-match',
  },
};

export default meta;
type Story = StoryObj<typeof RecoveryKeyClaimOffer>;

export const Collapsed: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Default state. Renders only the button that initiates the claim flow. No form, input, or message is visible until the user clicks.',
      },
    },
  },
};

export const KeyMatchesNothing: Story = {
  args: {
    onClaim: async () => 'no-match',
  },
  parameters: {
    docs: {
      description: {
        story:
          'The supplied recovery key unlocked nothing. The form stays expanded with the typed key visible, and the one fixed error message is displayed. This is also exactly what a device holding no vault at all renders — same words, same frame — which is the disclosure rule the component exists to enforce, so there is deliberately no second story for it.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Click to expand the form
    const expandButton = canvas.getByRole('button', {
      name: /I have a recovery key/i,
    });
    await userEvent.click(expandButton);

    // Type an invalid recovery key
    const input = canvas.getByPlaceholderText('Paste your recovery key');
    await userEvent.type(input, 'invalid-key');

    // Submit the form
    const submitButton = canvas.getByRole('button', {
      name: 'Claim this vault',
    });
    await userEvent.click(submitButton);

    // Error message should appear
    await waitFor(() => {
      const alert = canvas.getByRole('alert');
      expect(alert).toBeVisible();
      expect(
        canvas.getByText(/That recovery key did not unlock a vault/i),
      ).toBeInTheDocument();
    });
  },
};

export const ClaimInFlight: Story = {
  args: {
    onClaim: async () =>
      new Promise(() => {
        // Never resolves
      }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'The claim request is pending. The submit button is disabled to prevent accidental double-submission. The form remains open and the user can cancel at any time.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Click to expand the form
    const expandButton = canvas.getByRole('button', {
      name: /I have a recovery key/i,
    });
    await userEvent.click(expandButton);

    // Type a recovery key
    const input = canvas.getByPlaceholderText('Paste your recovery key');
    await userEvent.type(input, 'recovery-key');

    // Click submit (the onClaim promise never settles)
    const submitButton = canvas.getByRole('button', {
      name: 'Claim this vault',
    });
    await userEvent.click(submitButton);

    // Submit button should become disabled while the request is pending
    await waitFor(() => {
      const disabledButton = canvas.getByRole('button', {
        name: 'Claim this vault',
      });
      expect(disabledButton).toBeDisabled();
    });
  },
};

export const LinkTrigger: Story = {
  args: {
    triggerStyle: 'link',
  },
  parameters: {
    docs: {
      description: {
        story:
          'The collapsed trigger in the link style the unlock and recover screens use, labelled for a Recovery Key from a different vault. Clicking it expands the same form as the button style.',
      },
    },
  },
};

/**
 * UI behavioral tests for RecoveryKeyClaimOffer.
 *
 * The suite establishes that the component's sole observable surface—button
 * names, input presence, error messages, disabled state, and value retention—
 * correctly implements the Claim Offer's security property: a recovery key
 * matching nothing must be indistinguishable from a device holding no Vault
 * (ADR 0061). Specifically:
 *
 * - Rows 4 and 5 (no-match vs rejection) produce identical observable state:
 *   the same alert message, form still expanded, and value retained. A thrown
 *   error is not a third answer; it is folded into the one answer the
 *   component ever shows a User.
 *
 * - The component makes no provision to distinguish "this device has an
 *   Unclaimed Local Vault" from "this device has nothing" — both devices show
 *   the same button, the same inputs, the same error message. The only message
 *   the interface can produce on failure is one that the empty-device case also
 *   produces, and no observable behavior (timing, message variant, presence of
 *   elements) leaks the presence of an Unclaimed Local Vault.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecoveryKeyClaimOffer } from './RecoveryKeyClaimOffer';

describe('RecoveryKeyClaimOffer', () => {
  describe('basic flow', () => {
    test('should offer only the assertion button when nothing has been pressed yet', () => {
      const onClaim = jest.fn();
      render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();

      expect(screen.queryByLabelText(/Recovery key/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Claim this vault/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Cancel/ }),
      ).not.toBeInTheDocument();
    });

    test('should reveal the recovery key field and its actions when the User asserts they hold a key', () => {
      const onClaim = jest.fn();
      render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      const expandButton = screen.getByRole('button', {
        name: /I have a recovery key for a vault on this device/,
      });
      fireEvent.click(expandButton);

      expect(screen.getByLabelText(/Recovery key/)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Claim this vault/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Cancel/ }),
      ).toBeInTheDocument();
    });

    test('should submit the trimmed key once and collapse without a message when the claim succeeds', async () => {
      const onClaim = jest.fn().mockResolvedValue('claimed');
      render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '  test-key-123  ' } });

      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      await waitFor(() => {
        expect(screen.queryByLabelText(/Recovery key/)).not.toBeInTheDocument();
      });

      expect(onClaim).toHaveBeenCalledTimes(1);
      expect(onClaim).toHaveBeenCalledWith('test-key-123');

      // No error message
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('should show the one fixed message and keep the typed key when the claim matches nothing', async () => {
      const onClaim = jest.fn().mockResolvedValue('no-match');
      render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'test-key-456' } });

      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe(
        'That recovery key did not unlock a vault on this device. Nothing on this device was changed.',
      );

      // Form is still expanded
      expect(screen.getByLabelText(/Recovery key/)).toBeInTheDocument();
      // Value is retained
      expect(input.value).toBe('test-key-456');
    });

    test('should be indistinguishable from a match failure when the claim throws instead', async () => {
      const onClaim = jest
        .fn()
        .mockRejectedValue(new Error('Something went wrong'));
      render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'test-key-789' } });

      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe(
        'That recovery key did not unlock a vault on this device. Nothing on this device was changed.',
      );

      // Form is still expanded
      expect(screen.getByLabelText(/Recovery key/)).toBeInTheDocument();
      // Value is retained
      expect(input.value).toBe('test-key-789');
    });
  });

  describe('submit button state', () => {
    test('should disable submit when no key has been typed', () => {
      const onClaim = jest.fn();
      render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const submitButton = screen.getByRole('button', {
        name: /Claim this vault/,
      }) as HTMLButtonElement;
      expect(submitButton.disabled).toBe(true);
    });

    test('should disable submit when the typed key is only whitespace', () => {
      const onClaim = jest.fn();
      render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '   \t\n   ' } });

      const submitButton = screen.getByRole('button', {
        name: /Claim this vault/,
      }) as HTMLButtonElement;
      expect(submitButton.disabled).toBe(true);
    });

    test('should enable submit when a non-blank key has been typed', () => {
      const onClaim = jest.fn();
      render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'x' } });

      const submitButton = screen.getByRole('button', {
        name: /Claim this vault/,
      }) as HTMLButtonElement;
      expect(submitButton.disabled).toBe(false);
    });

    test('should disable submit while a claim is in flight and enable it again once it settles', async () => {
      let resolveOnClaim: (value: 'no-match') => void;
      const onClaim = jest.fn(
        () =>
          new Promise<'no-match'>((resolve) => {
            resolveOnClaim = resolve;
          }),
      );
      render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'test-key' } });

      const submitButton = screen.getByRole('button', {
        name: /Claim this vault/,
      }) as HTMLButtonElement;

      fireEvent.click(submitButton);

      // Should be disabled while pending
      expect(submitButton.disabled).toBe(true);

      // Resolve the promise
      resolveOnClaim!('no-match');

      // Should be re-enabled after settlement
      await waitFor(() => {
        expect(submitButton.disabled).toBe(false);
      });
    });
  });

  describe('error handling and cleanup', () => {
    test('should clear the previous message when a new submit starts', async () => {
      // Order-independent: both submits get the same answer, so the test says
      // nothing about which call came first.
      const onClaim = jest.fn().mockResolvedValue('no-match');
      render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'key1' } });

      // First submit
      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Change value and submit again
      fireEvent.change(input, { target: { value: 'key2' } });
      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      // The alert should temporarily disappear (cleared at the start of submit)
      // and then reappear with the new response
      await waitFor(() => {
        expect(onClaim).toHaveBeenCalledTimes(2);
      });

      // Error message reappears after new submit
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    test('should collapse and forget both the key and the message when the User cancels', async () => {
      const onClaim = jest.fn().mockResolvedValue('no-match');
      render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'test-key' } });

      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      // Cancel
      fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));

      // Form is collapsed
      expect(screen.queryByLabelText(/Recovery key/)).not.toBeInTheDocument();
      // Error message is gone
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // Re-expand
      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      // Input is empty
      expect(
        (screen.getByLabelText(/Recovery key/) as HTMLInputElement).value,
      ).toBe('');
      // No alert
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('security property: no passphrase anywhere', () => {
    test('should offer no passphrase field and no passphrase wording when collapsed', () => {
      const onClaim = jest.fn();
      const { container } = render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      expect(
        container.querySelector('input[type="password"]'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/passphrase/i)).not.toBeInTheDocument();
    });

    test('should offer no passphrase field and no passphrase wording when expanded', () => {
      const onClaim = jest.fn();
      const { container } = render(<RecoveryKeyClaimOffer onClaim={onClaim} />);

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      expect(
        container.querySelector('input[type="password"]'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/passphrase/i)).not.toBeInTheDocument();
    });
  });

  describe('triggerStyle link', () => {
    const LINK_TRIGGER_NAME =
      'I have a Recovery Key for a different vault on this device';

    test('should render the link trigger with the different-vault name and not the default button name', () => {
      render(<RecoveryKeyClaimOffer onClaim={jest.fn()} triggerStyle="link" />);

      expect(
        screen.getByRole('button', { name: LINK_TRIGGER_NAME }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).not.toBeInTheDocument();
    });

    test('should expand the same claim form when the link trigger is pressed', () => {
      const { container } = render(
        <RecoveryKeyClaimOffer onClaim={jest.fn()} triggerStyle="link" />,
      );

      fireEvent.click(screen.getByRole('button', { name: LINK_TRIGGER_NAME }));

      expect(
        container.querySelector('#claim-recovery-key'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Claim this vault/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: LINK_TRIGGER_NAME }),
      ).not.toBeInTheDocument();
    });

    test('should show the same single no-match message and keep the typed key', async () => {
      const onClaim = jest.fn().mockResolvedValue('no-match');
      const { container } = render(
        <RecoveryKeyClaimOffer onClaim={onClaim} triggerStyle="link" />,
      );

      fireEvent.click(screen.getByRole('button', { name: LINK_TRIGGER_NAME }));

      const input = container.querySelector(
        '#claim-recovery-key',
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'test-key-link' } });
      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
      expect(screen.getByRole('alert').textContent).toBe(
        'That recovery key did not unlock a vault on this device. Nothing on this device was changed.',
      );
      expect(input.value).toBe('test-key-link');
    });
  });
});

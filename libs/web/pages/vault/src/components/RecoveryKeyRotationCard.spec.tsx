/* eslint-disable import/first -- jest.mock must precede application imports */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Mock the utils before importing RecoveryKeyRotationCard.
 */
jest.mock('../utils', () => ({
  downloadTextFile: jest.fn(),
}));

/**
 * Mock useVaultDisabledState at its module path so the real useVaultOperationAvailability
 * (which imports it from the same file) will use the mock when it calls useVaultDisabledState().
 */
jest.mock('../hooks/useVaultDisabledState', () => ({
  useVaultDisabledState: jest.fn(),
}));

/**
 * Mock the hooks from ../hooks before importing RecoveryKeyRotationCard.
 * Include the real useVaultOperationAvailability so the policy table is tested.
 */
jest.mock('../hooks', () => {
  const actual = jest.requireActual('../hooks');
  return {
    ...actual,
    useRecoveryKeyRotation: jest.fn(),
  };
});

/**
 * Mock web-vault-ui hooks and components.
 * Use requireActual to get the real ServerReachabilityNotice component
 * and only override the hooks we need to control.
 */
jest.mock('@myorganiser/web-vault-ui', () => ({
  ...jest.requireActual('@myorganiser/web-vault-ui'),
  useOptionalVaultSession: jest.fn(),
  useServerReachability: jest.fn(),
}));

/**
 * Mock web-vault functions.
 */
jest.mock('@myorganiser/web-vault', () => ({
  ...jest.requireActual('@myorganiser/web-vault'),
  mintRecoveryKey: jest.fn(),
}));

/**
 * Mock web-ui components and useToast.
 * Spread actual to get cn, the real Dialog primitives and other utilities,
 * then override components.
 */
jest.mock('@myorganiser/web-ui', () => {
  const actual = jest.requireActual('@myorganiser/web-ui');
  const React = require('react') as typeof import('react');
  const {
    Controller,
    FormProvider,
    useFormContext,
  } = require('react-hook-form');

  function Button({
    children,
    onClick,
    disabled,
    'data-testid': testId,
    ...props
  }: any) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        data-testid={testId}
        {...props}
      >
        {children}
      </button>
    );
  }

  function Card({ children }: any) {
    return <div data-testid="card">{children}</div>;
  }

  function CardHeader({ children }: any) {
    return <div>{children}</div>;
  }

  function CardTitle({ children }: any) {
    return <h2>{children}</h2>;
  }

  function CardDescription({ children }: any) {
    return <p>{children}</p>;
  }

  function CardContent({ children }: any) {
    return <div>{children}</div>;
  }

  function Form({ children, ...props }: any) {
    return <FormProvider {...props}>{children}</FormProvider>;
  }

  // Create a context to track which field a FormMessage belongs to
  const FormFieldContext = React.createContext<{ fieldName?: string }>({});

  function FormField({ name, render, ...props }: any) {
    return (
      <FormFieldContext.Provider value={{ fieldName: name }}>
        <Controller name={name} render={render} {...props} />
      </FormFieldContext.Provider>
    );
  }

  function FormItem({ children, ...props }: any) {
    return <div {...props}>{children}</div>;
  }

  function FormLabel({ children, htmlFor }: any) {
    return <label htmlFor={htmlFor}>{children}</label>;
  }

  function FormControl({ children, ...props }: any) {
    return <div {...props}>{children}</div>;
  }

  function FormDescription({ children }: any) {
    return <p data-testid="form-description">{children}</p>;
  }

  function FormMessage({ children }: any) {
    const formContext = useFormContext();
    const fieldContext = React.useContext(FormFieldContext);

    // Get the error for this specific field if we know which field we're in
    const fieldError = fieldContext?.fieldName
      ? (formContext?.formState.errors as any)?.[fieldContext.fieldName]
      : null;

    return (
      <div data-testid="form-message">
        {children}
        {fieldError?.message ? <div>{fieldError.message}</div> : null}
      </div>
    );
  }

  function Input({ type, disabled, id, ...props }: any) {
    return <input type={type} disabled={disabled} id={id} {...props} />;
  }

  function Label({ children, htmlFor }: any) {
    return <label htmlFor={htmlFor}>{children}</label>;
  }

  return {
    ...actual,
    Button,
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    Form,
    FormField,
    FormItem,
    FormLabel,
    FormControl,
    FormDescription,
    FormMessage,
    Input,
    Label,
    useToast: jest.fn(),
  };
});

import { RecoveryKeyRotationCard } from './RecoveryKeyRotationCard';
import type { VaultHandle } from '@myorganiser/web-vault';
import {
  mintRecoveryKey,
  type MintedRecoveryKey,
} from '@myorganiser/web-vault';
import {
  useOptionalVaultSession,
  useServerReachability,
  SERVER_REACHABILITY_READINGS,
} from '@myorganiser/web-vault-ui';
import { useToast } from '@myorganiser/web-ui';
import { useRecoveryKeyRotation } from '../hooks';
import { useVaultDisabledState } from '../hooks/useVaultDisabledState';
import { downloadTextFile } from '../utils';

// === Mock helpers ===

function createMockHandle(overrides?: Partial<VaultHandle>): VaultHandle {
  const base: VaultHandle = {
    owner: 'test-owner',
    isUnlocked: false,
    hasVault: jest.fn().mockReturnValue(true),
    hasOwnedVault: jest.fn().mockReturnValue(true),
    loadVault: jest.fn().mockReturnValue(null),
    saveVault: jest.fn(),
    removeVault: jest.fn(),
    initialize: jest.fn(),
    unlockWithPassphrase: jest.fn(),
    unlockWithRecoveryKey: jest.fn(),
    changePassphrase: jest.fn(),
    resetPassphrase: jest.fn(),
    rotateRecoveryKey: jest.fn(),
    loadDecryptedData: jest.fn(),
    saveEncryptedData: jest.fn(),
    vaultStatus: jest.fn().mockReturnValue('absent'),
    hasUnclaimedLocalVault: jest.fn().mockReturnValue(false),
    claimUnclaimedLocalVaultLocked: jest.fn(),
    loadUnclaimedVault: jest.fn().mockReturnValue(null),
    claimUnclaimedLocalVaultByRecoveryKey: jest.fn(),
    replaceOwnedLocalVaultWithUnclaimedLocked: jest.fn(),
    replaceOwnedLocalVaultWithUnclaimedByRecoveryKey: jest.fn(),
    hasUnsentChanges: jest.fn().mockResolvedValue(false),
    lastPushedEtag: jest.fn().mockReturnValue(undefined),
    recordPushSuccess: jest.fn(),
    lastAgreedVaultMetaHash: jest.fn().mockReturnValue(undefined),
    recordVaultMetaAgreement: jest.fn(),
    observedVaultIdentity: jest.fn().mockReturnValue(undefined),
    recordObservedVaultIdentity: jest.fn(),
    isVaultMetaRefused: jest.fn().mockResolvedValue(false),
    recordVaultMetaRefusal: jest.fn(),
    isRecoveryKeyUnacknowledged: jest.fn().mockResolvedValue(false),
    recordUnacknowledgedRecoveryKey: jest.fn(),
    acknowledgeRecoveryKey: jest.fn(),
    forgetSyncBookmarks: jest.fn(),
    decryptCiphertext: jest.fn(),
  };
  return { ...base, ...overrides };
}

/** The card shows only the summary and an opener; the form lives in the dialog. */
function openRotationDialog() {
  fireEvent.click(screen.getByTestId('recovery-key-rotation-open'));
}

function renderCardOpen() {
  render(<RecoveryKeyRotationCard />);
  openRotationDialog();
}

describe('RecoveryKeyRotationCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    (useVaultDisabledState as jest.Mock).mockReturnValue('enabled');
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({ loadVault: jest.fn().mockReturnValue({}) }),
      masterKeyBytes: new Uint8Array(32),
    });
    (useServerReachability as jest.Mock).mockReturnValue({
      reachability: 'reachable',
      recheck: jest.fn(),
    });
    (useToast as jest.Mock).mockReturnValue({ toast: jest.fn() });
    (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
      rotating: false,
      rotateRecoveryKey: jest.fn(),
    });
    (mintRecoveryKey as jest.Mock).mockReturnValue(
      'MOCKED-RECOVERY-KEY-VALUE' as unknown as MintedRecoveryKey,
    );

    // Stub navigator.clipboard for copy tests
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Visibility — disabled-state ladder', () => {
    test('1: no session/handle → card renders, opener disabled, shows "Your vault is not available on this device right now.", no form in the DOM', () => {
      (useVaultDisabledState as jest.Mock).mockReturnValue('signed-out');

      render(<RecoveryKeyRotationCard />);

      expect(screen.getByTestId('card')).toBeInTheDocument();
      expect(screen.getByTestId('recovery-key-rotation-open')).toBeDisabled();
      expect(
        screen.getByText(
          'Your vault is not available on this device right now.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('recovery-key-rotation-mint'),
      ).not.toBeInTheDocument();
    });

    test('2: handle present, loadVault() returns null → opener disabled, shows "Set up a local vault…", no form in the DOM', () => {
      (useVaultDisabledState as jest.Mock).mockReturnValue('no-local-vault');

      render(<RecoveryKeyRotationCard />);

      expect(screen.getByTestId('card')).toBeInTheDocument();
      expect(screen.getByTestId('recovery-key-rotation-open')).toBeDisabled();
      expect(
        screen.getByText(
          'Set up a local vault on this device to rotate its recovery key.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('recovery-key-rotation-mint'),
      ).not.toBeInTheDocument();
    });

    test('3: handle present, masterKeyBytes === null (locked), vault exists → opener disabled, shows "Unlock your vault…", no form in the DOM', () => {
      (useVaultDisabledState as jest.Mock).mockReturnValue('locked');

      render(<RecoveryKeyRotationCard />);

      expect(screen.getByTestId('card')).toBeInTheDocument();
      expect(screen.getByTestId('recovery-key-rotation-open')).toBeDisabled();
      expect(
        screen.getByText('Unlock your vault to rotate its recovery key.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('recovery-key-rotation-mint'),
      ).not.toBeInTheDocument();
    });

    test('4: handle and masterKeyBytes present → opener enabled, no unavailability message; inside the dialog the mint button is disabled until a passphrase is entered', () => {
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: createMockHandle({ loadVault: jest.fn().mockReturnValue({}) }),
        masterKeyBytes: new Uint8Array(32),
      });

      render(<RecoveryKeyRotationCard />);

      expect(screen.getByTestId('card')).toBeInTheDocument();
      expect(screen.getByTestId('recovery-key-rotation-open')).toBeEnabled();
      // Assert no ladder message is shown (already unlocked)
      expect(
        screen.queryByText('Your vault is not available'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Set up a local vault'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Unlock your vault')).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('recovery-key-rotation-unavailable'),
      ).not.toBeInTheDocument();

      openRotationDialog();

      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      expect(mintButton).toBeDisabled();
    });
  });

  describe('Static copy — rendering in enabled state', () => {
    test('5: dialog renders reassurance paragraph and paragraph mentioning Export encrypted vault on the Vault page', () => {
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: createMockHandle({ loadVault: jest.fn().mockReturnValue({}) }),
        masterKeyBytes: new Uint8Array(32),
      });

      renderCardOpen();

      // Paragraph 1: minting does not write anything
      expect(
        screen.getByText(
          /Generating a new recovery key does not change anything by itself — nothing is written until you confirm you have it\./,
        ),
      ).toBeInTheDocument();

      // Paragraph 2: Export saved before rotating still opens with old key
      expect(
        screen.getByText(
          /A Vault Export you saved before rotating still opens with your old recovery key — see "Export encrypted vault" on the Vault page\./,
        ),
      ).toBeInTheDocument();
    });

    test("5a: the passphrase field label is distinct from the passphrase card's", () => {
      renderCardOpen();

      // ChangePassphraseCard renders "Current passphrase" and sits on the same
      // Vault page. Two identically-labelled password fields give a screen
      // reader user no way to tell which authorizes a passphrase change and
      // which authorizes a rotation — and it broke the Playwright spec with a
      // strict-mode violation. Pinned here so a revert fails in Jest rather
      // than only in the browser.
      // Queried as text, not by label association: this spec mocks
      // `@myorganiser/web-ui`, and the mocked FormLabel/Input do not wire
      // `htmlFor`/`id` the way the real primitives do. The association itself
      // is real in the browser and is what the Playwright spec relies on.
      expect(
        screen.getByText('Passphrase to authorize this rotation'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Current passphrase')).toBeNull();
    });
  });

  describe('Point of no return — minting', () => {
    test('6: fill passphrase, click mint, minted key displays, rotateRecoveryKey never called', async () => {
      const mockRotateRecoveryKey = jest.fn();
      (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
        rotating: false,
        rotateRecoveryKey: mockRotateRecoveryKey,
      });

      renderCardOpen();

      // Fill the passphrase field (should be a password field)
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });

      // Click mint button
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for the key display to appear
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-key'),
        ).toBeInTheDocument();
      });

      // Assert the minted key is displayed
      const keyDisplay = screen.getByTestId(
        'recovery-key-rotation-key',
      ) as HTMLInputElement;
      expect(keyDisplay.value).toBe('MOCKED-RECOVERY-KEY-VALUE');

      // Assert rotateRecoveryKey was never called just from minting
      expect(mockRotateRecoveryKey).not.toHaveBeenCalled();
    });
  });

  describe('Paste-back gate', () => {
    test('7: after minting, submit disabled with empty confirm field', async () => {
      renderCardOpen();

      // Fill and submit passphrase to mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for key display and confirm field
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-confirm'),
        ).toBeInTheDocument();
      });

      // Assert submit button is disabled with empty confirm field
      const submitButton = screen.getByTestId('recovery-key-rotation-submit');
      expect(submitButton).toBeDisabled();
    });

    test('8: after minting, submit disabled with wrong/partial value in confirm field', async () => {
      renderCardOpen();

      // Fill and submit passphrase to mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for confirm field
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-confirm'),
        ).toBeInTheDocument();
      });

      // Type wrong value in confirm field
      const confirmInput = screen.getByTestId(
        'recovery-key-rotation-confirm',
      ) as HTMLInputElement;
      fireEvent.change(confirmInput, { target: { value: 'wrong-value' } });

      // Assert submit is still disabled
      const submitButton = screen.getByTestId('recovery-key-rotation-submit');
      expect(submitButton).toBeDisabled();
    });

    test('9: after minting, submit enabled only when confirm matches minted key exactly', async () => {
      renderCardOpen();

      // Fill and submit passphrase to mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for confirm field
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-confirm'),
        ).toBeInTheDocument();
      });

      // Type correct value in confirm field
      const confirmInput = screen.getByTestId(
        'recovery-key-rotation-confirm',
      ) as HTMLInputElement;
      fireEvent.change(confirmInput, {
        target: { value: 'MOCKED-RECOVERY-KEY-VALUE' },
      });

      // Assert submit is now enabled
      const submitButton = screen.getByTestId('recovery-key-rotation-submit');
      expect(submitButton).not.toBeDisabled();
    });
  });

  describe('Confirm-key validation', () => {
    test('9a: after minting, typing fewer characters than minted key should NOT show mismatch error', async () => {
      renderCardOpen();

      // Fill and mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for confirm field
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-confirm'),
        ).toBeInTheDocument();
      });

      // Type a partial value that doesn't match (e.g., first 15 chars of a 26-char key)
      const confirmInput = screen.getByTestId(
        'recovery-key-rotation-confirm',
      ) as HTMLInputElement;
      fireEvent.change(confirmInput, { target: { value: 'WRONG-VALUE-TOO' } }); // 15 chars, less than 26

      // Assert that no error message is shown
      // The FormMessage should not contain the mismatch error
      const formMessages = screen.getAllByTestId('form-message');
      const hasError = formMessages.some((msg) =>
        msg.textContent?.includes('Recovery key does not match'),
      );
      expect(hasError).toBe(false);
    });

    test('9b: after minting, typing at least as many characters as minted key that do NOT match SHOULD show mismatch error', async () => {
      renderCardOpen();

      // Fill and mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for confirm field
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-confirm'),
        ).toBeInTheDocument();
      });

      // Type a value that is at least as long as the minted key but doesn't match
      // Minted key is 26 chars ('MOCKED-RECOVERY-KEY-VALUE')
      const confirmInput = screen.getByTestId(
        'recovery-key-rotation-confirm',
      ) as HTMLInputElement;
      fireEvent.change(confirmInput, {
        target: { value: 'WRONG-VALUE-THAT-IS-LONG-ENOUGH' }, // 31 chars
      });

      // Assert that the mismatch error IS shown
      await waitFor(() => {
        expect(
          screen.getByText(
            'Recovery key does not match. Check that you pasted it correctly.',
          ),
        ).toBeInTheDocument();
      });
    });

    test('9c: after minting with mismatch error shown, correcting to exact match clears the error', async () => {
      renderCardOpen();

      // Fill and mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for confirm field
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-confirm'),
        ).toBeInTheDocument();
      });

      // Type a wrong value first (long enough to trigger error)
      const confirmInput = screen.getByTestId(
        'recovery-key-rotation-confirm',
      ) as HTMLInputElement;
      fireEvent.change(confirmInput, {
        target: { value: 'WRONG-VALUE-THAT-IS-LONG-ENOUGH' },
      });

      // Assert the error is shown
      await waitFor(() => {
        expect(
          screen.getByText(
            'Recovery key does not match. Check that you pasted it correctly.',
          ),
        ).toBeInTheDocument();
      });

      // Now correct to the exact match
      fireEvent.change(confirmInput, {
        target: { value: 'MOCKED-RECOVERY-KEY-VALUE' },
      });

      // Assert that the error is cleared
      await waitFor(() => {
        expect(
          screen.queryByText(
            'Recovery key does not match. Check that you pasted it correctly.',
          ),
        ).not.toBeInTheDocument();
      });

      // Also assert that submit is now enabled with the correct value
      const submitButton = screen.getByTestId('recovery-key-rotation-submit');
      expect(submitButton).not.toBeDisabled();
    });
  });

  describe('Abandonment', () => {
    test('10: after minting, click cancel, dialog closes, key display and confirm field no longer shown, rotateRecoveryKey never called', async () => {
      const mockRotateRecoveryKey = jest.fn();
      (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
        rotating: false,
        rotateRecoveryKey: mockRotateRecoveryKey,
      });

      renderCardOpen();

      // Fill and submit passphrase to mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for key display
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-key'),
        ).toBeInTheDocument();
      });

      // Click cancel
      const cancelButton = screen.getByTestId('recovery-key-rotation-cancel');
      fireEvent.click(cancelButton);

      // Assert the dialog closed, so key display and confirm field are no longer shown
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      expect(
        screen.queryByTestId('recovery-key-rotation-key'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('recovery-key-rotation-confirm'),
      ).not.toBeInTheDocument();

      // Assert rotateRecoveryKey was never called
      expect(mockRotateRecoveryKey).not.toHaveBeenCalled();
    });

    test('10a: after Cancel with a minted key, reopening shows a fresh form: empty passphrase, no minted key, mint disabled', async () => {
      renderCardOpen();

      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );
      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      fireEvent.click(screen.getByTestId('recovery-key-rotation-mint'));

      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-key'),
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('recovery-key-rotation-cancel'));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      openRotationDialog();

      expect(
        screen.queryByTestId('recovery-key-rotation-key'),
      ).not.toBeInTheDocument();
      const reopenedPassphrase = screen
        .getAllByDisplayValue('')
        .find(
          (input): input is HTMLInputElement =>
            input instanceof HTMLInputElement && input.type === 'password',
        );
      expect(reopenedPassphrase!.value).toBe('');
      expect(screen.getByTestId('recovery-key-rotation-mint')).toBeDisabled();
    });
  });

  describe('Commit — success', () => {
    test('11: mint, fill confirm, submit success → rotateRecoveryKey called with correct params, state reset', async () => {
      const mockRotateRecoveryKey = jest.fn().mockResolvedValue('ok');
      (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
        rotating: false,
        rotateRecoveryKey: mockRotateRecoveryKey,
      });

      renderCardOpen();

      // Fill and mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for confirm field
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-confirm'),
        ).toBeInTheDocument();
      });

      // Fill confirm field and submit
      const confirmInput = screen.getByTestId(
        'recovery-key-rotation-confirm',
      ) as HTMLInputElement;
      fireEvent.change(confirmInput, {
        target: { value: 'MOCKED-RECOVERY-KEY-VALUE' },
      });

      const submitButton = screen.getByTestId('recovery-key-rotation-submit');
      fireEvent.click(submitButton);

      // Wait for the hook to be called
      await waitFor(() => {
        expect(mockRotateRecoveryKey).toHaveBeenCalledWith({
          currentPassphrase: 'testpass1234',
          recoveryKey: 'MOCKED-RECOVERY-KEY-VALUE',
        });
      });

      // Assert the reveal UI is cleared after success
      await waitFor(() => {
        expect(
          screen.queryByTestId('recovery-key-rotation-key'),
        ).not.toBeInTheDocument();
      });
    });

    test('11a: successful rotation closes the dialog and leaves the opener enabled', async () => {
      const mockRotateRecoveryKey = jest.fn().mockResolvedValue('ok');
      (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
        rotating: false,
        rotateRecoveryKey: mockRotateRecoveryKey,
      });

      renderCardOpen();

      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );
      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      fireEvent.click(screen.getByTestId('recovery-key-rotation-mint'));

      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-confirm'),
        ).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId('recovery-key-rotation-confirm'), {
        target: { value: 'MOCKED-RECOVERY-KEY-VALUE' },
      });
      fireEvent.click(screen.getByTestId('recovery-key-rotation-submit'));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      expect(
        screen.queryByTestId('recovery-key-rotation-submit'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('recovery-key-rotation-open')).toBeEnabled();
    });
  });

  describe('Commit — wrong passphrase', () => {
    test('12: rotateRecoveryKey returns "wrong-passphrase" → field error shown, key/confirm still visible', async () => {
      const mockRotateRecoveryKey = jest
        .fn()
        .mockResolvedValue('wrong-passphrase');
      (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
        rotating: false,
        rotateRecoveryKey: mockRotateRecoveryKey,
      });

      renderCardOpen();

      // Fill and mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, {
        target: { value: 'wrongpass1234' },
      });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for confirm field
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-confirm'),
        ).toBeInTheDocument();
      });

      // Fill confirm and submit
      const confirmInput = screen.getByTestId(
        'recovery-key-rotation-confirm',
      ) as HTMLInputElement;
      fireEvent.change(confirmInput, {
        target: { value: 'MOCKED-RECOVERY-KEY-VALUE' },
      });

      const submitButton = screen.getByTestId('recovery-key-rotation-submit');
      fireEvent.click(submitButton);

      // Wait for the hook to be called
      await waitFor(() => {
        expect(mockRotateRecoveryKey).toHaveBeenCalled();
      });

      // Assert key display and confirm field are still shown (nothing was written)
      expect(
        screen.getByTestId('recovery-key-rotation-key'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('recovery-key-rotation-confirm'),
      ).toBeInTheDocument();

      // Assert the error message is visible
      await waitFor(() => {
        expect(
          screen.getByText('That is not your current passphrase.'),
        ).toBeInTheDocument();
      });
    });
  });

  describe('Commit — hook error', () => {
    test('12a: rotateRecoveryKey returns "error" → hook already toasted, dialog stays open with key and confirm still shown, onDone not run', async () => {
      const mockRotateRecoveryKey = jest.fn().mockResolvedValue('error');
      (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
        rotating: false,
        rotateRecoveryKey: mockRotateRecoveryKey,
      });

      renderCardOpen();

      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      fireEvent.click(screen.getByTestId('recovery-key-rotation-mint'));

      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-confirm'),
        ).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId('recovery-key-rotation-confirm'), {
        target: { value: 'MOCKED-RECOVERY-KEY-VALUE' },
      });
      fireEvent.click(screen.getByTestId('recovery-key-rotation-submit'));

      await waitFor(() => {
        expect(mockRotateRecoveryKey).toHaveBeenCalledWith({
          currentPassphrase: 'testpass1234',
          recoveryKey: 'MOCKED-RECOVERY-KEY-VALUE',
        });
      });

      // onDone did not run: the dialog is still open, with the minted key and confirm field
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(
        screen.getByTestId('recovery-key-rotation-key'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('recovery-key-rotation-confirm'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('That is not your current passphrase.'),
      ).not.toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    test('13: rotating true → submit button shows "Rotating…" and is disabled', async () => {
      (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
        rotating: true,
        rotateRecoveryKey: jest.fn(),
      });

      renderCardOpen();

      // Mint first so the submit button appears
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for submit button to appear
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-submit'),
        ).toBeInTheDocument();
      });

      const submitButton = screen.getByTestId('recovery-key-rotation-submit');
      expect(submitButton).toHaveTextContent('Rotating…');
      expect(submitButton).toBeDisabled();
    });
  });

  describe('Copy button', () => {
    test('14: after minting, click copy → navigator.clipboard.writeText called with minted key, success toast shown', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

      renderCardOpen();

      // Fill and mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for copy button
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-copy'),
        ).toBeInTheDocument();
      });

      // Click copy button
      const copyButton = screen.getByTestId('recovery-key-rotation-copy');
      fireEvent.click(copyButton);

      // Assert clipboard.writeText was called with the minted key
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          'MOCKED-RECOVERY-KEY-VALUE',
        );
      });

      // Assert success toast was called
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Copied',
          description: 'Recovery key copied to clipboard.',
        });
      });
    });

    test('14a: after minting, copy button click when clipboard write fails → failure toast shown, key still visible', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

      // Mock clipboard.writeText to reject
      Object.assign(navigator, {
        clipboard: {
          writeText: jest
            .fn()
            .mockRejectedValue(new Error('Permission denied')),
        },
      });

      renderCardOpen();

      // Fill and mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for copy button
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-copy'),
        ).toBeInTheDocument();
      });

      // Click copy button
      const copyButton = screen.getByTestId('recovery-key-rotation-copy');
      fireEvent.click(copyButton);

      // Assert failure toast was called
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Copy failed',
          description:
            'Could not copy recovery key to clipboard. Use the Download button or select it manually.',
          variant: 'destructive',
        });
      });

      // Assert key is still visible
      expect(
        screen.getByTestId('recovery-key-rotation-key'),
      ).toBeInTheDocument();
    });
  });

  describe('Download button', () => {
    test('15: after minting, click download → downloadTextFile called with minted key content', async () => {
      renderCardOpen();

      // Fill and mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );

      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });
      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Wait for download button
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-download'),
        ).toBeInTheDocument();
      });

      // Click download button
      const downloadButton = screen.getByTestId(
        'recovery-key-rotation-download',
      );
      fireEvent.click(downloadButton);

      // Assert downloadTextFile was called with the correct filename and content
      expect(downloadTextFile).toHaveBeenCalledWith(
        'myorganiser-recovery-key.txt',
        expect.stringContaining('MOCKED-RECOVERY-KEY-VALUE'),
      );
    });
  });

  describe('Server reachability notice integration', () => {
    test('server unreachable: warning shown, submit button enabled after confirm filled, rotation proceeds', async () => {
      const mockRotateRecoveryKey = jest.fn().mockResolvedValue('ok');
      (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
        rotating: false,
        rotateRecoveryKey: mockRotateRecoveryKey,
      });

      // Mock server reachability as unreachable
      (useServerReachability as jest.Mock).mockReturnValue({
        reachability: 'unreachable',
        recheck: jest.fn(),
      });

      renderCardOpen();

      // Step 1: Fill passphrase and mint
      const allInputs = screen.getAllByDisplayValue('');
      const passphraseInput = allInputs.find(
        (input): input is HTMLInputElement =>
          input instanceof HTMLInputElement && input.type === 'password',
      );
      fireEvent.change(passphraseInput!, { target: { value: 'testpass1234' } });

      const mintButton = screen.getByTestId('recovery-key-rotation-mint');
      fireEvent.click(mintButton);

      // Step 2: Wait for the key display and confirm field (proves minting succeeded)
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-key'),
        ).toBeInTheDocument();
      });

      // Step 3: Assert the unreachability warning is visible
      // This regression test guards the entire premise of #621: the warning
      // must be shown so Users know their other devices won't get the change yet.
      const labelElement = screen.getByTestId('server-reachability-label');
      expect(labelElement).toHaveTextContent(
        SERVER_REACHABILITY_READINGS.unreachable.label,
      );

      const detailElement = screen.getByTestId('server-reachability-detail');
      expect(detailElement).toHaveTextContent(
        SERVER_REACHABILITY_READINGS.unreachable.detail,
      );

      // Step 4: Fill confirm field
      await waitFor(() => {
        expect(
          screen.getByTestId('recovery-key-rotation-confirm'),
        ).toBeInTheDocument();
      });

      const confirmInput = screen.getByTestId(
        'recovery-key-rotation-confirm',
      ) as HTMLInputElement;
      fireEvent.change(confirmInput, {
        target: { value: 'MOCKED-RECOVERY-KEY-VALUE' },
      });

      // Step 5: CRITICAL REGRESSION TEST FOR #621 — submit button must be ENABLED
      // even when server is unreachable. Reachability is shown informationally
      // but never gated on, because the local rotation is correct to perform
      // regardless of whether a third device can write between check and push.
      const submitButton = screen.getByTestId('recovery-key-rotation-submit');
      expect(submitButton).not.toBeDisabled();

      // Step 6: Verify rotation can proceed
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockRotateRecoveryKey).toHaveBeenCalledWith({
          currentPassphrase: 'testpass1234',
          recoveryKey: 'MOCKED-RECOVERY-KEY-VALUE',
        });
      });
    });
  });
});

/* eslint-disable import/first -- jest.mock must precede application imports */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Mock useVaultDisabledState at its module path so the real useVaultOperationAvailability
 * (which imports it from the same file) will use the mock when it calls useVaultDisabledState().
 */
jest.mock('../hooks/useVaultDisabledState', () => ({
  useVaultDisabledState: jest.fn(),
}));

/**
 * Mock useChangePassphrase at its module path, not the ../hooks barrel. The barrel
 * re-exports this module, and useChangePassphraseMode imports it directly, so only a
 * module-path mock reaches the screen, the form and the mode hook alike. The real
 * useVaultOperationAvailability stays in place so the policy table is tested.
 */
jest.mock('../hooks/useChangePassphrase', () => ({
  ...jest.requireActual('../hooks/useChangePassphrase'),
  useChangePassphrase: jest.fn(),
}));

/**
 * Mock the Next.js router: success navigates to /dashboard/vault.
 */
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

/**
 * Mock web-vault-ui hooks.
 */
jest.mock('@myorganiser/web-vault-ui', () => ({
  ...jest.requireActual('@myorganiser/web-vault-ui'),
  useOptionalVaultSession: jest.fn(),
}));

/**
 * Mock web-vault functions.
 */
jest.mock('@myorganiser/web-vault', () => ({
  ...jest.requireActual('@myorganiser/web-vault'),
  resetPassphraseAfterRecovery: jest.fn(),
}));

/**
 * Mock web-ui components and useToast. Spread actual so the real primitives
 * used by the shared vault-ui fields keep working.
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

  function Form({ children, ...props }: any) {
    return <FormProvider {...props}>{children}</FormProvider>;
  }

  const FormFieldContext = React.createContext<{ name: string } | null>(null);

  function FormField({ name, render, ...props }: any) {
    return (
      <FormFieldContext.Provider value={{ name }}>
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

  function FormMessage() {
    const fieldContext = React.useContext(FormFieldContext);
    const {
      formState: { errors },
    } = useFormContext();
    const message =
      fieldContext?.name && errors[fieldContext.name]?.message
        ? String(errors[fieldContext.name]?.message)
        : undefined;
    return <div data-testid="form-message">{message}</div>;
  }

  function Input({ type, disabled, id, ...props }: any) {
    return <input type={type} disabled={disabled} id={id} {...props} />;
  }

  return {
    ...actual,
    Button,
    Form,
    FormField,
    FormItem,
    FormLabel,
    FormControl,
    FormMessage,
    Input,
    useToast: jest.fn(),
  };
});

import { ChangePassphraseScreen } from './ChangePassphraseScreen';
import { useChangePassphrase } from '../hooks';
import { useVaultDisabledState } from '../hooks/useVaultDisabledState';
import { useOptionalVaultSession } from '@myorganiser/web-vault-ui';
import type { VaultHandle } from '@myorganiser/web-vault';
import { useRouter } from 'next/navigation';

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

// Type guard for filtering password inputs
const isPasswordInput = (input: HTMLElement): input is HTMLInputElement =>
  input instanceof HTMLInputElement && input.type === 'password';

const mockPush = jest.fn();

describe('ChangePassphraseScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    (useVaultDisabledState as jest.Mock).mockReturnValue('enabled');
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({ loadVault: jest.fn().mockReturnValue({}) }),
      masterKeyBytes: new Uint8Array(32),
    });
    (useChangePassphrase as jest.Mock).mockReturnValue({
      changing: false,
      changePassphrase: jest.fn(),
    });
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('1: renders exactly one h1 with the passphrase-mode title, and a full-width submit with no dialog Cancel', () => {
    render(<ChangePassphraseScreen />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Change passphrase');

    const submitButton = screen.getByTestId('change-passphrase-submit');
    expect(submitButton).toHaveClass('w-full');
    expect(
      screen.queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByDisplayValue('').filter(isPasswordInput),
    ).toHaveLength(3);
  });

  test('2: unlockSecret recovery-key → h1 reads "Set new passphrase" and the form has two password inputs and no Current passphrase field', () => {
    (useChangePassphrase as jest.Mock).mockReturnValue({
      changing: false,
      unlockSecret: 'recovery-key',
      changePassphrase: jest.fn(),
    });

    render(<ChangePassphraseScreen />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Set new passphrase' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Current passphrase')).not.toBeInTheDocument();
    expect(
      screen.getAllByDisplayValue('').filter(isPasswordInput),
    ).toHaveLength(2);
  });

  test('3: blocked (vault locked) → h1 and the unavailability notice render, and no form is shown', () => {
    (useVaultDisabledState as jest.Mock).mockReturnValue('locked');

    render(<ChangePassphraseScreen />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Change passphrase' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Unlock your vault to change its passphrase.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('change-passphrase-submit'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryAllByDisplayValue('').filter(isPasswordInput),
    ).toHaveLength(0);
  });

  test('4: hook result "wrong-passphrase" shows the field error and does not navigate', async () => {
    const mockChangePassphrase = jest
      .fn()
      .mockResolvedValue('wrong-passphrase');
    (useChangePassphrase as jest.Mock).mockReturnValue({
      changing: false,
      changePassphrase: mockChangePassphrase,
    });

    render(<ChangePassphraseScreen />);

    const passwordInputs = screen
      .getAllByDisplayValue('')
      .filter(isPasswordInput);
    fireEvent.change(passwordInputs[0], { target: { value: 'oldpass1234' } });
    fireEvent.change(passwordInputs[1], { target: { value: 'newpass12345' } });
    fireEvent.change(passwordInputs[2], { target: { value: 'newpass12345' } });
    fireEvent.click(screen.getByTestId('change-passphrase-submit'));

    await waitFor(() => {
      expect(
        screen.getByText('That is not your current passphrase.'),
      ).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  test('5: successful change navigates to /dashboard/vault', async () => {
    const mockChangePassphrase = jest.fn().mockResolvedValue('ok');
    (useChangePassphrase as jest.Mock).mockReturnValue({
      changing: false,
      changePassphrase: mockChangePassphrase,
    });

    render(<ChangePassphraseScreen />);

    const passwordInputs = screen
      .getAllByDisplayValue('')
      .filter(isPasswordInput);
    fireEvent.change(passwordInputs[0], { target: { value: 'oldpass1234' } });
    fireEvent.change(passwordInputs[1], { target: { value: 'newpass12345' } });
    fireEvent.change(passwordInputs[2], { target: { value: 'newpass12345' } });
    fireEvent.click(screen.getByTestId('change-passphrase-submit'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard/vault');
    });
    expect(mockChangePassphrase).toHaveBeenCalledWith({
      currentPassphrase: 'oldpass1234',
      newPassphrase: 'newpass12345',
    });
  });
});

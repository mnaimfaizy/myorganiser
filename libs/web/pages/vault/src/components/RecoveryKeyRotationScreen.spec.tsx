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
 * Mock the hooks from ../hooks before importing RecoveryKeyRotationScreen.
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
 * Mock the Next.js router: success and Cancel navigate to /dashboard/vault.
 */
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

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
    Form,
    FormField,
    FormItem,
    FormLabel,
    FormControl,
    FormMessage,
    Input,
    Label,
    useToast: jest.fn(),
  };
});

import { RecoveryKeyRotationScreen } from './RecoveryKeyRotationScreen';
import type { VaultHandle } from '@myorganiser/web-vault';
import {
  mintRecoveryKey,
  type MintedRecoveryKey,
} from '@myorganiser/web-vault';
import {
  useOptionalVaultSession,
  useServerReachability,
} from '@myorganiser/web-vault-ui';
import { useToast } from '@myorganiser/web-ui';
import { useRecoveryKeyRotation } from '../hooks';
import { useVaultDisabledState } from '../hooks/useVaultDisabledState';
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

/** Fills the passphrase, mints a key, and waits for the confirm field to appear. */
async function fillAndMint() {
  const passphraseInput = screen
    .getAllByDisplayValue('')
    .find(
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
}

const mockPush = jest.fn();

describe('RecoveryKeyRotationScreen', () => {
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
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('1: renders exactly one h1 "Rotate recovery key", the passphrase field, and a Cancel that sits below a disabled rotate submit', () => {
    render(<RecoveryKeyRotationScreen />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Rotate recovery key');

    expect(
      screen.getByText(
        'Generate a new recovery key that can open your vault. Your old key stops working after you confirm the new one.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Passphrase to authorize this rotation'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('recovery-key-rotation-mint')).toBeDisabled();
    expect(screen.getByTestId('recovery-key-rotation-submit')).toBeDisabled();
    const submit = screen.getByTestId('recovery-key-rotation-submit');
    const cancel = screen.getByTestId('recovery-key-rotation-cancel');
    expect(cancel).toHaveTextContent('Cancel');
    expect(
      submit.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('2: blocked (vault locked) → h1 and the unavailability notice render, and no passphrase field or mint button is shown', () => {
    (useVaultDisabledState as jest.Mock).mockReturnValue('locked');

    render(<RecoveryKeyRotationScreen />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Rotate recovery key' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Unlock your vault to rotate its recovery key.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('recovery-key-rotation-mint'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Passphrase to authorize this rotation'),
    ).not.toBeInTheDocument();
  });

  test('3: Cancel navigates back to /dashboard/vault and never calls the rotation hook', () => {
    const mockRotateRecoveryKey = jest.fn();
    (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
      rotating: false,
      rotateRecoveryKey: mockRotateRecoveryKey,
    });

    render(<RecoveryKeyRotationScreen />);

    fireEvent.click(screen.getByTestId('recovery-key-rotation-cancel'));

    expect(mockPush).toHaveBeenCalledWith('/dashboard/vault');
    expect(mockRotateRecoveryKey).not.toHaveBeenCalled();
  });

  test('4: hook result "wrong-passphrase" shows the field error and does not navigate', async () => {
    const mockRotateRecoveryKey = jest
      .fn()
      .mockResolvedValue('wrong-passphrase');
    (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
      rotating: false,
      rotateRecoveryKey: mockRotateRecoveryKey,
    });

    render(<RecoveryKeyRotationScreen />);

    await fillAndMint();

    fireEvent.change(screen.getByTestId('recovery-key-rotation-confirm'), {
      target: { value: 'MOCKED-RECOVERY-KEY-VALUE' },
    });
    fireEvent.click(screen.getByTestId('recovery-key-rotation-submit'));

    await waitFor(() => {
      expect(
        screen.getByText('That is not your current passphrase.'),
      ).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  test('5: successful rotation navigates to /dashboard/vault', async () => {
    const mockRotateRecoveryKey = jest.fn().mockResolvedValue('ok');
    (useRecoveryKeyRotation as jest.Mock).mockReturnValue({
      rotating: false,
      rotateRecoveryKey: mockRotateRecoveryKey,
    });

    render(<RecoveryKeyRotationScreen />);

    await fillAndMint();

    fireEvent.change(screen.getByTestId('recovery-key-rotation-confirm'), {
      target: { value: 'MOCKED-RECOVERY-KEY-VALUE' },
    });
    fireEvent.click(screen.getByTestId('recovery-key-rotation-submit'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard/vault');
    });
    expect(mockRotateRecoveryKey).toHaveBeenCalledWith({
      currentPassphrase: 'testpass1234',
      recoveryKey: 'MOCKED-RECOVERY-KEY-VALUE',
    });
  });
});

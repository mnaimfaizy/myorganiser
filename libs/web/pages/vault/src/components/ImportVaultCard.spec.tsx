/* eslint-disable import/first -- jest.mock must precede application imports */
import '@testing-library/jest-dom';

/**
 * Mock useVaultDisabledState at its module path so the real useVaultOperationAvailability
 * (which imports it from the same file) will use the mock when it calls useVaultDisabledState().
 */
jest.mock('../hooks/useVaultDisabledState', () => ({
  useVaultDisabledState: jest.fn(),
}));

/**
 * Mock the hooks from ../hooks.
 * Include the real useVaultOperationAvailability so the policy table is tested.
 */
jest.mock('../hooks', () => {
  const actual = jest.requireActual('../hooks');
  return {
    ...actual,
    useVaultImportDisclosure: jest.fn(),
  };
});

jest.mock('@myorganiser/web-vault-ui', () => ({
  useOptionalVaultSession: jest.fn(),
  getVaultImportErrorMessage: jest.fn(
    (code: string) => `Import error: ${code}`,
  ),
}));

jest.mock('@myorganiser/web-vault', () => ({
  ...jest.requireActual('@myorganiser/web-vault'),
  importVault: jest.fn(),
  isVaultImportError: jest.fn(),
  createDefaultReplayTracker: jest.fn(() => ({})),
  createDefaultAuditReporter: jest.fn(() => ({})),
}));

jest.mock('@myorganiser/web-ui', () => {
  const actual = jest.requireActual('@myorganiser/web-ui');
  return {
    ...actual,
    useToast: jest.fn(),
  };
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VaultHandle } from '@myorganiser/web-vault';
import {
  importVault,
  isVaultImportError,
  type ImportVaultResult,
} from '@myorganiser/web-vault';
import { useOptionalVaultSession } from '@myorganiser/web-vault-ui';
import { useToast } from '@myorganiser/web-ui';
import { useVaultDisabledState } from '../hooks/useVaultDisabledState';
import {
  useVaultImportDisclosure,
  type VaultImportDisclosureState,
} from '../hooks';

import { ImportVaultCard } from './ImportVaultCard';

function createMockHandle(overrides?: Partial<VaultHandle>): VaultHandle {
  return {
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
    loadDecryptedData: jest.fn(),
    loadDecryptedDataWithCiphertext: jest.fn(),
    saveEncryptedData: jest.fn(),
    ...overrides,
  } as unknown as VaultHandle;
}

const VAULT_FILE_CONTENT = '{"schemaVersion":1}';

function createVaultFile(): File {
  const file = new File([VAULT_FILE_CONTENT], 'vault.json', {
    type: 'application/json',
  });

  Object.defineProperty(file, 'text', {
    value: () => Promise.resolve(VAULT_FILE_CONTENT),
    configurable: true,
  });

  return file;
}

function selectVaultFile(file: File = createVaultFile()) {
  const fileInput = screen.getByTestId('import-vault-file');
  fireEvent.change(fileInput, { target: { files: [file] } });
}

describe('ImportVaultCard', () => {
  let mockToast: jest.Mock;
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockToast = jest.fn();
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
    // Default state: a vault exists (loadVault() returns non-null) and is unlocked,
    // so useVaultDisabledState derives 'enabled'. This aligns the mocked state with
    // the mocked handle, preventing unreachable states in tests.
    (useVaultDisabledState as jest.Mock).mockReturnValue('enabled');
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({
        loadVault: jest.fn().mockReturnValue({}),
      }),
      masterKeyBytes: new Uint8Array(32),
    });
    // Default: different-vault outcome (the worst case)
    const defaultDisclosure: VaultImportDisclosureState = {
      status: 'loaded',
      outcome: { kind: 'different-vault' },
    };
    (useVaultImportDisclosure as jest.Mock).mockReturnValue(defaultDisclosure);
    jest.mocked(importVault).mockResolvedValue({} as ImportVaultResult);
    jest.mocked(isVaultImportError).mockReturnValue(false);

    confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  test('opening the card with existing vault shows replace dialog, enabling reconciliation of old and new vault credentials', async () => {
    // Default setup now has an existing vault (loadVault returns {}), so the card
    // can show the replace dialog. This aligns the mocked state ('enabled') with
    // the mocked handle (vault exists), preventing unreachable states.
    render(<ImportVaultCard />);
    selectVaultFile();

    fireEvent.click(screen.getByTestId('import-vault-button'));

    // With an existing vault, the import handler opens the replace dialog
    // instead of proceeding with import.
    await waitFor(() => {
      expect(
        screen.getByTestId('import-vault-replace-dialog'),
      ).toBeInTheDocument();
    });

    // Import should not have been called yet (user must confirm the replace)
    expect(importVault).not.toHaveBeenCalled();
  });

  test('blocks import when there is no local vault (ADR 0068 §3 policy)', async () => {
    // When there's no vault on the device, the policy blocks import because there's
    // nothing to import into. useVaultDisabledState returns 'no-local-vault' when
    // loadVault() returns null.
    (useVaultDisabledState as jest.Mock).mockReturnValue('no-local-vault');
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({
        loadVault: jest.fn().mockReturnValue(null),
      }),
    });

    render(<ImportVaultCard />);
    selectVaultFile();

    // Button should be disabled when import is not allowed
    expect(screen.getByTestId('import-vault-button')).toBeDisabled();

    // File input should also be disabled
    expect(screen.getByTestId('import-vault-file')).toBeDisabled();

    // Unavailability notice should show the policy reason
    expect(screen.getByTestId('import-vault-unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('There is no vault on this device to import into.'),
    ).toBeInTheDocument();

    // Clicking the button should have no effect since it's disabled
    fireEvent.click(screen.getByTestId('import-vault-button'));

    expect(importVault).not.toHaveBeenCalled();
  });

  test('opens replace dialog with credential disclosure when a local vault already exists', async () => {
    // This test still uses the default setup (vault exists, state is 'enabled')
    // to verify that the replace dialog is shown and contains the expected warnings.
    render(<ImportVaultCard />);
    selectVaultFile();

    fireEvent.click(screen.getByTestId('import-vault-button'));

    await waitFor(() => {
      expect(
        screen.getByTestId('import-vault-replace-dialog'),
      ).toBeInTheDocument();
    });

    const dialogText = screen.getByTestId(
      'import-vault-replace-dialog',
    ).textContent;
    expect(dialogText).toMatch(/passphrase/i);
    expect(dialogText).toMatch(/Recovery Key/i);
    expect(dialogText).toMatch(/replaced/i);

    expect(importVault).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test('renders the disclosure returned by useVaultImportDisclosure in the dialog', async () => {
    // Set up a distinctive outcome (unchanged) that produces unique text
    (useVaultImportDisclosure as jest.Mock).mockReturnValue({
      status: 'loaded',
      outcome: { kind: 'unchanged' },
    });

    render(<ImportVaultCard />);
    selectVaultFile();

    fireEvent.click(screen.getByTestId('import-vault-button'));

    await waitFor(() => {
      expect(
        screen.getByTestId('import-vault-replace-dialog'),
      ).toBeInTheDocument();
    });

    // The unchanged disclosure should render a distinctive message
    const disclosure = screen.getByTestId('import-vault-replace-disclosure');
    expect(disclosure.textContent).toContain(
      'Nothing about opening your Vault changes',
    );
  });

  test('runs import after acknowledgement and shows Import complete without Import canceled toast', async () => {
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({
        loadVault: jest.fn().mockReturnValue({}),
      }),
    });

    render(<ImportVaultCard />);
    selectVaultFile();
    fireEvent.click(screen.getByTestId('import-vault-button'));

    await waitFor(() => {
      expect(
        screen.getByTestId('import-vault-replace-dialog'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('import-vault-replace-acknowledge'));
    fireEvent.click(screen.getByTestId('import-vault-replace-confirm'));

    await waitFor(() => {
      expect(importVault).toHaveBeenCalledTimes(1);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Import complete' }),
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Import canceled' }),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test('shows Import failed toast and dialog alert when confirmed import rejects', async () => {
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({
        loadVault: jest.fn().mockReturnValue({}),
      }),
    });
    jest
      .mocked(importVault)
      .mockRejectedValue(new Error('Storage write failed'));

    render(<ImportVaultCard />);
    selectVaultFile();
    fireEvent.click(screen.getByTestId('import-vault-button'));

    await waitFor(() => {
      expect(
        screen.getByTestId('import-vault-replace-dialog'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('import-vault-replace-acknowledge'));
    fireEvent.click(screen.getByTestId('import-vault-replace-confirm'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Import failed',
          variant: 'destructive',
        }),
      );
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Storage write failed');
    expect(
      screen.getByTestId('import-vault-replace-dialog'),
    ).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test('Cancel toasts Import canceled and does not call importVault', async () => {
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({
        loadVault: jest.fn().mockReturnValue({}),
      }),
    });

    render(<ImportVaultCard />);
    selectVaultFile();
    fireEvent.click(screen.getByTestId('import-vault-button'));

    await waitFor(() => {
      expect(
        screen.getByTestId('import-vault-replace-dialog'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('import-vault-replace-cancel'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Import canceled',
          description: 'Your local vault was not changed.',
        }),
      );
    });

    expect(importVault).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test('keeps Import disabled without a selected file so importVault and the dialog never run', () => {
    render(<ImportVaultCard />);

    const importButton = screen.getByTestId('import-vault-button');
    expect(importButton).toBeDisabled();

    fireEvent.click(importButton);

    expect(mockToast).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('import-vault-replace-dialog'),
    ).not.toBeInTheDocument();
    expect(importVault).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test('CardDescription states unlock uses backup passphrase or Recovery Key', () => {
    render(<ImportVaultCard />);

    expect(
      screen.getByText(
        /After import, unlock with the backup's passphrase or Recovery Key\./,
      ),
    ).toBeInTheDocument();
  });

  describe('Vault disabled state handling', () => {
    test('C1: signed-out state disables file input and button, shows unavailability reason', () => {
      (useVaultDisabledState as jest.Mock).mockReturnValue('signed-out');
      // signed-out requires handle === null
      (useOptionalVaultSession as jest.Mock).mockReturnValue(null);

      render(<ImportVaultCard />);

      expect(screen.getByTestId('import-vault-file')).toBeDisabled();
      expect(screen.getByTestId('import-vault-button')).toBeDisabled();
      expect(
        screen.getByTestId('import-vault-unavailable'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Your vault is not available on this device right now.',
        ),
      ).toBeInTheDocument();
    });

    test('C2: no-local-vault state disables file input and button, shows correct unavailability reason', () => {
      (useVaultDisabledState as jest.Mock).mockReturnValue('no-local-vault');

      render(<ImportVaultCard />);

      expect(screen.getByTestId('import-vault-file')).toBeDisabled();
      expect(screen.getByTestId('import-vault-button')).toBeDisabled();
      expect(
        screen.getByTestId('import-vault-unavailable'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('There is no vault on this device to import into.'),
      ).toBeInTheDocument();
    });

    test('C3: locked state enables file input and button (import does not need Master Key per ADR 0068 / #625 regression guard)', async () => {
      (useVaultDisabledState as jest.Mock).mockReturnValue('locked');
      // locked requires masterKeyBytes === null while vault exists
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: createMockHandle({
          loadVault: jest.fn().mockReturnValue({}),
        }),
        masterKeyBytes: null,
      });

      render(<ImportVaultCard />);

      expect(screen.getByTestId('import-vault-file')).not.toBeDisabled();
      expect(
        screen.queryByTestId('import-vault-unavailable'),
      ).not.toBeInTheDocument();

      // File input and button should be functional in locked state
      selectVaultFile();
      expect(screen.getByTestId('import-vault-button')).not.toBeDisabled();
    });

    test('C4: enabled state enables file input and button', () => {
      (useVaultDisabledState as jest.Mock).mockReturnValue('enabled');

      render(<ImportVaultCard />);

      expect(screen.getByTestId('import-vault-file')).not.toBeDisabled();
      expect(
        screen.queryByTestId('import-vault-unavailable'),
      ).not.toBeInTheDocument();
    });
  });
});

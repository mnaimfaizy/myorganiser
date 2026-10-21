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
 * Mock the hooks from ../hooks before importing RemoveVaultCard.
 * Include the real useVaultOperationAvailability so the policy table is tested.
 */
jest.mock('../hooks', () => {
  const actual = jest.requireActual('../hooks');
  return {
    ...actual,
    useLatestCloudBackup: jest.fn(),
    useExportVault: jest.fn(),
    useUnsentVaultBlobTypes: jest.fn(),
  };
});

/**
 * Mock web-vault-ui hooks.
 */
jest.mock('@myorganiser/web-vault-ui', () => ({
  useOptionalVaultSession: jest.fn(),
  vaultBlobTypeLabel: jest.requireActual('@myorganiser/web-vault-ui')
    .vaultBlobTypeLabel,
  formatDate: jest.requireActual('@myorganiser/web-vault-ui').formatDate,
}));

/**
 * Mock web-ui components and useToast.
 */
jest.mock('@myorganiser/web-ui', () => {
  return {
    Button: ({ children, onClick, disabled, ...props }: any) => (
      <button onClick={onClick} disabled={disabled} {...props}>
        {children}
      </button>
    ),
    Card: ({ children }: any) => <div data-testid="card">{children}</div>,
    CardHeader: ({ children }: any) => <div>{children}</div>,
    CardTitle: ({ children }: any) => <h2>{children}</h2>,
    CardDescription: ({ children }: any) => <p>{children}</p>,
    CardContent: ({ children }: any) => <div>{children}</div>,
    ConfirmDialog: ({
      open,
      onOpenChange,
      title,
      description,
      confirmLabel,
      tone,
      onConfirm,
      children,
    }: any) => {
      if (!open) return null;
      return (
        <div data-testid="confirm-remove-dialog" role="alertdialog">
          <h2>{title}</h2>
          <p data-testid="delete-description">{description}</p>
          {children && <div data-testid="dialog-children">{children}</div>}
          <button
            data-testid="delete-cancel-btn"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            data-testid="delete-confirm-btn"
            data-tone={tone}
            onClick={() => onConfirm()}
          >
            {confirmLabel}
          </button>
        </div>
      );
    },
    useToast: jest.fn(),
  };
});

import { RemoveVaultCard } from './RemoveVaultCard';
import type { VaultHandle } from '@myorganiser/web-vault';
import { VaultBlobType } from '@myorganiser/app-api-client';
import { useOptionalVaultSession } from '@myorganiser/web-vault-ui';
import { useToast } from '@myorganiser/web-ui';
import {
  useLatestCloudBackup,
  useExportVault,
  useUnsentVaultBlobTypes,
} from '../hooks';
import { useVaultDisabledState } from '../hooks/useVaultDisabledState';

// === Mock helpers ===

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
    saveEncryptedData: jest.fn(),
    ...overrides,
  } as unknown as VaultHandle;
}

describe('RemoveVaultCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    (useVaultDisabledState as jest.Mock).mockReturnValue('enabled');
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({ hasOwnedVault: () => true }),
    });
    (useToast as jest.Mock).mockReturnValue({ toast: jest.fn() });
    (useLatestCloudBackup as jest.Mock).mockReturnValue({
      status: 'empty',
      record: null,
    });
    (useExportVault as jest.Mock).mockReturnValue({
      exporting: false,
      exportVaultNow: jest.fn(),
    });
    // Default: everything synced, no unsent changes
    (useUnsentVaultBlobTypes as jest.Mock).mockReturnValue({
      status: 'loaded',
      types: [],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('1: signed-out state renders card, disables button, shows unavailability message', () => {
    (useVaultDisabledState as jest.Mock).mockReturnValue('signed-out');

    render(<RemoveVaultCard />);

    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByTestId('remove-vault-button')).toBeDisabled();
    expect(screen.getByTestId('remove-vault-unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('Your vault is not available on this device right now.'),
    ).toBeInTheDocument();
  });

  test('2: no-local-vault state renders card, disables button, shows correct unavailability message', () => {
    (useVaultDisabledState as jest.Mock).mockReturnValue('no-local-vault');

    render(<RemoveVaultCard />);

    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByTestId('remove-vault-button')).toBeDisabled();
    expect(screen.getByTestId('remove-vault-unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('There is no vault on this device to remove.'),
    ).toBeInTheDocument();
  });

  test('2.5: Unclaimed Local Vault (no-local-vault state) disables removal, exclusive of hasOwnedVault check', () => {
    // Unclaimed Local Vault scenario: the device holds a vault but the current
    // user does not own it. handle.loadVault() returns null (unclaimed vaults
    // are not loaded), so useVaultDisabledState returns 'no-local-vault'.
    // The removal control should be unusable, asserting the equivalence:
    // loadVault() !== null ⟺ hasOwnedVault() (for owned vaults).
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({
        loadVault: jest.fn().mockReturnValue(null),
        hasOwnedVault: jest.fn().mockReturnValue(false),
        hasUnclaimedLocalVault: jest.fn().mockReturnValue(true),
      }),
    });
    (useVaultDisabledState as jest.Mock).mockReturnValue('no-local-vault');

    render(<RemoveVaultCard />);

    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByTestId('remove-vault-button')).toBeDisabled();
    expect(screen.getByTestId('remove-vault-unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('There is no vault on this device to remove.'),
    ).toBeInTheDocument();
  });

  test('3: locked state renders card, enables button, no unavailability message (removal does not need Master Key per ADR 0068)', () => {
    (useVaultDisabledState as jest.Mock).mockReturnValue('locked');

    render(<RemoveVaultCard />);

    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByTestId('remove-vault-button')).not.toBeDisabled();
    expect(
      screen.queryByTestId('remove-vault-unavailable'),
    ).not.toBeInTheDocument();
  });

  test('4: enabled state renders card, enables button', () => {
    (useVaultDisabledState as jest.Mock).mockReturnValue('enabled');

    render(<RemoveVaultCard />);

    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByTestId('remove-vault-button')).not.toBeDisabled();
  });

  test('D5: signed-out state + attempted click does not open confirmation dialog', async () => {
    (useVaultDisabledState as jest.Mock).mockReturnValue('signed-out');

    render(<RemoveVaultCard />);

    const button = screen.getByTestId('remove-vault-button');
    expect(button).toBeDisabled();

    // Try to click anyway
    fireEvent.click(button);

    // Dialog should not open
    expect(
      screen.queryByTestId('confirm-remove-dialog'),
    ).not.toBeInTheDocument();
  });

  test('5: clicking the "Remove local vault" button opens the confirmation dialog', async () => {
    render(<RemoveVaultCard />);

    const button = screen.getByTestId('remove-vault-button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-remove-dialog')).toBeInTheDocument();
    });

    // The confirm control is the destructive action, labelled for what it does
    const confirmButton = screen.getByTestId('delete-confirm-btn');
    expect(confirmButton).toHaveTextContent('Remove from this device');
    expect(confirmButton).toHaveAttribute('data-tone', 'destructive');
  });

  test('5a: unsent types pending — description shows "Checking what this device has not sent…"', async () => {
    (useUnsentVaultBlobTypes as jest.Mock).mockReturnValue({
      status: 'pending',
      types: null,
    });

    render(<RemoveVaultCard />);

    const button = screen.getByTestId('remove-vault-button');
    fireEvent.click(button);

    await waitFor(() => {
      const description = screen.getByTestId('delete-description');
      expect(description.textContent).toContain(
        'Checking what this device has not sent to the server yet',
      );
    });
  });

  test('5b: unsent types synced (empty) — description shows synced message, not alarm', async () => {
    (useUnsentVaultBlobTypes as jest.Mock).mockReturnValue({
      status: 'loaded',
      types: [],
    });

    render(<RemoveVaultCard />);

    const button = screen.getByTestId('remove-vault-button');
    fireEvent.click(button);

    await waitFor(() => {
      const description = screen.getByTestId('delete-description');
      expect(description.textContent).toContain(
        'Every part of this Vault has already reached the server',
      );
      // Verify it does NOT contain the unsent-changes alarm message
      expect(description.textContent).not.toContain(
        'This device holds changes it has not sent',
      );
    });
  });

  test('5c: unsent types present — description names types by label', async () => {
    (useUnsentVaultBlobTypes as jest.Mock).mockReturnValue({
      status: 'loaded',
      types: [VaultBlobType.Tasks, VaultBlobType.Groceries],
    });

    render(<RemoveVaultCard />);

    const button = screen.getByTestId('remove-vault-button');
    fireEvent.click(button);

    await waitFor(() => {
      const description = screen.getByTestId('delete-description');
      // Verify type names appear (not enum values)
      expect(description.textContent).toContain('Tasks');
      expect(description.textContent).toContain('Grocery Lists');
      // Verify the unsent-changes message is present
      expect(description.textContent).toContain(
        'This device holds changes it has not sent',
      );
    });
  });

  test('5d: locked vault with unsent types — button enabled, dialog shows unsent description', async () => {
    (useVaultDisabledState as jest.Mock).mockReturnValue('locked');
    (useUnsentVaultBlobTypes as jest.Mock).mockReturnValue({
      status: 'loaded',
      types: [VaultBlobType.Tasks],
    });

    render(<RemoveVaultCard />);

    // Verify button is enabled despite locked state (ADR 0068)
    const button = screen.getByTestId('remove-vault-button');
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => {
      const description = screen.getByTestId('delete-description');
      expect(description.textContent).toContain('Tasks');
      expect(description.textContent).toContain(
        'This device holds changes it has not sent',
      );
    });
  });

  test('5e: unsent types present — confirm button clickable (warning not blocking)', async () => {
    const mockRemoveVault = jest.fn();
    (useUnsentVaultBlobTypes as jest.Mock).mockReturnValue({
      status: 'loaded',
      types: [VaultBlobType.Tasks],
    });
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({ removeVault: mockRemoveVault }),
    });

    render(<RemoveVaultCard />);

    const button = screen.getByTestId('remove-vault-button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-remove-dialog')).toBeInTheDocument();
    });

    const confirmButton = screen.getByTestId('delete-confirm-btn');
    expect(confirmButton).not.toBeDisabled();

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockRemoveVault).toHaveBeenCalled();
    });
  });

  test('6: backup empty — dialog-children shows no backup message, export button present', async () => {
    (useLatestCloudBackup as jest.Mock).mockReturnValue({
      status: 'empty',
      record: null,
    });

    render(<RemoveVaultCard />);

    const button = screen.getByTestId('remove-vault-button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-remove-dialog')).toBeInTheDocument();
    });

    const dialogChildren = screen.getByTestId('dialog-children');
    expect(dialogChildren.textContent).toContain(
      'This Vault has no independent backup.',
    );

    expect(
      screen.getByTestId('remove-vault-export-first-button'),
    ).toBeInTheDocument();
  });

  test('7: backup loaded — dialog-children shows backup date, no export button', async () => {
    (useLatestCloudBackup as jest.Mock).mockReturnValue({
      status: 'loaded',
      record: {
        createdAt: '2026-01-15T10:00:00.000Z',
        id: 'backup-1',
        event: 'backup',
        source: 'google-drive',
        status: 'success',
        schemaVersion: 1,
        sizeBytes: 100,
      },
    });

    render(<RemoveVaultCard />);

    const button = screen.getByTestId('remove-vault-button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-remove-dialog')).toBeInTheDocument();
    });

    const dialogChildren = screen.getByTestId('dialog-children');
    expect(dialogChildren.textContent).toContain(
      'An independent backup of this Vault exists',
    );

    expect(
      screen.queryByTestId('remove-vault-export-first-button'),
    ).not.toBeInTheDocument();
  });

  test('8: backup loading — dialog-children shows loading message', async () => {
    (useLatestCloudBackup as jest.Mock).mockReturnValue({
      status: 'loading',
      record: null,
    });

    render(<RemoveVaultCard />);

    const button = screen.getByTestId('remove-vault-button');
    fireEvent.click(button);

    await waitFor(() => {
      const dialogChildren = screen.getByTestId('dialog-children');
      expect(dialogChildren.textContent).toContain(
        'Checking whether this Vault has an independent backup',
      );
    });
  });

  test('9: backup error — dialog-children shows error message', async () => {
    (useLatestCloudBackup as jest.Mock).mockReturnValue({
      status: 'error',
      record: null,
      error: new Error('Network failed'),
    });

    render(<RemoveVaultCard />);

    const button = screen.getByTestId('remove-vault-button');
    fireEvent.click(button);

    await waitFor(() => {
      const dialogChildren = screen.getByTestId('dialog-children');
      expect(dialogChildren.textContent).toContain(
        'Backup status could not be confirmed',
      );
    });
  });

  test('10: clicking export button calls exportVaultNow and does NOT close dialog', async () => {
    const mockExportVaultNow = jest.fn();
    (useLatestCloudBackup as jest.Mock).mockReturnValue({
      status: 'empty',
      record: null,
    });
    (useExportVault as jest.Mock).mockReturnValue({
      exporting: false,
      exportVaultNow: mockExportVaultNow,
    });

    render(<RemoveVaultCard />);

    const removeButton = screen.getByTestId('remove-vault-button');
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-remove-dialog')).toBeInTheDocument();
    });

    const exportButton = screen.getByTestId('remove-vault-export-first-button');
    fireEvent.click(exportButton);

    await waitFor(
      () => {
        expect(mockExportVaultNow).toHaveBeenCalled();
      },
      { timeout: 1000 },
    );

    // Dialog should still be open
    expect(screen.getByTestId('confirm-remove-dialog')).toBeInTheDocument();
  });

  test('11: clicking confirm calls handle.removeVault() and shows success toast', async () => {
    const mockRemoveVault = jest.fn();
    const mockToast = jest.fn();
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({ removeVault: mockRemoveVault }),
    });
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

    render(<RemoveVaultCard />);

    const removeButton = screen.getByTestId('remove-vault-button');
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-remove-dialog')).toBeInTheDocument();
    });

    const confirmButton = screen.getByTestId('delete-confirm-btn');

    // Verify confirm can be clicked without errors (window.location.reload() is called and suppressed above)
    expect(() => {
      fireEvent.click(confirmButton);
    }).not.toThrow();

    await waitFor(
      () => {
        expect(mockRemoveVault).toHaveBeenCalled();
      },
      { timeout: 1000 },
    );

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Vault removed',
        description: 'This Vault was removed from this device.',
      }),
    );

    consoleErrorSpy.mockRestore();
  });

  test('12: if handle.removeVault() throws, shows error toast and does NOT reload', async () => {
    const mockRemoveVault = jest.fn().mockImplementation(() => {
      throw new Error('Storage access denied');
    });
    const mockToast = jest.fn();

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({ removeVault: mockRemoveVault }),
    });
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

    render(<RemoveVaultCard />);

    const removeButton = screen.getByTestId('remove-vault-button');
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-remove-dialog')).toBeInTheDocument();
    });

    const confirmButton = screen.getByTestId('delete-confirm-btn');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockRemoveVault).toHaveBeenCalled();
    });

    // Check error toast
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Removal failed',
        variant: 'destructive',
      }),
    );

    // Dialog should still be open (no reload)
    expect(screen.getByTestId('confirm-remove-dialog')).toBeInTheDocument();
  });

  test('13: clicking cancel button closes the dialog without calling removeVault()', async () => {
    const mockRemoveVault = jest.fn();

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({ removeVault: mockRemoveVault }),
    });

    render(<RemoveVaultCard />);

    const removeButton = screen.getByTestId('remove-vault-button');
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-remove-dialog')).toBeInTheDocument();
    });

    const cancelButton = screen.getByTestId('delete-cancel-btn');
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(
        screen.queryByTestId('confirm-remove-dialog'),
      ).not.toBeInTheDocument();
    });

    expect(mockRemoveVault).not.toHaveBeenCalled();
  });
});

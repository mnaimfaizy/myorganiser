/* eslint-disable import/first -- jest.mock must precede application imports */

import React, { useState } from 'react';

const mockSkipPassphraseResetPrompt = jest.fn();
const mockCompletePassphraseResetPrompt = jest.fn();
const mockResetPassphraseAfterRecovery = jest.fn();
const mockCreateVaultApi = jest.fn();

jest.mock('./session', () => ({
  useVaultSession: jest.fn(),
}));

jest.mock('@myorganiser/web-vault', () => ({
  ...jest.requireActual('@myorganiser/web-vault'),
  resetPassphraseAfterRecovery: (...args: unknown[]) =>
    mockResetPassphraseAfterRecovery(...args),
  createVaultApi: () => mockCreateVaultApi(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: jest.fn(),
}));

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { VaultHandle } from '@myorganiser/web-vault';
import { useToast } from '@myorganiser/web-ui';
import { useVaultSession } from './session';
import { PassphraseResetPrompt } from './passphraseResetPrompt';

function createMockHandle(overrides?: Partial<VaultHandle>): VaultHandle {
  return {
    owner: 'test-owner',
    isUnlocked: true,
    hasVault: jest.fn().mockReturnValue(true),
    hasOwnedVault: jest.fn().mockReturnValue(true),
    loadVault: jest.fn().mockReturnValue(null),
    saveVault: jest.fn(),
    adoptVaultMetaWrapping: jest.fn(),
    removeVault: jest.fn(),
    initialize: jest.fn(),
    unlockWithPassphrase: jest.fn(),
    unlockWithRecoveryKey: jest.fn(),
    changePassphrase: jest.fn(),
    resetPassphrase: jest.fn(),
    rotateRecoveryKey: jest.fn(),
    loadDecryptedData: jest.fn(),
    loadDecryptedDataWithCiphertext: jest.fn(),
    saveEncryptedData: jest.fn(),
    vaultStatus: jest.fn().mockReturnValue('owned'),
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
    ...overrides,
  };
}

type RenderPromptOptions = {
  owed?: boolean;
  handle?: VaultHandle | null;
};

function renderPrompt(options: RenderPromptOptions = {}) {
  const initialOwed = options.owed ?? true;
  const handle =
    options.handle === undefined ? createMockHandle() : options.handle;

  function Harness() {
    const [owed, setOwed] = useState(initialOwed);

    (useVaultSession as jest.Mock).mockReturnValue({
      passphraseResetPromptOwed: owed,
      skipPassphraseResetPrompt: () => {
        mockSkipPassphraseResetPrompt();
        setOwed(false);
      },
      completePassphraseResetPrompt: () => {
        mockCompletePassphraseResetPrompt();
        setOwed(false);
      },
      handle,
    });

    return <PassphraseResetPrompt />;
  }

  return render(<Harness />);
}

describe('PassphraseResetPrompt', () => {
  let mockToast: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockToast = jest.fn();
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
    mockCreateVaultApi.mockReturnValue({});
    mockResetPassphraseAfterRecovery.mockResolvedValue({
      push: { kind: 'pushed' },
    });
  });

  test('renders only when passphraseResetPromptOwed is true, then shows reset dialog fields and skip control', () => {
    renderPrompt({ owed: false });

    expect(
      screen.queryByRole('dialog', { name: 'Set a passphrase you know' }),
    ).not.toBeInTheDocument();

    cleanup();
    renderPrompt({ owed: true });

    expect(
      screen.getByRole('dialog', { name: 'Set a passphrase you know' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /You unlocked with your recovery key\. Choose a passphrase you will remember\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('New passphrase')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new passphrase')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Set new passphrase' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Skip for now. The forgotten passphrase stays the live one on every device.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Current passphrase/i),
    ).not.toBeInTheDocument();
  });

  test('does not call resetPassphraseAfterRecovery for too-short or mismatched passphrases', async () => {
    renderPrompt();

    fireEvent.change(screen.getByLabelText('New passphrase'), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new passphrase'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set new passphrase' }));

    await waitFor(() => {
      expect(
        screen.getByText('Use at least 10 characters.'),
      ).toBeInTheDocument();
    });
    expect(mockResetPassphraseAfterRecovery).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('New passphrase'), {
      target: { value: 'validpass123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new passphrase'), {
      target: { value: 'different123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set new passphrase' }));

    await waitFor(() => {
      expect(
        screen.getByText('Both passphrases must match.'),
      ).toBeInTheDocument();
    });
    expect(mockResetPassphraseAfterRecovery).not.toHaveBeenCalled();
    expect(mockCompletePassphraseResetPrompt).not.toHaveBeenCalled();
  });

  test('valid submit calls resetPassphraseAfterRecovery without currentPassphrase, toasts success, completes prompt, and unmounts dialog', async () => {
    const handle = createMockHandle();
    renderPrompt({ handle });

    fireEvent.change(screen.getByLabelText('New passphrase'), {
      target: { value: 'newpassphrase1' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new passphrase'), {
      target: { value: 'newpassphrase1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set new passphrase' }));

    await waitFor(() => {
      expect(mockResetPassphraseAfterRecovery).toHaveBeenCalledWith({
        api: {},
        handle,
        newPassphrase: 'newpassphrase1',
      });
    });

    const resetArgs = mockResetPassphraseAfterRecovery.mock
      .calls[0][0] as Record<string, unknown>;
    expect(resetArgs).not.toHaveProperty('currentPassphrase');

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Passphrase changed',
        description: expect.stringContaining('other devices'),
      }),
    );
    expect(mockCompletePassphraseResetPrompt).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Set a passphrase you know' }),
      ).not.toBeInTheDocument();
    });
  });

  test('shows destructive toast and keeps dialog open when resetPassphraseAfterRecovery rejects', async () => {
    mockResetPassphraseAfterRecovery.mockRejectedValue(
      new Error('Network failed'),
    );

    renderPrompt();

    fireEvent.change(screen.getByLabelText('New passphrase'), {
      target: { value: 'newpassphrase1' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new passphrase'), {
      target: { value: 'newpassphrase1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set new passphrase' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Passphrase change failed',
          description: 'Network failed',
          variant: 'destructive',
        }),
      );
    });

    expect(mockCompletePassphraseResetPrompt).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: 'Set a passphrase you know' }),
    ).toBeInTheDocument();
  });

  test('submit with no handle toasts unlock-first message and does not call resetPassphraseAfterRecovery', async () => {
    renderPrompt({ handle: null });

    fireEvent.change(screen.getByLabelText('New passphrase'), {
      target: { value: 'newpassphrase1' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new passphrase'), {
      target: { value: 'newpassphrase1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set new passphrase' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cannot set passphrase',
          description: 'Unlock your vault first.',
          variant: 'destructive',
        }),
      );
    });

    expect(mockResetPassphraseAfterRecovery).not.toHaveBeenCalled();
    expect(mockCompletePassphraseResetPrompt).not.toHaveBeenCalled();
  });

  test('skip calls skipPassphraseResetPrompt, not resetPassphraseAfterRecovery, and unmounts dialog', async () => {
    renderPrompt();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Skip for now. The forgotten passphrase stays the live one on every device.',
      }),
    );

    expect(mockSkipPassphraseResetPrompt).toHaveBeenCalledTimes(1);
    expect(mockResetPassphraseAfterRecovery).not.toHaveBeenCalled();
    expect(mockCompletePassphraseResetPrompt).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Set a passphrase you know' }),
      ).not.toBeInTheDocument();
    });
  });

  test('Escape does not skip or complete the prompt and leaves the dialog open', () => {
    renderPrompt();

    const dialog = screen.getByRole('dialog', {
      name: 'Set a passphrase you know',
    });
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    expect(
      screen.getByRole('dialog', { name: 'Set a passphrase you know' }),
    ).toBeInTheDocument();
    expect(mockSkipPassphraseResetPrompt).not.toHaveBeenCalled();
    expect(mockCompletePassphraseResetPrompt).not.toHaveBeenCalled();
    expect(
      within(dialog).queryByRole('button', { name: /Skip for now/ }),
    ).toBeInTheDocument();
  });
});

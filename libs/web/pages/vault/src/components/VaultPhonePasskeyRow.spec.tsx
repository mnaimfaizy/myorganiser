/* eslint-disable import/first -- jest.mock must precede application imports */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockToast = jest.fn();

// Only the toast is replaced. The real row, hook and dialog render.
jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: jest.fn(),
}));

// The disable call is observed; it still runs the real removal, so the stored
// record changes exactly as it does in the app.
jest.mock('@myorganiser/web-vault', () => {
  const actual = jest.requireActual('@myorganiser/web-vault');
  return {
    ...actual,
    disablePasskeyUnlock: jest.fn(actual.disablePasskeyUnlock),
  };
});

import { useToast } from '@myorganiser/web-ui';
import {
  disablePasskeyUnlock,
  enrolPasskeyUnlock,
  isPasskeyUnlockEnrolled,
  type PasskeyAssertionRequest,
  type PasskeyCreationRequest,
  type PasskeyCreationResult,
  VaultSecretMismatchError,
  type VaultHandle,
} from '@myorganiser/web-vault';
import {
  PasskeyPlatformProvider,
  VaultSessionContext,
  type VaultSessionContextValue,
} from '@myorganiser/web-vault-ui';
import {
  PASSKEY_UNLOCK_STATUS_OFF,
  PASSKEY_UNLOCK_STATUS_ON,
} from './PasskeyUnlockCard';
import { VaultPhonePasskeyRow } from './VaultPhonePasskeyRow';

const CREDENTIAL_ID = new Uint8Array(16).fill(7);
const MASTER_KEY = new Uint8Array(32).fill(9);
const CORRECT_PASSPHRASE = 'correct-pass';

/** A deterministic PRF: SHA-256 over the credential id and the salt. */
async function fakePrf(
  credentialId: Uint8Array,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const input = new Uint8Array(credentialId.length + salt.length);
  input.set(credentialId, 0);
  input.set(salt, credentialId.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

function createFakePlatform() {
  return {
    canCreatePasskeys: jest.fn(async () => true),
    createCredential: jest.fn(
      async (
        request: PasskeyCreationRequest,
      ): Promise<PasskeyCreationResult> => ({
        credentialId: CREDENTIAL_ID,
        prfEnabled: true,
        prfOutput: await fakePrf(CREDENTIAL_ID, request.prfSalt),
      }),
    ),
    getAssertion: jest.fn(async (request: PasskeyAssertionRequest) => ({
      prfOutput: await fakePrf(request.credentialId, request.prfSalt),
    })),
    abandonCredential: jest.fn(async () => undefined),
  };
}

type FakePlatform = ReturnType<typeof createFakePlatform>;

/** Renders the row inside a Vault Session. `unlocked: false` puts the Vault in the locked state. */
function renderRow(
  platform: FakePlatform,
  { owner = 'owner-a', unlocked = true } = {},
) {
  // Only the correct passphrase unlocks; any other is a real mismatch error.
  const unlockWithPassphrase = jest.fn(
    async ({ passphrase }: { passphrase: string }) => {
      if (passphrase !== CORRECT_PASSPHRASE) {
        throw new VaultSecretMismatchError('passphrase');
      }
      return { masterKeyBytes: MASTER_KEY };
    },
  );
  const handle = {
    owner,
    loadVault: () => ({}),
    unlockWithPassphrase,
  } as unknown as VaultHandle;
  const session = {
    masterKeyBytes: unlocked ? MASTER_KEY : null,
    setMasterKeyBytes: jest.fn(),
    lock: jest.fn(),
    handle,
  } as unknown as VaultSessionContextValue;

  const view = render(
    <VaultSessionContext.Provider value={session}>
      <PasskeyPlatformProvider platform={platform}>
        <VaultPhonePasskeyRow />
      </PasskeyPlatformProvider>
    </VaultSessionContext.Provider>,
  );
  return { ...view, unlockWithPassphrase };
}

/** Puts `owner` into the enrolled state on this device, using the real enrolment. */
async function enrolOwner(platform: FakePlatform, owner = 'owner-a') {
  const outcome = await enrolPasskeyUnlock({
    owner,
    masterKeyBytes: MASTER_KEY,
    userName: `${owner}@example.com`,
    platform,
  });
  expect(outcome).toBe('enrolled');
}

describe('VaultPhonePasskeyRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
    // mockReset drains any queued once-values; restore the wrapped real function.
    const { disablePasskeyUnlock: actualDisablePasskeyUnlock } =
      jest.requireActual('@myorganiser/web-vault');
    (disablePasskeyUnlock as jest.Mock).mockReset();
    (disablePasskeyUnlock as jest.Mock).mockImplementation(
      actualDisablePasskeyUnlock,
    );
  });

  test('turn on: pressing the Off row opens the passphrase dialog and does not disable anything', async () => {
    const platform = createFakePlatform();
    renderRow(platform);

    const row = await screen.findByTestId('passkey-unlock-row');
    expect(row).toBeEnabled();
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      PASSKEY_UNLOCK_STATUS_OFF,
    );

    fireEvent.click(row);

    expect(
      await screen.findByLabelText('Current passphrase'),
    ).toBeInTheDocument();
    expect(disablePasskeyUnlock).not.toHaveBeenCalled();
    expect(platform.createCredential).not.toHaveBeenCalled();
  });

  test('turn on: dismissing the dialog with Cancel closes it and leaves the row Off', async () => {
    const platform = createFakePlatform();
    renderRow(platform);

    fireEvent.click(await screen.findByTestId('passkey-unlock-row'));
    await screen.findByLabelText('Current passphrase');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(
        screen.queryByLabelText('Current passphrase'),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      PASSKEY_UNLOCK_STATUS_OFF,
    );
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(disablePasskeyUnlock).not.toHaveBeenCalled();
  });

  test('turn on: a matching passphrase enrols, closes the dialog, and the row reads On', async () => {
    const platform = createFakePlatform();
    const { unlockWithPassphrase } = renderRow(platform);

    fireEvent.click(await screen.findByTestId('passkey-unlock-row'));
    fireEvent.change(await screen.findByLabelText('Current passphrase'), {
      target: { value: CORRECT_PASSPHRASE },
    });
    fireEvent.click(screen.getByTestId('passkey-unlock-passphrase-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
        PASSKEY_UNLOCK_STATUS_ON,
      );
    });
    expect(unlockWithPassphrase).toHaveBeenCalledWith({
      passphrase: CORRECT_PASSPHRASE,
    });
    expect(
      screen.queryByLabelText('Current passphrase'),
    ).not.toBeInTheDocument();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(true);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Passkey Unlock is on' }),
    );
  });

  test('turn on: a wrong passphrase keeps the dialog open with a field error and never reaches the passkey ceremony', async () => {
    const platform = createFakePlatform();
    const { unlockWithPassphrase } = renderRow(platform);

    fireEvent.click(await screen.findByTestId('passkey-unlock-row'));
    fireEvent.change(await screen.findByLabelText('Current passphrase'), {
      target: { value: 'wrong-phrase' },
    });
    fireEvent.click(screen.getByTestId('passkey-unlock-passphrase-submit'));

    expect(
      await screen.findByText('That is not your current passphrase.'),
    ).toBeInTheDocument();
    expect(unlockWithPassphrase).toHaveBeenCalledWith({
      passphrase: 'wrong-phrase',
    });
    expect(screen.getByLabelText('Current passphrase')).toBeInTheDocument();
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      PASSKEY_UNLOCK_STATUS_OFF,
    );
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(platform.createCredential).not.toHaveBeenCalled();
  });

  test('turn off: pressing the On row opens the confirmation and does not disable anything', async () => {
    const platform = createFakePlatform();
    await enrolOwner(platform);
    renderRow(platform);

    const row = await screen.findByTestId('passkey-unlock-row');
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      PASSKEY_UNLOCK_STATUS_ON,
    );

    fireEvent.click(row);

    expect(
      await screen.findByRole('alertdialog', {
        name: 'Turn off Passkey Unlock?',
      }),
    ).toBeInTheDocument();
    expect(disablePasskeyUnlock).not.toHaveBeenCalled();
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      PASSKEY_UNLOCK_STATUS_ON,
    );
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(true);
  });

  test('turn off: confirming disables this device once, shows Off, toasts, and closes the dialog', async () => {
    const platform = createFakePlatform();
    await enrolOwner(platform);
    renderRow(platform);

    fireEvent.click(await screen.findByTestId('passkey-unlock-row'));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));

    await waitFor(() => {
      expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
        PASSKEY_UNLOCK_STATUS_OFF,
      );
    });
    expect(disablePasskeyUnlock).toHaveBeenCalledTimes(1);
    expect(disablePasskeyUnlock).toHaveBeenCalledWith('owner-a');
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Passkey Unlock is off' }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', { name: 'Turn off Passkey Unlock?' }),
      ).not.toBeInTheDocument();
    });
  });

  test('turn off: Cancel closes the confirmation and leaves the row On', async () => {
    const platform = createFakePlatform();
    await enrolOwner(platform);
    renderRow(platform);

    fireEvent.click(await screen.findByTestId('passkey-unlock-row'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', { name: 'Turn off Passkey Unlock?' }),
      ).not.toBeInTheDocument();
    });
    expect(disablePasskeyUnlock).not.toHaveBeenCalled();
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      PASSKEY_UNLOCK_STATUS_ON,
    );
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(true);
    expect(mockToast).not.toHaveBeenCalled();
  });

  test('turn off: Escape closes the confirmation and leaves the row On', async () => {
    const platform = createFakePlatform();
    await enrolOwner(platform);
    renderRow(platform);

    fireEvent.click(await screen.findByTestId('passkey-unlock-row'));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Turn off Passkey Unlock?',
    });

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', { name: 'Turn off Passkey Unlock?' }),
      ).not.toBeInTheDocument();
    });
    expect(disablePasskeyUnlock).not.toHaveBeenCalled();
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      PASSKEY_UNLOCK_STATUS_ON,
    );
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(true);
  });

  test('turn off: a refused removal toasts the failure and the row stays On', async () => {
    const platform = createFakePlatform();
    await enrolOwner(platform);
    renderRow(platform);

    (disablePasskeyUnlock as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(await screen.findByTestId('passkey-unlock-row'));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Passkey Unlock couldn't be turned off",
          variant: 'destructive',
        }),
      );
    });
    expect(disablePasskeyUnlock).toHaveBeenCalledTimes(1);
    expect(disablePasskeyUnlock).toHaveBeenCalledWith('owner-a');
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      PASSKEY_UNLOCK_STATUS_ON,
    );
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(true);
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Passkey Unlock is off' }),
    );
  });

  test('the chevron shows on the Off row, hidden from assistive technology', async () => {
    const platform = createFakePlatform();
    renderRow(platform);

    const row = await screen.findByTestId('passkey-unlock-row');
    const chevron = row.querySelector('svg');
    expect(chevron).toBeInTheDocument();
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
  });

  test('the chevron shows on the On row, hidden from assistive technology', async () => {
    const platform = createFakePlatform();
    await enrolOwner(platform);
    renderRow(platform);

    const row = await screen.findByTestId('passkey-unlock-row');
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      PASSKEY_UNLOCK_STATUS_ON,
    );
    const chevron = row.querySelector('svg');
    expect(chevron).toBeInTheDocument();
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
  });

  test('when the Vault is locked the row is disabled, shows the reason, and pressing it opens no confirmation', async () => {
    const platform = createFakePlatform();
    await enrolOwner(platform);
    renderRow(platform, { unlocked: false });

    const row = await screen.findByTestId('passkey-unlock-row');
    expect(row).toBeDisabled();
    expect(
      screen.getByText(
        'Unlock your vault to change Passkey Unlock on this device.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(row);

    expect(disablePasskeyUnlock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('alertdialog', { name: 'Turn off Passkey Unlock?' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Current passphrase'),
    ).not.toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalled();
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      PASSKEY_UNLOCK_STATUS_ON,
    );
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(true);
  });
});

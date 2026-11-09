/* eslint-disable import/first -- jest.mock must precede application imports */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const mockToast = jest.fn();

// Only the toast is replaced; the dialog, form and card render for real.
jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: jest.fn(),
}));

import { useToast } from '@myorganiser/web-ui';
import {
  enrolPasskeyUnlock,
  isPasskeyUnlockEnrolled,
  VaultSecretMismatchError,
  type PasskeyAssertionRequest,
  type PasskeyCreationRequest,
  type PasskeyCreationResult,
  type VaultHandle,
} from '@myorganiser/web-vault';
import {
  PasskeyPlatformProvider,
  VaultSessionContext,
  type VaultSessionContextValue,
} from '@myorganiser/web-vault-ui';
import { PasskeyUnlockCard } from './PasskeyUnlockCard';

const CREDENTIAL_ID = new Uint8Array(16).fill(7);
const MASTER_KEY = new Uint8Array(32).fill(9);
const CORRECT_PASSPHRASE = 'correct-pass';
const WRONG_PASSPHRASE = 'wrong-phrase';

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

/** Renders the card for an unlocked session owned by `owner`. */
function renderUnlockedCard(platform: FakePlatform, owner = 'owner-a') {
  const unlockWithPassphrase = jest.fn<
    Promise<{ masterKeyBytes: Uint8Array }>,
    [{ passphrase: string }]
  >(async () => ({ masterKeyBytes: MASTER_KEY }));
  const handle = {
    owner,
    loadVault: () => ({}),
    unlockWithPassphrase,
  } as unknown as VaultHandle;
  const session = {
    masterKeyBytes: MASTER_KEY,
    setMasterKeyBytes: jest.fn(),
    lock: jest.fn(),
    handle,
  } as unknown as VaultSessionContextValue;

  const view = render(
    <VaultSessionContext.Provider value={session}>
      <PasskeyPlatformProvider platform={platform}>
        <PasskeyUnlockCard />
      </PasskeyPlatformProvider>
    </VaultSessionContext.Provider>,
  );
  return { ...view, unlockWithPassphrase };
}

/** Opens the passphrase step, types `passphrase`, and submits it. */
async function turnOnWith(passphrase: string) {
  fireEvent.click(await screen.findByTestId('passkey-unlock-turn-on'));
  fireEvent.change(await screen.findByLabelText('Current passphrase'), {
    target: { value: passphrase },
  });
  fireEvent.click(screen.getByTestId('passkey-unlock-passphrase-submit'));
}

describe('PasskeyUnlockCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
  });

  test('asks for the passphrase before any passkey ceremony, then enrols once it matches', async () => {
    const platform = createFakePlatform();
    const { unlockWithPassphrase } = renderUnlockedCard(platform);

    expect(
      await screen.findByTestId('passkey-unlock-status'),
    ).toHaveTextContent('Off on this device');

    fireEvent.click(await screen.findByTestId('passkey-unlock-turn-on'));
    expect(
      await screen.findByLabelText('Current passphrase'),
    ).toBeInTheDocument();
    expect(platform.createCredential).not.toHaveBeenCalled();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);

    fireEvent.change(screen.getByLabelText('Current passphrase'), {
      target: { value: CORRECT_PASSPHRASE },
    });
    fireEvent.click(screen.getByTestId('passkey-unlock-passphrase-submit'));

    await waitFor(() => {
      expect(isPasskeyUnlockEnrolled('owner-a')).toBe(true);
    });
    expect(unlockWithPassphrase).toHaveBeenCalledWith({
      passphrase: CORRECT_PASSPHRASE,
    });
    expect(unlockWithPassphrase.mock.invocationCallOrder[0]).toBeLessThan(
      platform.createCredential.mock.invocationCallOrder[0],
    );
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      'On for this device',
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Passkey Unlock is on' }),
    );
  });

  test('a wrong passphrase shows a field error and never reaches the passkey ceremony', async () => {
    const platform = createFakePlatform();
    const { unlockWithPassphrase } = renderUnlockedCard(platform);
    unlockWithPassphrase.mockRejectedValue(
      new VaultSecretMismatchError('passphrase'),
    );

    await turnOnWith(WRONG_PASSPHRASE);

    expect(
      await screen.findByText('That is not your current passphrase.'),
    ).toBeInTheDocument();
    expect(platform.createCredential).not.toHaveBeenCalled();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      'Off on this device',
    );
  });

  test("Turn off deletes only this owner's record and leaves another owner's record intact", async () => {
    const platform = createFakePlatform();
    for (const owner of ['owner-a', 'owner-b']) {
      const outcome = await enrolPasskeyUnlock({
        owner,
        masterKeyBytes: MASTER_KEY,
        userName: `${owner}@example.com`,
        platform,
      });
      expect(outcome).toBe('enrolled');
    }

    renderUnlockedCard(platform, 'owner-a');

    expect(
      await screen.findByTestId('passkey-unlock-status'),
    ).toHaveTextContent('On for this device');
    fireEvent.click(screen.getByTestId('passkey-unlock-turn-off'));

    await waitFor(() => {
      expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
        'Off on this device',
      );
    });
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(isPasskeyUnlockEnrolled('owner-b')).toBe(true);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Passkey Unlock is off' }),
    );
  });

  test('renders nothing when the browser cannot create passkeys', async () => {
    const platform = createFakePlatform();
    platform.canCreatePasskeys.mockResolvedValue(false);

    const { container } = renderUnlockedCard(platform);

    // Let the support check settle before asserting absence.
    await waitFor(() => {
      expect(platform.canCreatePasskeys).toHaveBeenCalled();
    });
    await act(async () => undefined);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('passkey-unlock-card')).not.toBeInTheDocument();
  });

  test('a created passkey that produced no PRF output toasts that it cannot unlock, abandons it, and stores nothing', async () => {
    const platform = createFakePlatform();
    platform.createCredential.mockImplementation(async () => ({
      credentialId: CREDENTIAL_ID,
      prfEnabled: false,
      prfOutput: null,
    }));
    renderUnlockedCard(platform);

    await turnOnWith(CORRECT_PASSPHRASE);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "This passkey can't unlock your vault",
        }),
      );
    });
    expect(platform.abandonCredential).toHaveBeenCalledWith(CREDENTIAL_ID);
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(screen.getByTestId('passkey-unlock-status')).toHaveTextContent(
      'Off on this device',
    );
  });
});

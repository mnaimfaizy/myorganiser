/* eslint-disable import/first -- jest.mock must precede application imports */

import React from 'react';

const mockToast = jest.fn();

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('@myorganiser/web-vault', () => ({
  ...jest.requireActual('@myorganiser/web-vault'),
  createVaultApi: jest.fn(),
}));

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  aesGcmEncrypt,
  bytesToBase64,
  createVaultApi,
  createVaultHandle,
  enrolPasskeyUnlock,
  importAesGcmKey,
  isPasskeyUnlockEnrolled,
  PasskeyCredentialGoneError,
  randomBytes,
  utf8ToBytes,
  type PasskeyAssertionRequest,
  type PasskeyCreationRequest,
  type PasskeyPlatform,
  type VaultHandle,
} from '@myorganiser/web-vault';
import { PasskeyPlatformProvider } from './passkeyPlatformContext';
import { VaultSessionContext, type VaultSessionContextValue } from './session';
import { VaultGate } from './vaultGate';
import { ABSENT_EVIDENCE_WITHOUT_OWNER } from './useVaultAbsentEvidence';
import { CLAIM_EVIDENCE_WITHOUT_OWNER } from './useVaultClaimEvidence';

const CREDENTIAL_ID = new Uint8Array(16).fill(7);
const ENROLLED_KEY = new Uint8Array(32).map((_, i) => i + 1);
// A different 32-byte Master Key: the one a Vault replaced on another device is wrapped by.
const REPLACED_KEY = new Uint8Array(32).map((_, i) => 255 - i);
const UPDATED_AT = '2026-01-01T00:00:00.000Z';

/**
 * A deterministic fake authenticator: the PRF output is SHA-256 over the
 * credential id and the salt, so the enrolled wrapping opens under the same
 * fake without any browser WebAuthn.
 */
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
    createCredential: jest.fn(async (request: PasskeyCreationRequest) => ({
      credentialId: CREDENTIAL_ID,
      prfEnabled: true,
      prfOutput: await fakePrf(CREDENTIAL_ID, request.prfSalt),
    })),
    getAssertion: jest.fn(async (request: PasskeyAssertionRequest) => ({
      prfOutput: await fakePrf(request.credentialId, request.prfSalt),
    })),
    abandonCredential: jest.fn(async () => undefined),
  };
}

type FakePlatform = ReturnType<typeof createFakePlatform>;

function createStubHandle(owner: string): VaultHandle {
  return {
    owner,
    isUnlocked: false,
    vaultStatus: jest.fn(() => 'owned'),
    loadVault: jest.fn(() => null),
    isRecoveryKeyUnacknowledged: jest.fn().mockResolvedValue(false),
    acknowledgeRecoveryKey: jest.fn(),
  } as unknown as VaultHandle;
}

/** A locked session for `owner`: the gate reads only these fields. */
function lockedSession(
  owner: string,
  setMasterKeyBytes: jest.Mock,
): VaultSessionContextValue {
  return {
    masterKeyBytes: null,
    unlockSecret: null,
    passphraseResetPromptOwed: false,
    skipPassphraseResetPrompt: jest.fn(),
    completePassphraseResetPrompt: jest.fn(),
    setMasterKeyBytes,
    lock: jest.fn(),
    handle: createStubHandle(owner),
    syncQueue: null,
    pullTrigger: null,
    revision: null,
    claimEvidence: CLAIM_EVIDENCE_WITHOUT_OWNER,
    absentEvidence: ABSENT_EVIDENCE_WITHOUT_OWNER,
  } as unknown as VaultSessionContextValue;
}

function renderGate(
  session: VaultSessionContextValue,
  platform: PasskeyPlatform,
  encryptedItems?: string,
) {
  return render(
    <VaultSessionContext.Provider value={session}>
      <PasskeyPlatformProvider platform={platform}>
        <VaultGate title="Test" encryptedItems={encryptedItems}>
          {() => <div>children</div>}
        </VaultGate>
      </PasskeyPlatformProvider>
    </VaultSessionContext.Provider>,
  );
}

async function enrol(owner: string, platform: PasskeyPlatform) {
  const outcome = await enrolPasskeyUnlock({
    owner,
    masterKeyBytes: ENROLLED_KEY,
    userName: 'owner@example.com',
    platform,
  });
  expect(outcome).toBe('enrolled');
}

// 14 characters: within the fixture passphrase rule (docs/testing/README.md).
const VAULT_PASSPHRASE = 'vault-secret-1';

/**
 * A real owned Local Vault with no Vault Blob yet. The passkey check reads this
 * device's Local Vault to verify the recovered key, so an unlock needs one.
 */
async function createOwnedVault(owner: string) {
  const handle = createVaultHandle({ owner });
  await handle.initialize({ passphrase: VAULT_PASSPHRASE });
}

/**
 * A real owned Local Vault with a saved Vault Blob, wrapped by a Master Key
 * that is not ENROLLED_KEY: the Vault a passkey enrolled earlier no longer opens.
 */
async function createOwnedVaultWithDifferentKey(owner: string) {
  const handle = createVaultHandle({ owner });
  await handle.initialize({ passphrase: VAULT_PASSPHRASE });
  await handle.unlockWithPassphrase({ passphrase: VAULT_PASSPHRASE });
  await handle.saveEncryptedData({ type: 'tasks', value: [] });
}

/** A Vault Blob sealed under `masterKeyBytes` with the real AES-GCM helper. */
async function serverBlobUnder(masterKeyBytes: Uint8Array) {
  const iv = randomBytes(12);
  const ciphertext = await aesGcmEncrypt({
    key: await importAesGcmKey(masterKeyBytes),
    plaintext: utf8ToBytes('[]'),
    iv,
  });
  return {
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
}

/** A server that holds no Vault Blob, so the passkey check falls back to the Local Vault. */
function emptyServerApi() {
  return {
    getVaultBlobInventory: jest.fn(async () => ({
      data: { etag: 'e', blobs: [] },
    })),
    getVaultBlob: jest.fn(),
  };
}

describe('VaultGate passkey unlock option (ADR 0136)', () => {
  let platform: FakePlatform;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    platform = createFakePlatform();
    (createVaultApi as jest.Mock).mockImplementation(() => emptyServerApi());
  });

  test('an enrolled owner sees the passkey option beside the passphrase form and the Recovery Key link', async () => {
    await enrol('owner-a', platform);

    renderGate(lockedSession('owner-a', jest.fn()), platform);

    expect(
      screen.getByRole('button', { name: 'Unlock with passkey' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Forgot it? Use your Recovery Key' }),
    ).toBeInTheDocument();
  });

  test('a passkey that unlocks sets the Master Key with the passkey secret', async () => {
    await enrol('owner-a', platform);
    await createOwnedVault('owner-a');
    const setMasterKeyBytes = jest.fn();

    renderGate(lockedSession('owner-a', setMasterKeyBytes), platform);

    fireEvent.click(
      screen.getByRole('button', { name: 'Unlock with passkey' }),
    );

    await waitFor(() => {
      expect(setMasterKeyBytes).toHaveBeenCalledWith(
        new Uint8Array(ENROLLED_KEY),
        'passkey',
      );
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Unlocked' }),
    );
    expect(platform.getAssertion).toHaveBeenCalledWith(
      expect.objectContaining({ userVerification: 'required' }),
    );
  }, 30_000);

  test('a cancelled passkey check stays locked, keeps the record, and leaves the passphrase and Recovery Key usable', async () => {
    await enrol('owner-a', platform);
    const setMasterKeyBytes = jest.fn();
    platform.getAssertion.mockRejectedValueOnce(new Error('NotAllowedError'));

    renderGate(lockedSession('owner-a', setMasterKeyBytes), platform);

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Unlock with passkey' }),
      );
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Your passkey didn't unlock the vault",
        }),
      );
    });
    expect(setMasterKeyBytes).not.toHaveBeenCalled();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(true);

    // The passkey option is still offered, and the passphrase path is intact.
    expect(
      screen.getByRole('button', { name: 'Unlock with passkey' }),
    ).toBeEnabled();
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Forgot it? Use your Recovery Key' }),
    );
    expect(
      screen.getByRole('button', { name: 'Unlock with recovery key' }),
    ).toBeInTheDocument();
  });

  test('with the passkey option shown, the explanatory line does not point only at the passphrase', async () => {
    await enrol('owner-a', platform);

    renderGate(lockedSession('owner-a', jest.fn()), platform, 'tasks');

    expect(
      screen.getByText(
        'Your tasks are encrypted. Unlock to open them on this device.',
      ),
    ).toBeInTheDocument();
  });

  test('with the passkey option shown and no items named, the explanatory line is the neutral generic one', async () => {
    await enrol('owner-a', platform);

    renderGate(lockedSession('owner-a', jest.fn()), platform);

    expect(
      screen.getByText(
        'Your data is encrypted. Unlock to open it on this device.',
      ),
    ).toBeInTheDocument();
  });

  test('without the passkey option, the explanatory line still asks for the passphrase', () => {
    renderGate(lockedSession('owner-a', jest.fn()), platform, 'tasks');

    expect(
      screen.getByText(
        'Your tasks are encrypted. Enter your passphrase to open them on this device.',
      ),
    ).toBeInTheDocument();
  });

  test('an owner with no passkey on this device sees no passkey option', () => {
    renderGate(lockedSession('owner-a', jest.fn()), platform);

    expect(
      screen.queryByRole('button', { name: 'Unlock with passkey' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
  });

  test("another owner's passkey on this device is not offered to a different owner", async () => {
    await enrol('owner-b', platform);

    renderGate(lockedSession('owner-a', jest.fn()), platform);

    expect(
      screen.queryByRole('button', { name: 'Unlock with passkey' }),
    ).not.toBeInTheDocument();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
  });

  test('a Local Vault the passkey no longer opens is stale: the option goes, nothing unlocks, and the passphrase is asked for', async () => {
    await enrol('owner-a', platform);
    // A real Local Vault whose Master Key is not the one the passkey wraps.
    await createOwnedVaultWithDifferentKey('owner-a');
    const setMasterKeyBytes = jest.fn();

    renderGate(lockedSession('owner-a', setMasterKeyBytes), platform);

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Unlock with passkey' }),
      );
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Passkey Unlock was turned off',
          description:
            'This passkey no longer matches your vault. Enter your passphrase.',
        }),
      );
    });
    expect(setMasterKeyBytes).not.toHaveBeenCalled();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(
      screen.queryByRole('button', { name: 'Unlock with passkey' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
  }, 30_000);

  test("a Vault replaced on another device is stale: the server's Ciphertext refuses the key even though this device's Local Vault holds no Vault Blob to contradict it", async () => {
    await enrol('owner-a', platform);
    // This device's Local Vault holds no Vault Blob, so it has nothing to
    // contradict the key.
    await createOwnedVault('owner-a');
    // The server's Vault Blob is wrapped by another Master Key, as after a
    // re-initialised Vault on another device.
    const replacedBlob = await serverBlobUnder(REPLACED_KEY);
    const server = {
      getVaultBlobInventory: jest.fn(async () => ({
        data: {
          etag: 'inventory-1',
          blobs: [{ type: 'tasks', etag: 'blob-1', updatedAt: UPDATED_AT }],
        },
      })),
      getVaultBlob: jest.fn(async () => ({
        data: {
          etag: 'blob-1',
          updatedAt: UPDATED_AT,
          type: 'tasks',
          message: '',
          blob: replacedBlob,
        },
      })),
    };
    (createVaultApi as jest.Mock).mockImplementation(() => server);
    const setMasterKeyBytes = jest.fn();

    renderGate(lockedSession('owner-a', setMasterKeyBytes), platform);

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Unlock with passkey' }),
      );
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Passkey Unlock was turned off',
          description:
            'This passkey no longer matches your vault. Enter your passphrase.',
        }),
      );
    });
    // The server's Ciphertext was the one read, and it is what refused the key.
    expect(server.getVaultBlob).toHaveBeenCalledWith(
      { type: 'tasks' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(setMasterKeyBytes).not.toHaveBeenCalled();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(
      screen.queryByRole('button', { name: 'Unlock with passkey' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
  }, 30_000);

  test('a passkey the browser reports as gone is removed from this device and the passphrase is asked for', async () => {
    await enrol('owner-a', platform);
    platform.getAssertion.mockRejectedValueOnce(
      new PasskeyCredentialGoneError(),
    );
    const setMasterKeyBytes = jest.fn();

    renderGate(lockedSession('owner-a', setMasterKeyBytes), platform);

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Unlock with passkey' }),
      );
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Passkey Unlock was turned off',
          description:
            'This passkey is no longer available. Enter your passphrase.',
        }),
      );
    });
    expect(setMasterKeyBytes).not.toHaveBeenCalled();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(
      screen.queryByRole('button', { name: 'Unlock with passkey' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
  });

  test('a passkey check that cannot read a Local Vault to verify against fails and keeps the record', async () => {
    await enrol('owner-a', platform);
    const setMasterKeyBytes = jest.fn();

    renderGate(lockedSession('owner-a', setMasterKeyBytes), platform);

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Unlock with passkey' }),
      );
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Your passkey didn't unlock the vault",
        }),
      );
    });
    expect(setMasterKeyBytes).not.toHaveBeenCalled();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Unlock with passkey' }),
    ).toBeEnabled();
  });
});

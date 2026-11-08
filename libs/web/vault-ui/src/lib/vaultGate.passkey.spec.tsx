/* eslint-disable import/first -- jest.mock must precede application imports */

import React from 'react';

const mockToast = jest.fn();

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: () => ({ toast: mockToast }),
}));

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  enrolPasskeyUnlock,
  isPasskeyUnlockEnrolled,
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
) {
  return render(
    <VaultSessionContext.Provider value={session}>
      <PasskeyPlatformProvider platform={platform}>
        <VaultGate title="Test">{() => <div>children</div>}</VaultGate>
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

describe('VaultGate passkey unlock option (ADR 0136)', () => {
  let platform: FakePlatform;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    platform = createFakePlatform();
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
  });

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
});

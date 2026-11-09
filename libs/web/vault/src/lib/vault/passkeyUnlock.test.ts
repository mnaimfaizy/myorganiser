/**
 * Tests for the Passkey Unlock policy (ADR 0136) against a fake authenticator.
 *
 * The fake stands in for the WebAuthn Platform Adapter. It records every
 * create and get request, derives a deterministic 32-byte PRF output from
 * credentialId + salt, and can be set to cancel, withhold PRF output, or
 * return a different key. Assertions sit at the seam: enrolment and unlock
 * outcomes, the storage records read back through the public helpers, and
 * the requests the platform received. Nothing here inspects internals.
 */

import {
  canOfferPasskeyUnlock,
  disablePasskeyUnlock,
  enrolPasskeyUnlock,
  isPasskeyUnlockEnrolled,
  PasskeyCredentialGoneError,
  recordPasskeyUnlockOffered,
  unlockWithPasskey,
  type PasskeyAssertionRequest,
  type PasskeyCreationRequest,
  type PasskeyPlatform,
} from './passkeyUnlock';
import {
  aesGcmDecrypt,
  base64ToBytes,
  bytesToBase64,
  importAesGcmKey,
  randomBytes,
} from './crypto';
import { masterKeyOpensLocalVault } from './masterKeyOpensLocalVault';
import { mintRecoveryKey } from './recoveryKeyMint';
import { localVaultStorageKey, type VaultStorageV1 } from './localVaultStorage';
import { readPasskeyUnlockRecord } from './passkeyUnlockStorage';
import { createVaultHandle } from './vaultHandle';

type CreateMode =
  | 'prf-at-create'
  | 'prf-deferred'
  | 'prf-unsupported'
  | 'prf-short'
  | 'cancel';

type AssertMode = 'derive' | 'null' | 'wrong-key' | 'cancel' | 'gone';

// Fixture passphrases kept to 10-15 characters (docs/testing/README.md).
const OLD_PASSPHRASE = 'old-passphrase';
const NEW_PASSPHRASE = 'new-passphrase';

const MASTER_KEY = Uint8Array.from(
  { length: 32 },
  (_, i) => (i * 11 + 5) % 256,
);
const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

function cancelledCeremony(): DOMException {
  return new DOMException(
    'The operation either timed out or was not allowed.',
    'NotAllowedError',
  );
}

async function derivePrf(
  credentialId: Uint8Array,
  salt: Uint8Array,
  authenticatorSecret = 'fake-authenticator',
): Promise<Uint8Array> {
  const label = new TextEncoder().encode(authenticatorSecret);
  const input = new Uint8Array(
    label.length + credentialId.length + salt.length,
  );
  input.set(label, 0);
  input.set(credentialId, label.length);
  input.set(salt, label.length + credentialId.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

/** A fake authenticator: records every request and answers by configured mode. */
class FakeAuthenticator implements PasskeyPlatform {
  readonly creations: PasskeyCreationRequest[] = [];
  readonly assertions: PasskeyAssertionRequest[] = [];
  readonly abandoned: Uint8Array[] = [];
  createdCredentialId: Uint8Array | null = null;
  canCreate = true;
  canCreateRejects = false;
  abandonRejects = false;
  createMode: CreateMode = 'prf-at-create';
  assertMode: AssertMode = 'derive';

  async canCreatePasskeys(): Promise<boolean> {
    if (this.canCreateRejects) throw new Error('platform check failed');
    return this.canCreate;
  }

  async createCredential(request: PasskeyCreationRequest) {
    this.creations.push(request);
    if (this.createMode === 'cancel') throw cancelledCeremony();

    const credentialId = randomBytes(32);
    this.createdCredentialId = credentialId;
    const prfEnabled = this.createMode !== 'prf-unsupported';
    let prfOutput: Uint8Array | null = null;
    if (this.createMode === 'prf-at-create') {
      prfOutput = await derivePrf(credentialId, request.prfSalt);
    }
    if (this.createMode === 'prf-short') prfOutput = randomBytes(16);
    return { credentialId, prfEnabled, prfOutput };
  }

  async getAssertion(request: PasskeyAssertionRequest) {
    this.assertions.push(request);
    if (this.assertMode === 'cancel') throw cancelledCeremony();
    if (this.assertMode === 'gone') throw new PasskeyCredentialGoneError();
    if (this.assertMode === 'null') return { prfOutput: null };
    const secret =
      this.assertMode === 'wrong-key' ? 'a-different-authenticator' : undefined;
    return {
      prfOutput: await derivePrf(request.credentialId, request.prfSalt, secret),
    };
  }

  async abandonCredential(credentialId: Uint8Array): Promise<void> {
    this.abandoned.push(credentialId);
    if (this.abandonRejects) throw new Error('provider refused the abandon');
  }

  requireCreatedCredentialId(): Uint8Array {
    if (this.createdCredentialId === null) {
      throw new Error('no credential was created');
    }
    return this.createdCredentialId;
  }

  requireLastAssertion(): PasskeyAssertionRequest {
    const last = this.assertions[this.assertions.length - 1];
    if (last === undefined) throw new Error('no assertion was made');
    return last;
  }
}

function enrol(owner: string, platform: PasskeyPlatform) {
  return enrolPasskeyUnlock({
    owner,
    masterKeyBytes: MASTER_KEY,
    userName: `${owner}@example.test`,
    platform,
  });
}

let authenticator: FakeAuthenticator;

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
  authenticator = new FakeAuthenticator();
});

describe('passkeyUnlock — Passkey Unlock policy over a fake authenticator', () => {
  describe('enrolment and unlock — happy path and wrapping at rest', () => {
    test('1: enrol returns enrolled, and unlock recovers the same Master Key', async () => {
      await expect(enrol(OWNER_A, authenticator)).resolves.toBe('enrolled');
      expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(true);

      const outcome = await unlockWithPasskey({
        owner: OWNER_A,
        platform: authenticator,
      });

      expect(outcome.outcome).toBe('unlocked');
      if (outcome.outcome !== 'unlocked') return;
      expect(Array.from(outcome.masterKeyBytes)).toEqual(
        Array.from(MASTER_KEY),
      );
    });

    test('2: the stored record does not contain the Master Key base64', async () => {
      await enrol(OWNER_A, authenticator);

      const raw = localStorage.getItem(
        `myorganiser_passkey_unlock_v1:${OWNER_A}`,
      );
      expect(raw).not.toBeNull();
      expect(raw).not.toContain(bytesToBase64(MASTER_KEY));
    });

    test('3: every create and get request carries userVerification required', async () => {
      authenticator.createMode = 'prf-deferred';

      await enrol(OWNER_A, authenticator);
      await unlockWithPasskey({ owner: OWNER_A, platform: authenticator });

      expect(authenticator.creations).toHaveLength(1);
      expect(authenticator.assertions).toHaveLength(2);
      for (const request of authenticator.creations) {
        expect(request.userVerification).toBe('required');
      }
      for (const request of authenticator.assertions) {
        expect(request.userVerification).toBe('required');
      }
    });

    test('4: unlock requests the enrolled credential id and the stored salt', async () => {
      await enrol(OWNER_A, authenticator);
      const created = authenticator.creations[0];
      const record = readPasskeyUnlockRecord(OWNER_A);

      await unlockWithPasskey({ owner: OWNER_A, platform: authenticator });

      const assertion = authenticator.requireLastAssertion();
      expect(bytesToBase64(assertion.credentialId)).toBe(
        bytesToBase64(authenticator.requireCreatedCredentialId()),
      );
      expect(bytesToBase64(assertion.prfSalt)).toBe(
        bytesToBase64(created.prfSalt),
      );
      expect(record?.credentialId).toBe(
        bytesToBase64(authenticator.requireCreatedCredentialId()),
      );
      expect(record?.prfSalt).toBe(bytesToBase64(created.prfSalt));
    });
  });

  describe('enrolment — PRF support and follow-up assertion', () => {
    test('5: create with PRF disabled is unsupported, stores nothing, and abandons the credential', async () => {
      authenticator.createMode = 'prf-unsupported';

      await expect(enrol(OWNER_A, authenticator)).resolves.toBe('unsupported');

      expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
      expect(readPasskeyUnlockRecord(OWNER_A)).toBeUndefined();
      expect(authenticator.abandoned).toHaveLength(1);
      expect(bytesToBase64(authenticator.abandoned[0])).toBe(
        bytesToBase64(authenticator.requireCreatedCredentialId()),
      );
    });

    test('6: PRF deferred to a follow-up assertion for that credential, then enrolled', async () => {
      authenticator.createMode = 'prf-deferred';

      await expect(enrol(OWNER_A, authenticator)).resolves.toBe('enrolled');

      expect(authenticator.assertions).toHaveLength(1);
      const followUp = authenticator.assertions[0];
      expect(bytesToBase64(followUp.credentialId)).toBe(
        bytesToBase64(authenticator.requireCreatedCredentialId()),
      );
      expect(bytesToBase64(followUp.prfSalt)).toBe(
        bytesToBase64(authenticator.creations[0].prfSalt),
      );
      expect(authenticator.abandoned).toHaveLength(0);

      const outcome = await unlockWithPasskey({
        owner: OWNER_A,
        platform: authenticator,
      });
      expect(outcome.outcome).toBe('unlocked');
    });

    test('7: a follow-up assertion that returns no PRF output is unsupported and abandons', async () => {
      authenticator.createMode = 'prf-deferred';
      authenticator.assertMode = 'null';

      await expect(enrol(OWNER_A, authenticator)).resolves.toBe('unsupported');

      expect(authenticator.assertions).toHaveLength(1);
      expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
      expect(authenticator.abandoned).toHaveLength(1);
    });

    test('8: a follow-up assertion that throws is failed, stores nothing, and abandons', async () => {
      authenticator.createMode = 'prf-deferred';
      authenticator.assertMode = 'cancel';

      await expect(enrol(OWNER_A, authenticator)).resolves.toBe('failed');

      expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
      expect(authenticator.abandoned).toHaveLength(1);
    });

    test('9: a PRF output that is not 32 bytes is unsupported', async () => {
      authenticator.createMode = 'prf-short';

      await expect(enrol(OWNER_A, authenticator)).resolves.toBe('unsupported');

      expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
      expect(authenticator.abandoned).toHaveLength(1);
    });

    test('10: a cancelled create is failed, stores nothing, and does not abandon', async () => {
      authenticator.createMode = 'cancel';

      await expect(enrol(OWNER_A, authenticator)).resolves.toBe('failed');

      expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
      expect(authenticator.abandoned).toHaveLength(0);
    });

    test('21: a storage write refused during enrolment is failed, stores nothing, and abandons the new credential', async () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      await expect(enrol(OWNER_A, authenticator)).resolves.toBe('failed');

      expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
      expect(readPasskeyUnlockRecord(OWNER_A)).toBeUndefined();
      expect(authenticator.abandoned).toHaveLength(1);
      expect(bytesToBase64(authenticator.abandoned[0])).toBe(
        bytesToBase64(authenticator.requireCreatedCredentialId()),
      );
    });

    test('22: a throwing abandonCredential on the no-PRF path still resolves unsupported', async () => {
      authenticator.createMode = 'prf-unsupported';
      authenticator.abandonRejects = true;

      await expect(enrol(OWNER_A, authenticator)).resolves.toBe('unsupported');

      expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
      expect(authenticator.abandoned).toHaveLength(1);
    });
  });

  describe('unlock — not enrolled and failure fall-backs keep the record', () => {
    test('11: unlock with nothing enrolled is not-enrolled and makes no platform call', async () => {
      await expect(
        unlockWithPasskey({ owner: OWNER_A, platform: authenticator }),
      ).resolves.toEqual({ outcome: 'not-enrolled' });

      expect(authenticator.assertions).toHaveLength(0);
    });

    test('12: a cancelled assertion is failed and the record is kept', async () => {
      await enrol(OWNER_A, authenticator);
      authenticator.assertMode = 'cancel';

      await expect(
        unlockWithPasskey({ owner: OWNER_A, platform: authenticator }),
      ).resolves.toEqual({ outcome: 'failed' });

      expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(true);
    });

    test('13: an assertion with no PRF output is failed and the record is kept', async () => {
      await enrol(OWNER_A, authenticator);
      authenticator.assertMode = 'null';

      await expect(
        unlockWithPasskey({ owner: OWNER_A, platform: authenticator }),
      ).resolves.toEqual({ outcome: 'failed' });

      expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(true);
    });

    test('14: a PRF output that is a different key fails to decrypt, and the record is kept', async () => {
      await enrol(OWNER_A, authenticator);
      authenticator.assertMode = 'wrong-key';

      await expect(
        unlockWithPasskey({ owner: OWNER_A, platform: authenticator }),
      ).resolves.toEqual({ outcome: 'failed' });

      expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(true);
    });
  });

  describe('owner isolation', () => {
    test('15: owner A enrolment is not unlockable as owner B and does not affect B offer', async () => {
      await enrol(OWNER_A, authenticator);

      await expect(
        unlockWithPasskey({ owner: OWNER_B, platform: authenticator }),
      ).resolves.toEqual({ outcome: 'not-enrolled' });
      expect(authenticator.assertions).toHaveLength(0);

      expect(isPasskeyUnlockEnrolled(OWNER_B)).toBe(false);
      await expect(
        canOfferPasskeyUnlock({ owner: OWNER_B, platform: authenticator }),
      ).resolves.toBe(true);
    });
  });

  describe('canOfferPasskeyUnlock — when the one-time offer may show', () => {
    test('16: true when the platform can create passkeys and there is no record or offer', async () => {
      await expect(
        canOfferPasskeyUnlock({ owner: OWNER_A, platform: authenticator }),
      ).resolves.toBe(true);
    });

    test('17: false once the owner is enrolled', async () => {
      await enrol(OWNER_A, authenticator);

      await expect(
        canOfferPasskeyUnlock({ owner: OWNER_A, platform: authenticator }),
      ).resolves.toBe(false);
    });

    test('18: false after the offer was recorded', async () => {
      recordPasskeyUnlockOffered(OWNER_A);

      await expect(
        canOfferPasskeyUnlock({ owner: OWNER_A, platform: authenticator }),
      ).resolves.toBe(false);
    });

    test.each([
      ['the platform says no', { canCreate: false, canCreateRejects: false }],
      [
        'the platform check rejects',
        { canCreate: true, canCreateRejects: true },
      ],
    ])('19: false when %s', async (_label, platform) => {
      authenticator.canCreate = platform.canCreate;
      authenticator.canCreateRejects = platform.canCreateRejects;

      await expect(
        canOfferPasskeyUnlock({ owner: OWNER_A, platform: authenticator }),
      ).resolves.toBe(false);
    });
  });

  describe('recordPasskeyUnlockOffered — storage failure', () => {
    test('20: does not throw when storage refuses the write, and the offer stays open', async () => {
      const setItem = jest
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('QuotaExceededError');
        });

      expect(() => recordPasskeyUnlockOffered(OWNER_A)).not.toThrow();
      expect(setItem).toHaveBeenCalledWith(
        'myorganiser_passkey_unlock_offer_v1:user-a',
        JSON.stringify({ version: 1, owner: OWNER_A }),
      );

      await expect(
        canOfferPasskeyUnlock({ owner: OWNER_A, platform: authenticator }),
      ).resolves.toBe(true);
    });
  });
});

/** Recover the Master Key a real Local Vault was created with, through its recovery wrapping. */
async function recoverMasterKeyWithRecoveryKey(
  owner: string,
  recoveryKey: string,
): Promise<Uint8Array> {
  const stored = JSON.parse(
    localStorage.getItem(localVaultStorageKey(owner)) ?? 'null',
  ) as { vault: VaultStorageV1 } | null;
  if (!stored) throw new Error('No Local Vault was stored for this owner');
  const wrapped = stored.vault.masterKeyWrappedWithRecoveryKey;
  return aesGcmDecrypt({
    key: await importAesGcmKey(base64ToBytes(recoveryKey)),
    iv: base64ToBytes(wrapped.iv),
    ciphertext: base64ToBytes(wrapped.ciphertext),
  });
}

function enrolVaultKey(owner: string, masterKeyBytes: Uint8Array) {
  return enrolPasskeyUnlock({
    owner,
    masterKeyBytes,
    userName: `${owner}@example.test`,
    platform: authenticator,
  });
}

describe('unlockWithPasskey — a stale wrapping or lost credential deletes the record (ADR 0136, decision 6)', () => {
  test('23: a verifier that accepts the recovered Master Key unlocks and is handed that key', async () => {
    await enrol(OWNER_A, authenticator);
    const verifyMasterKey = jest.fn<Promise<boolean>, [Uint8Array]>(
      async () => true,
    );

    const outcome = await unlockWithPasskey({
      owner: OWNER_A,
      platform: authenticator,
      verifyMasterKey,
    });

    expect(outcome.outcome).toBe('unlocked');
    expect(verifyMasterKey).toHaveBeenCalledTimes(1);
    const [verified] = verifyMasterKey.mock.calls[0];
    expect(Array.from(verified)).toEqual(Array.from(MASTER_KEY));
    expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(true);
  });

  test('24: a verifier that rejects the recovered key is stale, deletes the record, and returns no key', async () => {
    await enrol(OWNER_A, authenticator);
    const verifyMasterKey = jest.fn<Promise<boolean>, [Uint8Array]>(
      async () => false,
    );

    await expect(
      unlockWithPasskey({
        owner: OWNER_A,
        platform: authenticator,
        verifyMasterKey,
      }),
    ).resolves.toEqual({ outcome: 'stale' });

    expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
    const assertionsBefore = authenticator.assertions.length;
    await expect(
      unlockWithPasskey({ owner: OWNER_A, platform: authenticator }),
    ).resolves.toEqual({ outcome: 'not-enrolled' });
    expect(authenticator.assertions).toHaveLength(assertionsBefore);
  });

  test('25: a stale check for one owner leaves another owner’s record in place', async () => {
    await enrol(OWNER_A, authenticator);
    await enrol(OWNER_B, authenticator);
    const verifyMasterKey = jest.fn<Promise<boolean>, [Uint8Array]>(
      async () => false,
    );

    await unlockWithPasskey({
      owner: OWNER_A,
      platform: authenticator,
      verifyMasterKey,
    });

    expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
    expect(isPasskeyUnlockEnrolled(OWNER_B)).toBe(true);
  });

  test('26: a credential the browser reports as gone is credential-gone and the record is deleted', async () => {
    await enrol(OWNER_A, authenticator);
    authenticator.assertMode = 'gone';

    await expect(
      unlockWithPasskey({ owner: OWNER_A, platform: authenticator }),
    ).resolves.toEqual({ outcome: 'credential-gone' });

    expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
  });

  test('27: a verifier that cannot run is failed, not stale, and the record is kept', async () => {
    await enrol(OWNER_A, authenticator);
    const verifyMasterKey = jest.fn<Promise<boolean>, [Uint8Array]>(() => {
      throw new Error('No Local Vault to check the Master Key against');
    });

    await expect(
      unlockWithPasskey({
        owner: OWNER_A,
        platform: authenticator,
        verifyMasterKey,
      }),
    ).resolves.toEqual({ outcome: 'failed' });

    expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(true);
  });

  test('28: a cancelled check never reaches the verifier and keeps the record', async () => {
    await enrol(OWNER_A, authenticator);
    authenticator.assertMode = 'cancel';
    const verifyMasterKey = jest.fn<Promise<boolean>, [Uint8Array]>(
      async () => false,
    );

    await expect(
      unlockWithPasskey({
        owner: OWNER_A,
        platform: authenticator,
        verifyMasterKey,
      }),
    ).resolves.toEqual({ outcome: 'failed' });

    expect(verifyMasterKey).not.toHaveBeenCalled();
    expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(true);
  });
});

describe('Passkey Unlock over a real Vault Handle (ADR 0136, decision 6)', () => {
  test('29: a passphrase change and a Recovery Key rotation keep the enrolment unlocking the same Master Key', async () => {
    const handle = createVaultHandle({ owner: OWNER_A });
    const { recoveryKey } = await handle.initialize({
      passphrase: OLD_PASSPHRASE,
    });
    await handle.unlockWithPassphrase({ passphrase: OLD_PASSPHRASE });
    await handle.saveEncryptedData({ type: 'tasks', value: [] });
    const masterKeyBytes = await recoverMasterKeyWithRecoveryKey(
      OWNER_A,
      recoveryKey,
    );
    await expect(enrolVaultKey(OWNER_A, masterKeyBytes)).resolves.toBe(
      'enrolled',
    );

    await handle.changePassphrase({
      currentPassphrase: OLD_PASSPHRASE,
      newPassphrase: NEW_PASSPHRASE,
    });
    await handle.rotateRecoveryKey({
      currentPassphrase: NEW_PASSPHRASE,
      recoveryKey: mintRecoveryKey(),
    });

    const outcome = await unlockWithPasskey({
      owner: OWNER_A,
      platform: authenticator,
      verifyMasterKey: (bytes) =>
        masterKeyOpensLocalVault({ owner: OWNER_A, masterKeyBytes: bytes }),
    });

    expect(outcome.outcome).toBe('unlocked');
    if (outcome.outcome !== 'unlocked') return;
    expect(Array.from(outcome.masterKeyBytes)).toEqual(
      Array.from(masterKeyBytes),
    );
    await expect(
      masterKeyOpensLocalVault({
        owner: OWNER_A,
        masterKeyBytes: outcome.masterKeyBytes,
      }),
    ).resolves.toBe(true);
    expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(true);
  }, 30_000);

  test('30: a Local Vault replaced since enrolment is stale: the record is deleted', async () => {
    const first = createVaultHandle({ owner: OWNER_A });
    const { recoveryKey } = await first.initialize({
      passphrase: OLD_PASSPHRASE,
    });
    await first.unlockWithPassphrase({ passphrase: OLD_PASSPHRASE });
    await first.saveEncryptedData({ type: 'tasks', value: [] });
    const enrolledKey = await recoverMasterKeyWithRecoveryKey(
      OWNER_A,
      recoveryKey,
    );
    await expect(enrolVaultKey(OWNER_A, enrolledKey)).resolves.toBe('enrolled');

    // A different Vault now sits where this owner's Local Vault was.
    localStorage.removeItem(localVaultStorageKey(OWNER_A));
    const replacement = createVaultHandle({ owner: OWNER_A });
    await replacement.initialize({ passphrase: NEW_PASSPHRASE });
    await replacement.unlockWithPassphrase({ passphrase: NEW_PASSPHRASE });
    await replacement.saveEncryptedData({ type: 'tasks', value: [] });

    await expect(
      unlockWithPasskey({
        owner: OWNER_A,
        platform: authenticator,
        verifyMasterKey: (bytes) =>
          masterKeyOpensLocalVault({ owner: OWNER_A, masterKeyBytes: bytes }),
      }),
    ).resolves.toEqual({ outcome: 'stale' });
    expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
  }, 30_000);
});

describe('disablePasskeyUnlock', () => {
  test('deletes only this owner’s record and keeps the answered offer', async () => {
    await enrol(OWNER_A, authenticator);
    await enrol(OWNER_B, authenticator);
    recordPasskeyUnlockOffered(OWNER_A);

    expect(disablePasskeyUnlock(OWNER_A)).toBe(true);

    expect(isPasskeyUnlockEnrolled(OWNER_A)).toBe(false);
    expect(isPasskeyUnlockEnrolled(OWNER_B)).toBe(true);
    await expect(
      canOfferPasskeyUnlock({ owner: OWNER_A, platform: authenticator }),
    ).resolves.toBe(false);
  });
});

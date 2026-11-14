/**
 * Handle-level tests for the rewrap writes: `changePassphrase`,
 * `resetPassphrase` and `rotateRecoveryKey` (ADR 0143).
 *
 * A rewrap reads the Local Vault, then awaits its crypto before it writes. The
 * write is built on a fresh read taken after those awaits, so a Vault Blob
 * written meanwhile survives it; and it refuses, rather than overwrites, when
 * another writer moved the wrapping meanwhile.
 *
 * Another tab is a second Vault Handle on the same owner's Local Vault, which is
 * how a second writer reaches the same localStorage slot in production.
 *
 * Uses REAL WebCrypto and the real Local Vault storage. The one thing controlled
 * is where a rewrap's key derivation completes: `holdDerivationFor` parks the
 * next derivation for a given passphrase, so a test can land another writer
 * inside the rewrap's awaits rather than racing WebCrypto's completion order.
 * Every other derivation is real and untouched.
 */

jest.mock('./crypto', () => {
  const actual = jest.requireActual('./crypto');
  return {
    ...actual,
    deriveKeyFromPassphrase: async (options: { passphrase: string }) => {
      const index = heldDerivations.findIndex(
        (hold) => hold.passphrase === options.passphrase,
      );
      if (index !== -1) {
        const [hold] = heldDerivations.splice(index, 1);
        hold.markReached();
        await hold.gate;
      }
      return actual.deriveKeyFromPassphrase(options);
    },
  };
});

import { mintRecoveryKey, type MintedRecoveryKey } from './recoveryKeyMint';
import {
  createVaultHandle,
  VaultSecretMismatchError,
  VaultWrappingMovedError,
  type VaultHandle,
} from './vaultHandle';

const OWNER = 'user-1';
const PASSPHRASE = 'vault key 2026';
const NEW_PASSPHRASE = 'next key 2026';
const OTHER_PASSPHRASE = 'third key 2026';
const ROTATED_RECOVERY_KEY: MintedRecoveryKey = mintRecoveryKey();

type DerivationHold = {
  passphrase: string;
  markReached: () => void;
  gate: Promise<void>;
  release: () => void;
};

/** Derivations currently parked by `holdDerivationFor`. Read by the mock above. */
const heldDerivations: DerivationHold[] = [];

/**
 * Park the next key derivation for `passphrase`.
 *
 * `reached` resolves once the rewrap has read the Local Vault and is waiting on
 * its derivation, which is inside its crypto awaits and before any write.
 * Nothing is written by the rewrap until `release` is called.
 */
function holdDerivationFor(passphrase: string): {
  reached: Promise<void>;
  release: () => void;
} {
  let markReached: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  heldDerivations.push({ passphrase, markReached, gate, release });
  return { reached, release };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  // Never leave a parked derivation behind for a later test.
  for (const hold of heldDerivations.splice(0)) hold.release();
});

/** An unlocked Vault for `OWNER`, opened by its passphrase. */
async function openVault() {
  const handle = createVaultHandle({ owner: OWNER });
  const { recoveryKey } = await handle.initialize({ passphrase: PASSPHRASE });
  await handle.unlockWithPassphrase({ passphrase: PASSPHRASE });
  return { handle, recoveryKey };
}

/** An unlocked Vault for `OWNER`, opened by its Recovery Key alone. */
async function openVaultByRecoveryKey() {
  const handle = createVaultHandle({ owner: OWNER });
  const { recoveryKey } = await handle.initialize({ passphrase: PASSPHRASE });
  await handle.unlockWithRecoveryKey({ recoveryKey });
  return { handle, recoveryKey };
}

/** Another tab for the same owner: a second handle on the same Local Vault. */
async function otherTab(): Promise<VaultHandle> {
  const tab = createVaultHandle({ owner: OWNER });
  await tab.unlockWithPassphrase({ passphrase: PASSPHRASE });
  return tab;
}

/** A plaintext envelope with one record, distinguishable by `title`. */
function envelope(title: string) {
  return { records: [{ id: title, title }], deletions: {} };
}

/**
 * The three rewraps, as the handle exposes them. `heldPassphrase` is the
 * passphrase whose derivation the rewrap is parked on: the new passphrase for
 * the two passphrase changes, and the current one for the Recovery Key
 * rotation, whose first derivation is the current passphrase check.
 */
const rewraps = [
  {
    name: 'changePassphrase',
    heldPassphrase: NEW_PASSPHRASE,
    open: openVault,
    start: (handle: VaultHandle) =>
      handle.changePassphrase({
        currentPassphrase: PASSPHRASE,
        newPassphrase: NEW_PASSPHRASE,
      }),
    expectNewWrapping: async () => {
      await expect(
        createVaultHandle({ owner: OWNER }).unlockWithPassphrase({
          passphrase: PASSPHRASE,
        }),
      ).rejects.toBeInstanceOf(VaultSecretMismatchError);
      const fresh = createVaultHandle({ owner: OWNER });
      await fresh.unlockWithPassphrase({ passphrase: NEW_PASSPHRASE });
      return fresh;
    },
  },
  {
    name: 'resetPassphrase',
    heldPassphrase: NEW_PASSPHRASE,
    open: openVaultByRecoveryKey,
    start: (handle: VaultHandle) =>
      handle.resetPassphrase({ newPassphrase: NEW_PASSPHRASE }),
    expectNewWrapping: async () => {
      await expect(
        createVaultHandle({ owner: OWNER }).unlockWithPassphrase({
          passphrase: PASSPHRASE,
        }),
      ).rejects.toBeInstanceOf(VaultSecretMismatchError);
      const fresh = createVaultHandle({ owner: OWNER });
      await fresh.unlockWithPassphrase({ passphrase: NEW_PASSPHRASE });
      return fresh;
    },
  },
  {
    name: 'rotateRecoveryKey',
    heldPassphrase: PASSPHRASE,
    open: openVault,
    start: (handle: VaultHandle) =>
      handle.rotateRecoveryKey({
        currentPassphrase: PASSPHRASE,
        recoveryKey: ROTATED_RECOVERY_KEY,
      }),
    expectNewWrapping: async (initialRecoveryKey: string) => {
      await expect(
        createVaultHandle({ owner: OWNER }).unlockWithRecoveryKey({
          recoveryKey: initialRecoveryKey as MintedRecoveryKey,
        }),
      ).rejects.toBeInstanceOf(VaultSecretMismatchError);
      const fresh = createVaultHandle({ owner: OWNER });
      await fresh.unlockWithRecoveryKey({
        recoveryKey: ROTATED_RECOVERY_KEY,
      });
      return fresh;
    },
  },
];

describe.each(rewraps)(
  '$name writes over a contended Local Vault (ADR 0143)',
  (rewrap) => {
    test('a Vault Blob another tab writes during the awaits is still stored afterwards, and the new wrapping opens the Vault', async () => {
      const { handle, recoveryKey } = await rewrap.open();
      const tab = await otherTab();
      const kdfBefore = handle.loadVault()?.kdf;
      const hold = holdDerivationFor(rewrap.heldPassphrase);

      const pendingRewrap = rewrap.start(handle);
      await hold.reached;
      await tab.saveEncryptedData({
        type: 'tasks',
        value: envelope('other-tab-save'),
      });
      hold.release();
      await pendingRewrap;

      expect(
        await handle.loadDecryptedData({ type: 'tasks', defaultValue: null }),
      ).toEqual(envelope('other-tab-save'));
      expect(handle.loadVault()?.kdf).toEqual(kdfBefore);

      const fresh = await rewrap.expectNewWrapping(recoveryKey);
      expect(
        await fresh.loadDecryptedData({ type: 'tasks', defaultValue: null }),
      ).toEqual(envelope('other-tab-save'));
    });

    test('a wrapping another tab moves during the awaits makes it throw VaultWrappingMovedError, and the stored Local Vault stays as the other tab left it', async () => {
      const { handle } = await rewrap.open();
      const tab = await otherTab();
      const hold = holdDerivationFor(rewrap.heldPassphrase);

      // Caught up front so a rejection that lands before the assertion is not
      // reported as unhandled.
      const pendingRewrap = rewrap
        .start(handle)
        .catch((error: unknown) => error);
      await hold.reached;
      await tab.changePassphrase({
        currentPassphrase: PASSPHRASE,
        newPassphrase: OTHER_PASSPHRASE,
      });
      const storedByOtherTab = tab.loadVault();
      hold.release();
      const error = await pendingRewrap;

      expect(error).toBeInstanceOf(VaultWrappingMovedError);
      expect(error).toMatchObject({ code: 'vault-wrapping-moved' });
      expect(handle.loadVault()).toEqual(storedByOtherTab);

      const fresh = createVaultHandle({ owner: OWNER });
      await expect(
        fresh.unlockWithPassphrase({ passphrase: OTHER_PASSPHRASE }),
      ).resolves.toBeDefined();
    });
  },
);

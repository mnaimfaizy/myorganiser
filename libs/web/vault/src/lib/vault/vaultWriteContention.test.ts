/**
 * Handle-level tests for conditional Local Vault writes (ADR 0143).
 *
 * A save reads its type's Ciphertext before its crypto awaits and writes only
 * if that Ciphertext is still stored. Another tab is modelled as a second
 * Vault Handle on the same owner's Local Vault, which is how a second writer
 * reaches the same localStorage slot in production.
 *
 * Uses REAL WebCrypto and the real Local Vault storage, as neighbouring suites
 * do. The one thing controlled is the point at which a save's encryption
 * completes: `holdEncryptionOf` parks the encryption of a save whose plaintext
 * carries a marker, so a test can land another writer at a known point rather
 * than racing WebCrypto's completion order. Every other encryption is real and
 * untouched.
 */

jest.mock('./crypto', () => {
  const actual = jest.requireActual('./crypto');
  return {
    ...actual,
    aesGcmEncrypt: async (options: {
      key: CryptoKey;
      plaintext: Uint8Array;
      iv: Uint8Array;
    }) => {
      const text = actual.bytesToUtf8(options.plaintext);
      for (const hold of mockEncryptionHolds) {
        if (text.includes(hold.marker)) {
          hold.markReached();
          await hold.gate;
        }
      }
      return actual.aesGcmEncrypt(options);
    },
  };
});

import {
  createLocalVaultRevision,
  type LocalVaultRevision,
} from './localVaultRevision';
import type { EncryptedBlob } from './localVaultStorage';
import { VaultWriteContendedError } from './localVaultAccess';
import { saveVaultRecords } from './vaultRecordWrite';
import {
  createVaultHandle,
  type VaultHandle,
  type VaultSyncSink,
} from './vaultHandle';

const OWNER = 'user-1';
const PASSPHRASE = 'vault key 2026';

type EncryptionHold = {
  marker: string;
  markReached: () => void;
  gate: Promise<void>;
  release: () => void;
};

/** Encryptions currently parked by `holdEncryptionOf`. Read by the mock above. */
const mockEncryptionHolds: EncryptionHold[] = [];

/**
 * Park the encryption of the next save whose plaintext contains `marker`.
 *
 * `reached` resolves once that save has run everything before its encryption,
 * including reading its expectation, and is now waiting. Nothing is written
 * for it until `release` is called.
 */
function holdEncryptionOf(marker: string): {
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
  mockEncryptionHolds.push({ marker, markReached, gate, release });
  return { reached, release };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  // Never leave a parked encryption behind for a later test.
  for (const hold of mockEncryptionHolds.splice(0)) hold.release();
});

/** An unlocked Vault for `OWNER`, created on this device. */
async function openVault(
  options: {
    revision?: LocalVaultRevision;
    syncSink?: VaultSyncSink;
  } = {},
): Promise<VaultHandle> {
  const handle = createVaultHandle({ owner: OWNER, ...options });
  await handle.initialize({ passphrase: PASSPHRASE });
  await handle.unlockWithPassphrase({ passphrase: PASSPHRASE });
  return handle;
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

describe('Local Vault write contention (ADR 0143)', () => {
  test('a write to another type made while a save is parked mid-encryption survives it', async () => {
    const handle = await openVault();
    const tab = await otherTab();
    const hold = holdEncryptionOf('task-a');

    const pendingTasks = handle.saveEncryptedData({
      type: 'tasks',
      value: envelope('task-a'),
    });
    await hold.reached;
    await tab.saveEncryptedData({
      type: 'addresses',
      value: envelope('address-b'),
    });
    hold.release();
    await pendingTasks;

    expect(
      await handle.loadDecryptedData({ type: 'addresses', defaultValue: null }),
    ).toEqual(envelope('address-b'));
    expect(
      await handle.loadDecryptedData({ type: 'tasks', defaultValue: null }),
    ).toEqual(envelope('task-a'));
  });

  test('a save whose type moved in another tab while it was parked throws VaultWriteContendedError, writes nothing, and reports nothing to the sync sink', async () => {
    const syncSink = { vaultBlobChanged: jest.fn() };
    const handle = await openVault({ syncSink });
    await handle.saveEncryptedData({ type: 'tasks', value: envelope('first') });
    syncSink.vaultBlobChanged.mockClear();
    const tab = await otherTab();
    const hold = holdEncryptionOf('this-tab-save');

    // Caught up front so a rejection that lands before the assertion is not
    // reported as unhandled.
    const pendingSave = handle
      .saveEncryptedData({ type: 'tasks', value: envelope('this-tab-save') })
      .catch((error: unknown) => error);
    await hold.reached;
    await tab.saveEncryptedData({
      type: 'tasks',
      value: envelope('other-tab-save'),
    });
    hold.release();
    const error = await pendingSave;

    expect(error).toBeInstanceOf(VaultWriteContendedError);
    expect(error).toMatchObject({ type: 'tasks' });
    expect(
      await handle.loadDecryptedData({ type: 'tasks', defaultValue: null }),
    ).toEqual(envelope('other-tab-save'));
    expect(syncSink.vaultBlobChanged).not.toHaveBeenCalled();
  });

  test('a successful save leaves the Local Vault Revision alone and reports the type to the sync sink only after its write has landed', async () => {
    const revision = createLocalVaultRevision();
    let storedWhenReported: EncryptedBlob | undefined;
    const syncSink = {
      vaultBlobChanged: jest.fn(() => {
        storedWhenReported = handle.loadVault()?.data.tasks;
      }),
    };
    const handle = await openVault({ revision, syncSink });
    const revisionBefore = revision.current();
    syncSink.vaultBlobChanged.mockClear();

    await handle.saveEncryptedData({ type: 'tasks', value: envelope('saved') });

    expect(revision.current()).toBe(revisionBefore);
    expect(syncSink.vaultBlobChanged).toHaveBeenCalledTimes(1);
    expect(syncSink.vaultBlobChanged).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tasks' }),
    );
    expect(storedWhenReported).toBeDefined();
    expect(storedWhenReported).toEqual(handle.loadVault()?.data.tasks);
  });

  test('an explicit expectedCiphertext that is not the stored Ciphertext throws and writes nothing; the stored Ciphertext writes', async () => {
    const handle = await openVault();
    await handle.saveEncryptedData({
      type: 'tasks',
      value: envelope('stored'),
    });
    const stored = handle.loadVault()?.data.tasks;
    const stale: EncryptedBlob = { iv: 'stale-iv', ciphertext: 'stale-ct' };

    await expect(
      handle.saveEncryptedData({
        type: 'tasks',
        value: envelope('rejected'),
        expectedCiphertext: stale,
      }),
    ).rejects.toBeInstanceOf(VaultWriteContendedError);
    expect(handle.loadVault()?.data.tasks).toEqual(stored);

    await handle.saveEncryptedData({
      type: 'tasks',
      value: envelope('accepted'),
      expectedCiphertext: stored,
    });
    expect(
      await handle.loadDecryptedData({ type: 'tasks', defaultValue: null }),
    ).toEqual(envelope('accepted'));
  });

  test('expectedCiphertext null writes only while nothing is stored for the type', async () => {
    const handle = await openVault();

    await handle.saveEncryptedData({
      type: 'tasks',
      value: envelope('first'),
      expectedCiphertext: null,
    });
    expect(
      await handle.loadDecryptedData({ type: 'tasks', defaultValue: null }),
    ).toEqual(envelope('first'));

    await expect(
      handle.saveEncryptedData({
        type: 'tasks',
        value: envelope('second'),
        expectedCiphertext: null,
      }),
    ).rejects.toBeInstanceOf(VaultWriteContendedError);
    expect(
      await handle.loadDecryptedData({ type: 'tasks', defaultValue: null }),
    ).toEqual(envelope('first'));
  });

  test('loadDecryptedDataWithCiphertext returns the decrypted value together with the exact stored blob', async () => {
    const handle = await openVault();
    await handle.saveEncryptedData({
      type: 'tasks',
      value: envelope('read-back'),
    });
    const stored = handle.loadVault()?.data.tasks;
    expect(stored).toBeDefined();

    await expect(
      handle.loadDecryptedDataWithCiphertext({
        type: 'tasks',
        defaultValue: null,
      }),
    ).resolves.toEqual({ value: envelope('read-back'), ciphertext: stored });
  });

  test('loadDecryptedDataWithCiphertext answers the default and a null Ciphertext when the type is absent', async () => {
    const handle = await openVault();

    await expect(
      handle.loadDecryptedDataWithCiphertext({
        type: 'groceries',
        defaultValue: [] as unknown[],
      }),
    ).resolves.toEqual({ value: [], ciphertext: null });
  });

  test('saveVaultRecords over a real handle: another tab writing the type between the funnel read and its write resolves with the merged records, and the stored Local Vault decrypts to that merge', async () => {
    const handle = await openVault();
    const tab = await otherTab();
    const hold = holdEncryptionOf('funnel-record');
    // Task-shaped, because the stored side is normalized before the merge.
    const theirs = {
      id: 'tab-record',
      title: 'Written in another tab',
      status: 'pending',
      priority: 'medium',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T09:00:00.000Z',
    };
    const mine = {
      id: 'funnel-record',
      title: 'funnel-record',
      updatedAt: '2026-01-01T10:00:00.000Z',
    };

    // Parked once the funnel has read the (empty) type and is about to write.
    const pendingFunnel = saveVaultRecords(handle, 'tasks', [mine]);
    await hold.reached;
    await tab.saveEncryptedData({
      type: 'tasks',
      value: { records: [theirs], deletions: {} },
    });
    hold.release();
    const result = await pendingFunnel;

    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([theirs, mine]));
    expect(
      await handle.loadDecryptedData({ type: 'tasks', defaultValue: null }),
    ).toEqual({ records: result, deletions: {} });
  });
});

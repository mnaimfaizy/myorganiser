/**
 * Tests for Vault Handle Local Vault Revision integration.
 *
 * Verifies that saveVault() and removeVault() bump the revision to signal
 * readers that the Local Vault has been replaced (e.g. by convergence),
 * while saveEncryptedData() deliberately does NOT bump it (since it names
 * a single Vault Blob Type and goes through the sync sink instead).
 *
 * ADR 0047, #587.
 */

// === Crypto mocking ===
let mockRandomBytesCounter = 0;

jest.mock('./crypto', () => {
  const actual = jest.requireActual('./crypto');
  return {
    ...actual,
    randomBytes: jest.fn((length: number): Uint8Array => {
      const bytes = new Uint8Array(length);
      const seed = mockRandomBytesCounter++;
      for (let i = 0; i < length; i++) {
        bytes[i] = (seed + i) % 256;
      }
      return bytes;
    }),
    deriveKeyFromPassphrase: jest.fn(
      async (): Promise<CryptoKey> =>
        ({
          type: 'secret',
          extractable: false,
          algorithm: { name: 'PBKDF2' },
          usages: ['encrypt', 'decrypt'],
          __mockKey: 'derived-from-passphrase',
        }) as unknown as CryptoKey,
    ),
    importAesGcmKey: jest.fn(async (rawKey: Uint8Array): Promise<CryptoKey> => {
      if (!rawKey || !(rawKey instanceof Uint8Array)) {
        throw new Error('Invalid key material');
      }
      return {
        type: 'secret',
        extractable: false,
        algorithm: { name: 'AES-GCM' },
        usages: ['encrypt', 'decrypt'],
        __mockKey: `imported-${rawKey[0]}-${rawKey[rawKey.length - 1]}`,
      } as unknown as CryptoKey;
    }),
    aesGcmEncrypt: jest.fn(
      async (options: {
        key: CryptoKey;
        plaintext: Uint8Array;
        iv: Uint8Array;
      }): Promise<Uint8Array> => {
        const keyObj = options.key as unknown as { __mockKey?: string };
        const keyMarker = keyObj.__mockKey || 'unknown';
        let keyByte = 0xff;
        for (let i = 0; i < keyMarker.length; i++) {
          keyByte = (keyByte + keyMarker.charCodeAt(i)) & 0xff;
        }
        const padLength = Math.max(0, options.plaintext.length);
        const padding = new Uint8Array(padLength).fill(keyByte);
        return new Uint8Array([...options.plaintext, ...padding]);
      },
    ),
    aesGcmDecrypt: jest.fn(
      async (options: {
        key: CryptoKey;
        ciphertext: Uint8Array;
        iv: Uint8Array;
      }): Promise<Uint8Array> => {
        const plaintextLength = options.ciphertext.length / 2;
        if (
          plaintextLength <= 0 ||
          plaintextLength > options.ciphertext.length
        ) {
          throw new Error('Invalid ciphertext length');
        }
        return options.ciphertext.slice(0, plaintextLength);
      },
    ),
  };
});

import type { VaultStorageV1 } from './localVaultStorage';
import { localVaultStorageKey } from './localVaultStorage';
import { createLocalVaultRevision } from './localVaultRevision';
import { createVaultHandle } from './vaultHandle';
import { localToServerMeta } from './vaultShapes';

const LS_KEY_USER_A = localVaultStorageKey('user-a');

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  mockRandomBytesCounter = 0;
});

describe('createVaultHandle with revision', () => {
  describe('saveVault() bumps revision', () => {
    it('saveVault() increments revision counter', () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({
        owner: 'user-a',
        revision,
      });

      expect(revision.current()).toBe(0);

      const vault: VaultStorageV1 = {
        version: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: 310000,
          salt: 'c2FsdA==',
        },
        masterKeyWrappedWithPassphrase: {
          iv: 'aS1h',
          ciphertext: 'Y3QtYQ==',
        },
        masterKeyWrappedWithRecoveryKey: {
          iv: 'aS1i',
          ciphertext: 'Y3QtYg==',
        },
        data: {},
      };

      handle.saveVault(vault);

      expect(revision.current()).toBe(1);
    });

    it('multiple saveVault() calls each bump revision', () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({
        owner: 'user-a',
        revision,
      });

      const vault: VaultStorageV1 = {
        version: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: 310000,
          salt: 'c2FsdA==',
        },
        masterKeyWrappedWithPassphrase: {
          iv: 'aS1h',
          ciphertext: 'Y3QtYQ==',
        },
        masterKeyWrappedWithRecoveryKey: {
          iv: 'aS1i',
          ciphertext: 'Y3QtYg==',
        },
        data: {},
      };

      handle.saveVault(vault);
      expect(revision.current()).toBe(1);

      handle.saveVault(vault);
      expect(revision.current()).toBe(2);

      handle.saveVault(vault);
      expect(revision.current()).toBe(3);
    });

    it('revision bump happens synchronously within saveVault', () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({
        owner: 'user-a',
        revision,
      });

      const vault: VaultStorageV1 = {
        version: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: 310000,
          salt: 'c2FsdA==',
        },
        masterKeyWrappedWithPassphrase: {
          iv: 'aS1h',
          ciphertext: 'Y3QtYQ==',
        },
        masterKeyWrappedWithRecoveryKey: {
          iv: 'aS1i',
          ciphertext: 'Y3QtYg==',
        },
        data: {},
      };

      handle.saveVault(vault);
      // Assert synchronously, no await needed
      expect(revision.current()).toBe(1);
    });
  });

  describe('removeVault() bumps revision', () => {
    it('removeVault() increments revision counter', () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({
        owner: 'user-a',
        revision,
      });

      // Setup: write a vault first
      const vault: VaultStorageV1 = {
        version: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: 310000,
          salt: 'c2FsdA==',
        },
        masterKeyWrappedWithPassphrase: {
          iv: 'aS1h',
          ciphertext: 'Y3QtYQ==',
        },
        masterKeyWrappedWithRecoveryKey: {
          iv: 'aS1i',
          ciphertext: 'Y3QtYg==',
        },
        data: {},
      };
      handle.saveVault(vault);
      expect(revision.current()).toBe(1);

      // Remove and expect bump
      handle.removeVault();
      expect(revision.current()).toBe(2);
    });
  });

  describe('initialize() bumps revision', () => {
    it('initialize() increments revision counter from 0 to 1', async () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({
        owner: 'user-a',
        revision,
      });

      expect(revision.current()).toBe(0);

      await handle.initialize({ passphrase: 'test-phrase' });

      expect(revision.current()).toBe(1);
    });

    it('initialize() bump is observable in subscription callback', async () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({
        owner: 'user-a',
        revision,
      });

      let callbackInvoked = false;
      let vaultStatusInCallback: string | undefined;

      const unsubscribe = revision.subscribe(() => {
        callbackInvoked = true;
        vaultStatusInCallback = handle.vaultStatus();
      });

      await handle.initialize({ passphrase: 'test-phrase' });

      // Cleanup subscription
      unsubscribe();

      // Assert callback was invoked and saw the Vault as owned
      expect(callbackInvoked).toBe(true);
      expect(vaultStatusInCallback).toBe('owned');
    });

    it('initialize() without revision does not throw', async () => {
      const handle = createVaultHandle({ owner: 'user-a' });

      // Should not throw and should return a result with recovery key
      const result = await handle.initialize({
        passphrase: 'test-phrase',
      });

      expect(result).toEqual(
        expect.objectContaining({ recoveryKey: expect.any(String) }),
      );
      expect(result.recoveryKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(result.recoveryKey.length).toBeGreaterThanOrEqual(40);
      expect(handle.vaultStatus()).toBe('owned');
      expect(handle.hasVault()).toBe(true);
    });

    it('initialize() succeeds even when revision.bump() throws', async () => {
      const revision = createLocalVaultRevision();
      const throwingRevision = {
        ...revision,
        bump: jest.fn(() => {
          throw new Error('bump failed');
        }),
      };

      const handle = createVaultHandle({
        owner: 'user-a',
        revision: throwingRevision,
      });

      // Should not throw despite revision.bump() throwing
      const result = await handle.initialize({
        passphrase: 'test-phrase',
      });

      expect(result).toEqual(
        expect.objectContaining({ recoveryKey: expect.any(String) }),
      );
      expect(result.recoveryKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(result.recoveryKey.length).toBeGreaterThanOrEqual(40);
      expect(handle.vaultStatus()).toBe('owned');
      expect(handle.hasVault()).toBe(true);
    });
  });

  describe('saveEncryptedData() does NOT bump revision', () => {
    it('saveEncryptedData() leaves revision unchanged', async () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({
        owner: 'user-a',
        masterKeyBytes: new Uint8Array([1, 2, 3, 4]),
        revision,
      });

      // Initialize vault (bumps revision from 0 to 1)
      await handle.initialize({ passphrase: 'test-pass' });
      await handle.unlockWithPassphrase({ passphrase: 'test-pass' });

      // Save vault to stable state (bumps revision again)
      handle.saveVault(handle.loadVault()!);

      // Capture revision after setup to test that saveEncryptedData does not bump it
      const startRevision = revision.current();

      // Save encrypted data
      await handle.saveEncryptedData({
        type: 'tasks',
        value: [{ id: '1', title: 'Test task' }],
      });

      // Revision should NOT have bumped
      expect(revision.current()).toBe(startRevision);
    });

    it('multiple saveEncryptedData() calls do not bump revision', async () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({
        owner: 'user-a',
        masterKeyBytes: new Uint8Array([1, 2, 3, 4]),
        revision,
      });

      await handle.initialize({ passphrase: 'test-pass' });
      await handle.unlockWithPassphrase({ passphrase: 'test-pass' });

      // Save vault to stable state
      handle.saveVault(handle.loadVault()!);

      // Capture revision after setup to test that saveEncryptedData does not bump it
      const startRevision = revision.current();

      await handle.saveEncryptedData({
        type: 'tasks',
        value: [{ id: '1', title: 'Task 1' }],
      });

      await handle.saveEncryptedData({
        type: 'groceries',
        value: [{ id: 'a', name: 'Milk' }],
      });

      await handle.saveEncryptedData({
        type: 'tasks',
        value: [{ id: '1', title: 'Task 1 updated' }],
      });

      expect(revision.current()).toBe(startRevision);
    });
  });

  describe('handle without revision behaves normally', () => {
    it('saveVault() without revision does not throw', () => {
      const handle = createVaultHandle({ owner: 'user-a' });

      const vault: VaultStorageV1 = {
        version: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: 310000,
          salt: 'c2FsdA==',
        },
        masterKeyWrappedWithPassphrase: {
          iv: 'aS1h',
          ciphertext: 'Y3QtYQ==',
        },
        masterKeyWrappedWithRecoveryKey: {
          iv: 'aS1i',
          ciphertext: 'Y3QtYg==',
        },
        data: {},
      };

      expect(() => handle.saveVault(vault)).not.toThrow();
    });

    it('removeVault() without revision does not throw', () => {
      const handle = createVaultHandle({ owner: 'user-a' });

      const vault: VaultStorageV1 = {
        version: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: 310000,
          salt: 'c2FsdA==',
        },
        masterKeyWrappedWithPassphrase: {
          iv: 'aS1h',
          ciphertext: 'Y3QtYQ==',
        },
        masterKeyWrappedWithRecoveryKey: {
          iv: 'aS1i',
          ciphertext: 'Y3QtYg==',
        },
        data: {},
      };

      localStorage.setItem(
        LS_KEY_USER_A,
        JSON.stringify({
          version: 2,
          owner: 'user-a',
          vault,
        }),
      );

      expect(() => handle.removeVault()).not.toThrow();
    });
  });

  describe('revision.bump() errors are swallowed', () => {
    it('saveVault() succeeds even when revision.bump() throws', () => {
      const revision = createLocalVaultRevision();
      const throwingRevision = {
        ...revision,
        bump: jest.fn(() => {
          throw new Error('bump failed');
        }),
      };

      const handle = createVaultHandle({
        owner: 'user-a',
        revision: throwingRevision,
      });

      const vault: VaultStorageV1 = {
        version: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: 310000,
          salt: 'c2FsdA==',
        },
        masterKeyWrappedWithPassphrase: {
          iv: 'aS1h',
          ciphertext: 'Y3QtYQ==',
        },
        masterKeyWrappedWithRecoveryKey: {
          iv: 'aS1i',
          ciphertext: 'Y3QtYg==',
        },
        data: {},
      };

      // Should not throw despite revision.bump() throwing
      expect(() => handle.saveVault(vault)).not.toThrow();

      // Vault should still be saved
      const stored = JSON.parse(
        localStorage.getItem(LS_KEY_USER_A) || '{}',
      ) as { owner: string; vault: VaultStorageV1 };
      expect(stored.owner).toBe('user-a');
      expect(stored.vault).toEqual(vault);
    });

    it('removeVault() succeeds even when revision.bump() throws', () => {
      const revision = createLocalVaultRevision();
      const throwingRevision = {
        ...revision,
        bump: jest.fn(() => {
          throw new Error('bump failed');
        }),
      };

      const handle = createVaultHandle({
        owner: 'user-a',
        revision: throwingRevision,
      });

      const vault: VaultStorageV1 = {
        version: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: 310000,
          salt: 'c2FsdA==',
        },
        masterKeyWrappedWithPassphrase: {
          iv: 'aS1h',
          ciphertext: 'Y3QtYQ==',
        },
        masterKeyWrappedWithRecoveryKey: {
          iv: 'aS1i',
          ciphertext: 'Y3QtYg==',
        },
        data: {},
      };

      localStorage.setItem(
        LS_KEY_USER_A,
        JSON.stringify({
          version: 2,
          owner: 'user-a',
          vault,
        }),
      );

      // Should not throw despite revision.bump() throwing
      expect(() => handle.removeVault()).not.toThrow();

      // Vault should still be removed
      expect(handle.hasVault()).toBe(false);
    });
  });

  describe('adoptVaultMetaWrapping() bumps revision only when it writes', () => {
    function makeVault(passphraseWrapping: {
      iv: string;
      ciphertext: string;
    }): VaultStorageV1 {
      return {
        version: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: 310000,
          salt: 'c2FsdA==',
        },
        masterKeyWrappedWithPassphrase: passphraseWrapping,
        masterKeyWrappedWithRecoveryKey: {
          iv: 'aS1i',
          ciphertext: 'Y3QtYg==',
        },
        data: {},
      };
    }

    const localWrapping = { iv: 'bG9jYWwtaXY=', ciphertext: 'bG9jYWwtY3Q=' };
    const remoteWrapping = { iv: 'cmVtb3RlLWl2', ciphertext: 'cmVtb3RlLWN0' };

    it('adopted write bumps the revision once', () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({ owner: 'user-a', revision });
      handle.saveVault(makeVault(localWrapping));
      const expectedMeta = localToServerMeta(makeVault(localWrapping));
      const before = revision.current();

      const outcome = handle.adoptVaultMetaWrapping({
        remoteMeta: {
          ...expectedMeta,
          wrapped_mk_passphrase: { version: 1, ...remoteWrapping },
        },
        comparedLocalMeta: expectedMeta,
      });

      expect(outcome).toBe('adopted');
      expect(revision.current()).toBe(before + 1);
    });

    it('wrapping-moved refusal does not bump the revision', () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({ owner: 'user-a', revision });
      // Stored wrapping has moved on from the one the decision was made against.
      handle.saveVault(makeVault({ iv: 'bmV3LWl2', ciphertext: 'bmV3LWN0' }));
      const expectedMeta = localToServerMeta(makeVault(localWrapping));
      const before = revision.current();

      const outcome = handle.adoptVaultMetaWrapping({
        remoteMeta: {
          ...expectedMeta,
          wrapped_mk_passphrase: { version: 1, ...remoteWrapping },
        },
        comparedLocalMeta: expectedMeta,
      });

      expect(outcome).toBe('wrapping-moved');
      expect(revision.current()).toBe(before);
    });

    it('no-local-vault refusal does not bump the revision', () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({ owner: 'user-a', revision });
      const expectedMeta = localToServerMeta(makeVault(localWrapping));
      const before = revision.current();

      const outcome = handle.adoptVaultMetaWrapping({
        remoteMeta: {
          ...expectedMeta,
          wrapped_mk_passphrase: { version: 1, ...remoteWrapping },
        },
        comparedLocalMeta: expectedMeta,
      });

      expect(outcome).toBe('no-local-vault');
      expect(revision.current()).toBe(before);
    });
  });
});

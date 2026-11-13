// `jest.mock` must precede the application imports below, matching the
// sibling suite in `vaultReconcile.test.ts`. No `import/first` suppression
// here: that rule is configured for `web-vault-ui`, not this project, and
// disabling a rule this project does not define is itself a lint error.
jest.mock('./serverVaultSync', () => ({
  getServerVaultMeta: jest.fn(),
}));

const serverVaultSync = jest.requireMock('./serverVaultSync') as {
  getServerVaultMeta: jest.Mock;
};

import type { VaultApi, VaultMetaV1 } from '@myorganiser/app-api-client';
import type { VaultStorageV1 } from './localVaultStorage';
import {
  convergeVaultMeta,
  describeVaultMetaDivergence,
  VAULT_META_CHANGES,
  VAULT_META_CHANGE_ADOPTABLE,
  type VaultMetaChange,
  type VaultMetaConvergePrompt,
  type VaultMetaDecision,
  vaultIdentityOf,
} from './vaultMetaConverge';
import { expectStillPending } from './promisePending.testutil';
import type { ServerVaultMeta } from './serverVaultSync';

function makeLocalVault(
  overrides: Partial<VaultStorageV1> = {},
): VaultStorageV1 {
  return {
    version: 1,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 310_000,
      salt: 'salt-local',
    },
    masterKeyWrappedWithPassphrase: {
      iv: 'iv1-local',
      ciphertext: 'ct1-local',
    },
    masterKeyWrappedWithRecoveryKey: {
      iv: 'iv2-local',
      ciphertext: 'ct2-local',
    },
    data: {
      addresses: { iv: 'aiv', ciphertext: 'act' },
    },
    ...overrides,
  };
}

function makeServerMeta(overrides: Partial<VaultMetaV1> = {}): VaultMetaV1 {
  return {
    version: 1,
    kdf_name: 'PBKDF2',
    kdf_salt: 'salt-local',
    kdf_params: { hash: 'SHA-256', iterations: 310_000 },
    wrapped_mk_passphrase: {
      version: 1,
      iv: 'iv1-local',
      ciphertext: 'ct1-local',
    },
    wrapped_mk_recovery: {
      version: 1,
      iv: 'iv2-local',
      ciphertext: 'ct2-local',
    },
    ...overrides,
  };
}

describe('convergeVaultMeta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===== Skipped paths (no prompt) =====

  test('returns skipped-no-local-vault when localVault is null', async () => {
    const prompt = jest.fn();

    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault: null,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result).toEqual({ kind: 'skipped-no-local-vault' });
    expect(prompt).not.toHaveBeenCalled();
  });

  test('returns skipped-not-authenticated on 401 error and does not throw', async () => {
    const error = new Error('unauth') as Error & {
      response?: { status: number };
    };
    error.response = { status: 401 };
    serverVaultSync.getServerVaultMeta.mockRejectedValue(error);

    const prompt: VaultMetaConvergePrompt = jest.fn();
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault: makeLocalVault(),
      prompt,
      onObserved: jest.fn(),
    });

    expect(result).toEqual({ kind: 'skipped-not-authenticated' });
    expect(prompt).not.toHaveBeenCalled();
  });

  test('returns skipped-not-authenticated on 403 error and does not throw', async () => {
    const error = new Error('forbidden') as Error & {
      response?: { status: number };
    };
    error.response = { status: 403 };
    serverVaultSync.getServerVaultMeta.mockRejectedValue(error);

    const prompt: VaultMetaConvergePrompt = jest.fn();
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault: makeLocalVault(),
      prompt,
      onObserved: jest.fn(),
    });

    expect(result).toEqual({ kind: 'skipped-not-authenticated' });
    expect(prompt).not.toHaveBeenCalled();
  });

  test('rethrows on 500 error', async () => {
    const error = new Error('server error') as Error & {
      response?: { status: number };
    };
    error.response = { status: 500 };
    serverVaultSync.getServerVaultMeta.mockRejectedValue(error);

    const prompt = jest.fn();
    await expect(
      convergeVaultMeta({
        api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
        localVault: makeLocalVault(),
        prompt,
        onObserved: jest.fn(),
      }),
    ).rejects.toThrow('server error');
  });

  test('returns skipped-no-server-meta when getServerVaultMeta resolves to null', async () => {
    serverVaultSync.getServerVaultMeta.mockResolvedValue(null);

    const prompt: VaultMetaConvergePrompt = jest.fn();
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault: makeLocalVault(),
      prompt,
      onObserved: jest.fn(),
    });

    expect(result).toEqual({ kind: 'skipped-no-server-meta' });
    expect(prompt).not.toHaveBeenCalled();
  });

  test('returns noop-already-in-sync when server meta equals local meta', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta(),
    });

    const prompt: VaultMetaConvergePrompt = jest.fn();
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result).toEqual({
      kind: 'noop-already-in-sync',
      observedIdentity: vaultIdentityOf(makeServerMeta()),
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  test('does not read divergence when object keys are in different insertion order', async () => {
    const localVault = makeLocalVault();
    // Create server meta with keys in different order but identical content
    const serverMetaData: VaultMetaV1 = {
      wrapped_mk_recovery: {
        version: 1,
        iv: 'iv2-local',
        ciphertext: 'ct2-local',
      },
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'iv1-local',
        ciphertext: 'ct1-local',
      },
      kdf_params: { hash: 'SHA-256', iterations: 310_000 },
      kdf_salt: 'salt-local',
      kdf_name: 'PBKDF2',
      version: 1,
    };

    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: serverMetaData,
    });

    const prompt: VaultMetaConvergePrompt = jest.fn();
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result).toEqual({
      kind: 'noop-already-in-sync',
      observedIdentity: vaultIdentityOf(serverMetaData),
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  // ===== Divergence cases: passphrase =====

  test('names passphrase divergence when wrapped_mk_passphrase differs', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({
        wrapped_mk_passphrase: {
          version: 1,
          iv: 'remote-iv',
          ciphertext: 'remote-ct',
        },
      }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'defer' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result.kind).toBe('noop-deferred');
    if (result.kind === 'noop-deferred') {
      expect(result.change).toBe('passphrase');
    }
  });

  test('names different-vault when kdf_salt differs (salt wins first-match scan)', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({ kdf_salt: 'different-salt' }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'defer' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result.kind).toBe('noop-deferred');
    if (result.kind === 'noop-deferred') {
      expect(result.change).toBe('different-vault');
    }
  });

  test('names passphrase divergence when kdf_params.iterations differs', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({
        kdf_params: { hash: 'SHA-256', iterations: 320_000 },
      }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'defer' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result.kind).toBe('noop-deferred');
    if (result.kind === 'noop-deferred') {
      expect(result.change).toBe('passphrase');
    }
  });

  // ===== Divergence cases: recovery-key =====

  test('names recovery-key divergence when wrapped_mk_recovery differs', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({
        wrapped_mk_recovery: {
          version: 1,
          iv: 'remote-iv',
          ciphertext: 'remote-ct',
        },
      }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'defer' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result.kind).toBe('noop-deferred');
    if (result.kind === 'noop-deferred') {
      expect(result.change).toBe('recovery-key');
    }
  });

  // ===== Divergence priority: passphrase wins when both differ =====

  test('reports passphrase when both passphrase and recovery-key wrappings differ (passphrase first)', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({
        wrapped_mk_passphrase: {
          version: 1,
          iv: 'remote-iv1',
          ciphertext: 'remote-ct1',
        },
        wrapped_mk_recovery: {
          version: 1,
          iv: 'remote-iv2',
          ciphertext: 'remote-ct2',
        },
      }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'defer' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result.kind).toBe('noop-deferred');
    if (result.kind === 'noop-deferred') {
      expect(result.change).toBe('passphrase');
    }
  });

  // ===== Prompt receives correct parameters =====

  test('prompt receives change and remote ServerVaultMeta', async () => {
    const localVault = makeLocalVault();
    const serverMetaResponse = {
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({
        wrapped_mk_passphrase: {
          version: 1,
          iv: 'remote-iv',
          ciphertext: 'remote-ct',
        },
      }),
    };
    serverVaultSync.getServerVaultMeta.mockResolvedValue(serverMetaResponse);

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'defer' as const);
    await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(prompt).toHaveBeenCalledTimes(1);
    const [params] = prompt.mock.calls[0];
    expect(params.change).toBe('passphrase');
    expect(params.remote).toEqual(serverMetaResponse);
  });

  // ===== Decision outcomes =====

  test('returns noop-deferred when prompt returns defer (passphrase)', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({
        wrapped_mk_passphrase: {
          version: 1,
          iv: 'remote-iv',
          ciphertext: 'remote-ct',
        },
      }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'defer' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result).toEqual({
      kind: 'noop-deferred',
      change: 'passphrase',
      observedIdentity: vaultIdentityOf(makeServerMeta()),
    });
  });

  test('returns noop-declined when prompt returns keep-local (passphrase)', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({
        wrapped_mk_passphrase: {
          version: 1,
          iv: 'remote-iv',
          ciphertext: 'remote-ct',
        },
      }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'keep-local' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result).toEqual({
      kind: 'noop-declined',
      change: 'passphrase',
      observedIdentity: vaultIdentityOf(makeServerMeta()),
    });
  });

  test('nothing is written when decision is defer (passphrase)', async () => {
    const localVault = makeLocalVault();
    const localVaultClone = JSON.parse(JSON.stringify(localVault));
    const apiDouble = {
      getVaultMeta: jest.fn(),
      putVaultMeta: jest.fn(),
    };
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({
        wrapped_mk_passphrase: {
          version: 1,
          iv: 'remote-iv',
          ciphertext: 'remote-ct',
        },
      }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'defer' as const);
    const result = await convergeVaultMeta({
      api: apiDouble as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    // Verify input was not mutated
    expect(localVault).toEqual(localVaultClone);
    // Verify no adoption occurred
    expect(result).not.toHaveProperty('nextLocalVault');
    // Verify write method was never called
    expect(apiDouble.putVaultMeta).not.toHaveBeenCalled();
  });

  test('nothing is written and localVault is unchanged when decision is keep-local (passphrase)', async () => {
    const localVault = makeLocalVault();
    const localVaultClone = JSON.parse(JSON.stringify(localVault));
    const apiDouble = {
      getVaultMeta: jest.fn(),
      putVaultMeta: jest.fn(),
    };

    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({
        wrapped_mk_passphrase: {
          version: 1,
          iv: 'remote-iv',
          ciphertext: 'remote-ct',
        },
      }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'keep-local' as const);
    const result = await convergeVaultMeta({
      api: apiDouble as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result.kind).toBe('noop-declined');
    // Verify input was not mutated
    expect(localVault).toEqual(localVaultClone);
    // Verify no adoption occurred
    expect(result).not.toHaveProperty('nextLocalVault');
    // Verify write method was never called
    expect(apiDouble.putVaultMeta).not.toHaveBeenCalled();
  });

  test('adopts remote wrapping when prompt returns adopt-remote (passphrase)', async () => {
    const localVault = makeLocalVault();
    const localVaultClone = JSON.parse(JSON.stringify(localVault));

    // A real passphrase change: same salt, different wrapped_mk_passphrase
    const remoteWrapping = makeServerMeta({
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'remote-iv',
        ciphertext: 'remote-ct',
      },
    });

    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: remoteWrapping,
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'adopt-remote' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result.kind).toBe('adopted-remote');
    if (result.kind === 'adopted-remote') {
      expect(result.change).toBe('passphrase');
      // Adoption hands back the wrapping to adopt, never a whole Local Vault:
      // the write is made later, from a fresh read (ADR 0143).
      expect(result).not.toHaveProperty('nextLocalVault');
      expect(result.remoteMeta).toEqual(remoteWrapping);
      // The local wrapping the decision was made against, as Vault Meta
      expect(result.comparedLocalMeta).toEqual(makeServerMeta());
    }

    // Input was not mutated
    expect(localVault).toEqual(localVaultClone);
  });

  test('adopts remote recovery-key wrapping when prompt returns adopt-remote', async () => {
    const localVault = makeLocalVault();
    const remoteWrapping = makeServerMeta({
      wrapped_mk_recovery: {
        version: 1,
        iv: 'remote-recovery-iv',
        ciphertext: 'remote-recovery-ct',
      },
    });

    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: remoteWrapping,
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'adopt-remote' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result.kind).toBe('adopted-remote');
    if (result.kind === 'adopted-remote') {
      expect(result.change).toBe('recovery-key');
      expect(result).not.toHaveProperty('nextLocalVault');
      expect(result.remoteMeta.wrapped_mk_recovery).toEqual({
        version: 1,
        iv: 'remote-recovery-iv',
        ciphertext: 'remote-recovery-ct',
      });
      expect(result.comparedLocalMeta.wrapped_mk_recovery).toEqual({
        version: 1,
        iv: 'iv2-local',
        ciphertext: 'ct2-local',
      });
    }
  });

  // ===== different-vault: not adoptable =====

  test('names different-vault when kdf_salt and wrapped_mk_passphrase both differ (salt wins)', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({
        kdf_salt: 'different-salt',
        wrapped_mk_passphrase: {
          version: 1,
          iv: 'remote-iv',
          ciphertext: 'remote-ct',
        },
      }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'defer' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result.kind).toBe('noop-deferred');
    if (result.kind === 'noop-deferred') {
      // Salt difference wins the first-match scan, even though wrapping also differs
      expect(result.change).toBe('different-vault');
    }
  });

  test('returns refused-not-adoptable when prompt returns adopt-remote for different-vault', async () => {
    const localVault = makeLocalVault();
    const localVaultClone = JSON.parse(JSON.stringify(localVault));

    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({ kdf_salt: 'different-salt' }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'adopt-remote' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result.kind).toBe('refused-not-adoptable');
    if (result.kind === 'refused-not-adoptable') {
      expect(result.change).toBe('different-vault');
      // No nextLocalVault is returned
      expect(result).not.toHaveProperty('nextLocalVault');
    }

    // Input was not mutated
    expect(localVault).toEqual(localVaultClone);
  });

  test('returns noop-deferred when prompt returns defer for different-vault', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({ kdf_salt: 'different-salt' }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'defer' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result).toEqual({
      kind: 'noop-deferred',
      change: 'different-vault',
      observedIdentity: vaultIdentityOf(
        makeServerMeta({ kdf_salt: 'different-salt' }),
      ),
    });
  });

  test('returns noop-declined when prompt returns keep-local for different-vault', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: makeServerMeta({ kdf_salt: 'different-salt' }),
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'keep-local' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result).toEqual({
      kind: 'noop-declined',
      change: 'different-vault',
      observedIdentity: vaultIdentityOf(
        makeServerMeta({ kdf_salt: 'different-salt' }),
      ),
    });
  });

  // ===== observedIdentity field tests (ADR 0067) =====

  test('includes observedIdentity on noop-deferred outcome (different-vault case with different server identity)', async () => {
    const localVault = makeLocalVault();
    const differentServerMeta = makeServerMeta({ kdf_salt: 'different-salt' });
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: differentServerMeta,
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => 'defer' as const);
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,
      onObserved: jest.fn(),
    });

    expect(result.kind).toBe('noop-deferred');
    if (result.kind === 'noop-deferred') {
      expect(result).toHaveProperty('observedIdentity');
      expect(result.observedIdentity).toBe(
        vaultIdentityOf(differentServerMeta),
      );
      // Regression test: ensure it's the SERVER identity, not local
      const localIdentity = vaultIdentityOf(
        makeServerMeta(), // default local salt
      );
      expect(result.observedIdentity).not.toBe(localIdentity);
    }
  });

  test('does NOT include observedIdentity on skipped-no-server-meta outcome (no server read)', async () => {
    serverVaultSync.getServerVaultMeta.mockResolvedValue(null);

    const prompt: VaultMetaConvergePrompt = jest.fn();
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault: makeLocalVault(),
      prompt,
      onObserved: jest.fn(),
    });

    expect(result).toEqual({ kind: 'skipped-no-server-meta' });
    expect(result).not.toHaveProperty('observedIdentity');
  });

  // ===== Type-level API contract test =====

  test('compiles and works with API having only getVaultMeta (structural proof no write)', async () => {
    const localVault = makeLocalVault();
    serverVaultSync.getServerVaultMeta.mockResolvedValue(null);

    const apiDouble = { getVaultMeta: jest.fn() };
    const result = await convergeVaultMeta({
      api: apiDouble as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt: jest.fn(),
      onObserved: jest.fn(),
    });

    // If the code compiled and this runs, the API type was correct
    expect(result.kind).toBe('skipped-no-server-meta');
  });

  // ===== onObserved callback tests (ADR 0067, amendment #691) =====

  test('onObserved is called exactly once with server identity on noop-already-in-sync outcome', async () => {
    const localVault = makeLocalVault();
    const serverMeta = makeServerMeta();
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: serverMeta,
    });

    const onObserved = jest.fn();
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt: jest.fn(),

      onObserved,
    });

    expect(result.kind).toBe('noop-already-in-sync');
    expect(onObserved).toHaveBeenCalledTimes(1);
    expect(onObserved).toHaveBeenCalledWith({
      identity: vaultIdentityOf(serverMeta),
    });
  });

  test('onObserved is called exactly once with server identity on noop-deferred outcome', async () => {
    const localVault = makeLocalVault();
    const serverMeta = makeServerMeta({
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'remote-iv',
        ciphertext: 'remote-ct',
      },
    });
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: serverMeta,
    });

    const onObserved = jest.fn();
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt: jest.fn().mockResolvedValue('defer'),

      onObserved,
    });

    expect(result.kind).toBe('noop-deferred');
    expect(onObserved).toHaveBeenCalledTimes(1);
    expect(onObserved).toHaveBeenCalledWith({
      identity: vaultIdentityOf(serverMeta),
    });
  });

  test('onObserved is called exactly once with server identity on noop-declined outcome', async () => {
    const localVault = makeLocalVault();
    const serverMeta = makeServerMeta({
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'remote-iv',
        ciphertext: 'remote-ct',
      },
    });
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: serverMeta,
    });

    const onObserved = jest.fn();
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt: jest.fn().mockResolvedValue('keep-local'),

      onObserved,
    });

    expect(result.kind).toBe('noop-declined');
    expect(onObserved).toHaveBeenCalledTimes(1);
    expect(onObserved).toHaveBeenCalledWith({
      identity: vaultIdentityOf(serverMeta),
    });
  });

  test('onObserved is called exactly once with server identity on refused-not-adoptable outcome', async () => {
    const localVault = makeLocalVault();
    const differentServerMeta = makeServerMeta({ kdf_salt: 'different-salt' });
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: differentServerMeta,
    });

    const onObserved = jest.fn();
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt: jest.fn().mockResolvedValue('adopt-remote'),

      onObserved,
    });

    expect(result.kind).toBe('refused-not-adoptable');
    expect(onObserved).toHaveBeenCalledTimes(1);
    expect(onObserved).toHaveBeenCalledWith({
      identity: vaultIdentityOf(differentServerMeta),
    });
  });

  test('onObserved is called exactly once with server identity on adopted-remote outcome', async () => {
    const localVault = makeLocalVault();
    const remoteMeta = makeServerMeta({
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'remote-iv',
        ciphertext: 'remote-ct',
      },
    });
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: remoteMeta,
    });

    const onObserved = jest.fn();
    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt: jest.fn().mockResolvedValue('adopt-remote'),

      onObserved,
    });

    expect(result.kind).toBe('adopted-remote');
    expect(onObserved).toHaveBeenCalledTimes(1);
    expect(onObserved).toHaveBeenCalledWith({
      identity: vaultIdentityOf(remoteMeta),
    });
  });

  test('onObserved is called BEFORE the prompt is awaited (call order test)', async () => {
    const localVault = makeLocalVault();
    const serverMeta = makeServerMeta({
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'remote-iv',
        ciphertext: 'remote-ct',
      },
    });
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: serverMeta,
    });

    const callOrder: string[] = [];
    const onObserved = jest.fn(() => {
      callOrder.push('onObserved');
    });

    const prompt = jest.fn<
      Promise<VaultMetaDecision>,
      [{ change: VaultMetaChange; remote: ServerVaultMeta }]
    >(async () => {
      callOrder.push('prompt-called');
      return 'defer';
    });

    await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,

      onObserved,
    });

    // onObserved should be called before prompt is even invoked
    expect(callOrder).toEqual(['onObserved', 'prompt-called']);
  });

  test('onObserved is NOT called on skipped-no-local-vault outcome', async () => {
    const onObserved = jest.fn();

    await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault: null,
      prompt: jest.fn(),

      onObserved,
    });

    expect(onObserved).not.toHaveBeenCalled();
  });

  test('onObserved is NOT called on skipped-not-authenticated outcome', async () => {
    const error = new Error('unauth') as Error & {
      response?: { status: number };
    };
    error.response = { status: 401 };
    serverVaultSync.getServerVaultMeta.mockRejectedValue(error);

    const onObserved = jest.fn();

    await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault: makeLocalVault(),
      prompt: jest.fn(),

      onObserved,
    });

    expect(onObserved).not.toHaveBeenCalled();
  });

  test('onObserved is NOT called on skipped-no-server-meta outcome', async () => {
    serverVaultSync.getServerVaultMeta.mockResolvedValue(null);

    const onObserved = jest.fn();

    await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault: makeLocalVault(),
      prompt: jest.fn(),

      onObserved,
    });

    expect(onObserved).not.toHaveBeenCalled();
  });

  test('onObserved is called even when prompt never resolves (unresolved promise case)', async () => {
    const localVault = makeLocalVault();
    const serverMeta = makeServerMeta({
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'remote-iv',
        ciphertext: 'remote-ct',
      },
    });
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: serverMeta,
    });

    const onObserved = jest.fn();

    // Return a promise that never resolves
    const neverResolvingPromise = new Promise<VaultMetaDecision>(() => {
      // intentionally never resolve or reject
    });

    const prompt = jest.fn().mockReturnValue(neverResolvingPromise);

    // Start the convergence but don't await it (to avoid hanging)
    const convergePromise = convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt,

      onObserved,
    });

    // Give it a tick to call onObserved before we check
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Even though the prompt never resolves, onObserved should have been called
    expect(onObserved).toHaveBeenCalledTimes(1);
    expect(onObserved).toHaveBeenCalledWith({
      identity: vaultIdentityOf(serverMeta),
    });

    // The pass has not settled, so the recording above was not simply it
    // finishing early — and the deliberate hang stays inside this test.
    await expectStillPending(convergePromise);
  });

  test('onObserved identity equals observedIdentity on all post-observation outcomes', async () => {
    // Test with different-vault to ensure we're comparing identities correctly
    const localVault = makeLocalVault();
    const differentServerMeta = makeServerMeta({ kdf_salt: 'different-salt' });
    serverVaultSync.getServerVaultMeta.mockResolvedValue({
      etag: 'e1',
      updatedAt: 't1',
      meta: differentServerMeta,
    });

    let capturedIdentity: string | undefined;
    const onObserved = jest.fn((observation: { identity: string }) => {
      capturedIdentity = observation.identity;
    });

    const result = await convergeVaultMeta({
      api: { getVaultMeta: jest.fn() } as Pick<VaultApi, 'getVaultMeta'>,
      localVault,
      prompt: jest.fn().mockResolvedValue('defer'),

      onObserved,
    });

    expect(result.kind).toBe('noop-deferred');
    if (result.kind === 'noop-deferred') {
      expect(capturedIdentity).toBe(result.observedIdentity);
      expect(result.observedIdentity).toBe(
        vaultIdentityOf(differentServerMeta),
      );
    }
  });
});

describe('describeVaultMetaDivergence', () => {
  test('returns kind: none when local and remote metas are identical', () => {
    const local = makeServerMeta();
    const remote = makeServerMeta();

    const result = describeVaultMetaDivergence({ local, remote });

    expect(result).toEqual({ kind: 'none' });
  });

  test('returns diverged with different-vault when kdf_salt differs', () => {
    const local = makeServerMeta();
    const remote = makeServerMeta({ kdf_salt: 'different-salt' });

    const result = describeVaultMetaDivergence({ local, remote });

    expect(result).toEqual({ kind: 'diverged', change: 'different-vault' });
  });

  test('returns diverged with passphrase when wrapped_mk_passphrase differs', () => {
    const local = makeServerMeta();
    const remote = makeServerMeta({
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'remote-iv',
        ciphertext: 'remote-ct',
      },
    });

    const result = describeVaultMetaDivergence({ local, remote });

    expect(result).toEqual({ kind: 'diverged', change: 'passphrase' });
  });

  test('returns diverged with recovery-key when wrapped_mk_recovery differs', () => {
    const local = makeServerMeta();
    const remote = makeServerMeta({
      wrapped_mk_recovery: {
        version: 1,
        iv: 'remote-iv',
        ciphertext: 'remote-ct',
      },
    });

    const result = describeVaultMetaDivergence({ local, remote });

    expect(result).toEqual({ kind: 'diverged', change: 'recovery-key' });
  });

  // Pinned against VAULT_META_CHANGE_ADOPTABLE (ADR 0053)
  test('every member of VAULT_META_CHANGES has an adoptability rule', () => {
    for (const change of VAULT_META_CHANGES) {
      expect(VAULT_META_CHANGE_ADOPTABLE).toHaveProperty(change);
    }
  });

  test('VAULT_META_CHANGE_ADOPTABLE covers exactly VAULT_META_CHANGES members', () => {
    const adoptableKeys = Object.keys(
      VAULT_META_CHANGE_ADOPTABLE,
    ) as VaultMetaChange[];
    expect(adoptableKeys.sort()).toEqual([...VAULT_META_CHANGES].sort());
  });
});

describe('VAULT_META_CHANGES constant', () => {
  test('is exactly ["different-vault", "passphrase", "recovery-key"] in that order (pinned by ADR 0053)', () => {
    expect(VAULT_META_CHANGES).toEqual([
      'different-vault',
      'passphrase',
      'recovery-key',
    ]);
  });
});

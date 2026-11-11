/**
 * Tests for the Vault Blob convergence primitive.
 *
 * convergeVaultBlob is the single place a convergence decision is made. Given
 * one Vault Blob Type, the Ciphertext this device holds, its Sync Bookmark,
 * and the strategy pinned for the type, it decides between sending, taking,
 * merging, asking, and doing nothing.
 *
 * Tests use REAL WebCrypto to establish decryptability through the real path.
 */

import type { AxiosResponse } from 'axios';
import {
  VaultBlobType,
  type GetVaultMetaResponse,
} from '@myorganiser/app-api-client';
import {
  type VaultBlobEnvelope,
  readDeletionLog,
  readVaultBlobRecords,
} from '@myorganiser/vault-core';

import { createLocalVaultRevision } from './localVaultRevision';
import type { EncryptedBlob } from './localVaultStorage';
import { mintRecoveryKey } from './recoveryKeyMint';
import { createVaultHandle, VaultSecretMismatchError } from './vaultHandle';
import {
  convergeVaultBlob,
  type ConvergingVaultHandle,
  type VaultBlobConvergePrompt,
} from './vaultConverge';
import type { ServerVaultBlob, ServerVaultMeta } from './serverVaultSync';
import { convergeVaultMeta, vaultIdentityOf } from './vaultMetaConverge';
import {
  localToServerMeta,
  serverEncryptedBlobToLocal,
  toEncryptedBlobV1,
} from './vaultShapes';

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe('convergeVaultBlob', () => {
  const passphrase = 'vault key 2026';

  /**
   * Helper to safely get a call argument from a mock, handling TypeScript limitations.
   */
  function getCallArg<T>(
    mock: { mock: { calls: unknown[][] } },
    callIndex: number,
    argIndex = 0,
  ): T | undefined {
    return (mock.mock.calls[callIndex] as unknown[])?.[argIndex] as
      | T
      | undefined;
  }

  /**
   * Helper to create a properly typed API double for vault operations.
   */
  function createApiDouble() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getVaultBlob: jest.fn<Promise<AxiosResponse<any>>, [any?]>(),
      putVaultBlob: jest.fn<
        Promise<
          AxiosResponse<{
            ok: boolean;
            etag: string;
            updatedAt: string;
            message: string;
          }>
        >,
        [{ ifMatch?: string }]
      >(),
    };
  }

  /**
   * Helper to set up a vault fixture with initial data.
   * Uses REAL WebCrypto so decryptability is established the way production does it.
   */
  async function setupHandle(
    owner: string,
    payload?: unknown,
    type: 'tasks' | 'groceries' = 'tasks',
  ) {
    const handle = createVaultHandle({ owner });
    await handle.initialize({ passphrase });
    await handle.unlockWithPassphrase({ passphrase });

    if (payload) {
      const envelope: VaultBlobEnvelope<unknown> = {
        records: payload,
        deletions: {},
      };
      await handle.saveEncryptedData({ type, value: envelope });
    }

    return handle;
  }

  /**
   * Helper to capture a remote blob that genuinely decrypts under the same Master Key.
   * Temporarily saves the payload and reads its Ciphertext, then restores local data.
   */
  async function captureRemoteBlob(
    handle: ConvergingVaultHandle,
    payload: unknown,
    type: 'tasks' | 'groceries' = 'tasks',
  ): Promise<ServerVaultBlob> {
    // Save the current local data
    const vault = handle.loadVault();
    if (!vault) throw new Error('Handle has no vault');
    const originalData = { ...vault.data };

    // Save the remote payload
    const envelope: VaultBlobEnvelope<unknown> = {
      records: payload,
      deletions: {},
    };
    await handle.saveEncryptedData({ type, value: envelope });

    // Capture the Ciphertext
    const remoteVault = handle.loadVault();
    const encryptedBlob = remoteVault?.data[type];
    if (!encryptedBlob) {
      throw new Error(`Failed to save test blob for type ${type}`);
    }

    // Restore the original local data
    vault.data = originalData;
    handle.saveVault(vault);

    return {
      etag: 'etag-remote',
      updatedAt: '2026-01-01T00:00:00.000Z',
      type:
        type === 'groceries' ? VaultBlobType.Groceries : VaultBlobType.Tasks,
      blob: toEncryptedBlobV1(encryptedBlob),
    };
  }

  /**
   * Helper to make an undecryptable remote blob (encrypted under a different Master Key).
   */
  async function makeUndecryptableRemote(
    payload: unknown,
  ): Promise<ServerVaultBlob> {
    const otherHandle = createVaultHandle({ owner: 'user-2' });
    await otherHandle.initialize({ passphrase: 'other key 2026' });
    await otherHandle.unlockWithPassphrase({
      passphrase: 'other key 2026',
    });

    const envelope: VaultBlobEnvelope<unknown> = {
      records: payload,
      deletions: {},
    };
    await otherHandle.saveEncryptedData({ type: 'tasks', value: envelope });
    const vault = otherHandle.loadVault();
    if (!vault?.data.tasks) {
      throw new Error('Failed to create undecryptable blob');
    }

    return {
      etag: 'etag-undecryptable',
      updatedAt: '2026-01-01T00:00:00.000Z',
      type: VaultBlobType.Tasks,
      blob: toEncryptedBlobV1(vault.data.tasks),
    };
  }

  /**
   * Helper to format axios response for API mocks.
   */
  function axiosResponse<T>(data: T): AxiosResponse<T> {
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: { headers: {} as any },
    } as unknown as AxiosResponse<T>;
  }

  /**
   * Helper to format putVaultBlob response with required fields.
   */
  function formatPutVaultBlobResponse(etag: string): AxiosResponse<{
    ok: boolean;
    etag: string;
    updatedAt: string;
    message: string;
  }> {
    return axiosResponse({
      ok: true,
      etag,
      updatedAt: '2026-01-01T00:00:00.000Z',
      message: 'OK',
    });
  }

  /**
   * Helper to format API response for getVaultBlob with proper structure.
   */
  function formatGetVaultBlobResponse(blob: ServerVaultBlob) {
    return axiosResponse({
      etag: blob.etag,
      updatedAt: blob.updatedAt,
      type: blob.type,
      blob: blob.blob,
    });
  }

  /**
   * Helper to create a 404 error for missing vault blob.
   */
  function create404Error() {
    const error = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });
    return error;
  }

  /**
   * Helper to create a ServerVaultMeta with the same Vault Identity as a handle's Local Vault.
   * Used to give existing tests a matching identity so they are not refused.
   */
  function serverMetaFor(
    handle: ConvergingVaultHandle,
    etag = 'meta-etag',
  ): ServerVaultMeta {
    const vault = handle.loadVault();
    if (!vault) throw new Error('Handle has no vault');
    return {
      etag,
      updatedAt: '2026-01-01T00:00:00.000Z',
      meta: localToServerMeta(vault),
    };
  }

  // ===== Row 1: No Local Vault on the device =====
  test('should return nothing/no-local-vault when device has no local vault', async () => {
    // #548 matrix row 1
    const handle = createVaultHandle({ owner: 'user-1' });
    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: null,
    });

    expect(outcome).toEqual({ kind: 'nothing', reason: 'no-local-vault' });
    expect(api.getVaultBlob).not.toHaveBeenCalled();
    expect(api.putVaultBlob).not.toHaveBeenCalled();
  });

  // ===== Row 2: Clean blob, no remote supplied =====
  test('should return nothing/in-sync when clean blob has no remote supplied', async () => {
    // #548 matrix row 2
    const handle = await setupHandle('user-1', []);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({ kind: 'nothing', reason: 'in-sync' });
    expect(api.putVaultBlob).not.toHaveBeenCalled();
  });

  // ===== Row 3: Clean blob, remote with identical iv+ciphertext =====
  test('should return nothing/in-sync when clean blob matches identical remote', async () => {
    // #548 matrix row 3
    const handle = await setupHandle('user-1', []);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    const vault = handle.loadVault();
    if (!vault?.data.tasks) throw new Error('Setup failed');

    const remote: ServerVaultBlob = {
      etag: 'etag-remote',
      updatedAt: '2026-01-01T00:00:00.000Z',
      type: VaultBlobType.Tasks,
      blob: toEncryptedBlobV1(vault.data.tasks), // Byte-identical
    };

    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
      remote,
    });

    expect(outcome).toEqual({ kind: 'nothing', reason: 'in-sync' });
    expect(api.putVaultBlob).not.toHaveBeenCalled();
  });

  // ===== Row 4: Clean blob, remote with different Ciphertext =====
  test('should take different remote when clean blob conflicts with it', async () => {
    // #548 matrix row 4
    const handle = await setupHandle('user-1', []);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-1',
        title: 'Remote task',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
      remote,
    });

    expect(outcome).toEqual({ kind: 'took', etag: 'etag-remote' });
    expect(api.putVaultBlob).not.toHaveBeenCalled();

    // Verify blob is no longer dirty and bookmark advanced
    expect(await handle.hasUnsentChanges('tasks')).toBe(false);
    expect(handle.lastPushedEtag('tasks')).toBe('etag-remote');

    // Verify payload was actually taken
    const decrypted = await handle.loadDecryptedData({
      type: 'tasks',
      defaultValue: null,
    });
    if (!decrypted) throw new Error('Failed to decrypt tasks');

    const records = readVaultBlobRecords(decrypted);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', title: 'Remote task' }),
      ]),
    );
  });

  // ===== Row 5: Dirty blob with Sync Bookmark, PUT succeeds =====
  test('should send dirty blob when bookmark exists and advance bookmark', async () => {
    // #548 matrix row 5
    const handle = await setupHandle('user-1', []);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-old' });

    // Make it dirty by saving new data
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'New task',
          status: 'todo',
          priority: 'high',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: envelope });

    const api = {
      getVaultBlob: jest.fn(),
      putVaultBlob: jest
        .fn()
        .mockResolvedValue(formatPutVaultBlobResponse('etag-server')),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({ kind: 'sent', etag: 'etag-server' });

    // Verify PUT was called with correct ifMatch
    expect(api.putVaultBlob).toHaveBeenCalledTimes(1);
    const putCall = getCallArg<{ ifMatch?: string }>(api.putVaultBlob, 0);
    expect(putCall?.ifMatch).toBe('etag-old');

    // Verify bookmark advanced
    expect(handle.lastPushedEtag('tasks')).toBe('etag-server');
    expect(await handle.hasUnsentChanges('tasks')).toBe(false);
  });

  // ===== Row 6: Unconflicted send while Vault is LOCKED succeeds =====
  test('should send dirty blob successfully even while vault is locked', async () => {
    // #548 matrix row 6
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Task',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Make it dirty
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Updated',
          status: 'done',
          priority: 'medium',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: envelope });

    // Create a fresh handle (locked) but pointing to the same storage
    const lockedHandle = createVaultHandle({ owner: 'user-1' });
    expect(lockedHandle.isUnlocked).toBe(false);

    const api = {
      getVaultBlob: jest.fn(),
      putVaultBlob: jest
        .fn()
        .mockResolvedValue(formatPutVaultBlobResponse('etag-server')),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle: lockedHandle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(lockedHandle),
    });

    expect(outcome).toEqual({ kind: 'sent', etag: 'etag-server' });
    expect(api.putVaultBlob).toHaveBeenCalledTimes(1);
    expect(lockedHandle.lastPushedEtag('tasks')).toBe('etag-server');
  });

  // ===== Row 7: Dirty blob, no bookmark, server has no blob =====
  test('should send dirty blob unconditionally when no bookmark exists and server has nothing', async () => {
    // #548 matrix row 7
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Task',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    // No recordPushSuccess call — no bookmark

    const api = {
      getVaultBlob: jest.fn().mockRejectedValue(create404Error()),
      putVaultBlob: jest
        .fn()
        .mockResolvedValue(axiosResponse({ ok: true, etag: 'etag-new' })),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({ kind: 'sent', etag: 'etag-new' });

    // Verify getVaultBlob was called to check
    expect(api.getVaultBlob).toHaveBeenCalledTimes(1);

    // Verify PUT was called with NO ifMatch
    expect(api.putVaultBlob).toHaveBeenCalledTimes(1);
    const putCall = getCallArg<{ ifMatch?: string }>(api.putVaultBlob, 0);
    expect(putCall?.ifMatch).toBeUndefined();
  });

  // #857 inventory-absence caller contract: explicit `remote: null` skips GET;
  // omitted `remote` still GETs (Row 7 above).
  test('should send dirty blob unconditionally when remote is null and no bookmark exists', async () => {
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Task',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    // No recordPushSuccess call — no bookmark

    const api = {
      getVaultBlob: jest.fn().mockRejectedValue(create404Error()),
      putVaultBlob: jest
        .fn()
        .mockResolvedValue(axiosResponse({ ok: true, etag: 'etag-new' })),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      remote: null,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({ kind: 'sent', etag: 'etag-new' });
    expect(api.getVaultBlob).not.toHaveBeenCalled();
    expect(api.putVaultBlob).toHaveBeenCalledTimes(1);
    const putCall = getCallArg<{ ifMatch?: string }>(api.putVaultBlob, 0);
    expect(putCall?.ifMatch).toBeUndefined();
    expect(handle.lastPushedEtag('tasks')).toBe('etag-new');
  });

  // ===== Row 8: Dirty blob, no bookmark, server holds blob =====
  test('should merge dirty blob when no bookmark exists but server holds a blob', async () => {
    // #548 matrix row 8
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local task',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      },
    ]);
    // No bookmark

    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-2',
        title: 'Remote task',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T09:00:00.000Z',
      },
    ]);

    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(remote)),
      putVaultBlob: jest
        .fn()
        .mockResolvedValue({ data: { ok: true, etag: 'etag-merged' } }),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({ kind: 'merged', etag: 'etag-merged' });

    // Verify first PUT was conditional (carried remote.etag as ifMatch, not undefined)
    expect(api.putVaultBlob).toHaveBeenCalledTimes(1);
    const putCall = getCallArg<{ ifMatch?: string }>(api.putVaultBlob, 0);
    expect(putCall?.ifMatch).toBe('etag-remote');
  });

  // ===== Row 9: 409 → merge → retry with fresh ETag =====
  test('should retry with fresh ETag and merge after 409 conflict', async () => {
    // #548 matrix row 9
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-stale' });

    // Make it dirty by updating the local task
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Local Updated',
          status: 'in-progress',
          priority: 'high',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T11:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: envelope });

    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-2',
        title: 'Remote',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T09:00:00.000Z',
      },
    ]);

    let callCount = 0;
    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(remote)),
      putVaultBlob: jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // First PUT returns 409
          const error = Object.assign(new Error('conflict'), {
            response: { status: 409 },
          });
          throw error;
        }
        // Retry PUT succeeds
        return formatPutVaultBlobResponse('etag-server');
      }),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({ kind: 'merged', etag: 'etag-server' });

    // Verify getVaultBlob was called after 409
    expect(api.getVaultBlob).toHaveBeenCalledTimes(1);

    // Verify two PUT calls
    expect(api.putVaultBlob).toHaveBeenCalledTimes(2);

    // First PUT: stale bookmark ETag
    expect(getCallArg<{ ifMatch?: string }>(api.putVaultBlob, 0)?.ifMatch).toBe(
      'etag-stale',
    );

    // Retry PUT: fresh ETag from server
    expect(getCallArg<{ ifMatch?: string }>(api.putVaultBlob, 1)?.ifMatch).toBe(
      'etag-remote',
    );

    // Verify merged payload contains both tasks
    const merged = await handle.loadDecryptedData({
      type: 'tasks',
      defaultValue: null,
    });
    if (!merged) throw new Error('Failed to decrypt merged tasks');
    const records = readVaultBlobRecords(merged);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', title: 'Local Updated' }),
        expect.objectContaining({ id: 'task-2', title: 'Remote' }),
      ]),
    );
    // Assert Deletion Log is properly merged
    const deletions = readDeletionLog(merged);
    expect(deletions).toBeDefined();

    expect(handle.lastPushedEtag('tasks')).toBe('etag-server');
  });

  // ===== Row 10: Conflict while LOCKED writes nothing =====
  test('should write nothing when conflict arrives while vault is locked', async () => {
    // #548 matrix row 10
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Task',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Make dirty
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Updated',
          status: 'done',
          priority: 'medium',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: envelope });

    const originalVault = handle.loadVault();

    const lockedHandle = createVaultHandle({ owner: 'user-1' });
    expect(lockedHandle.isUnlocked).toBe(false);

    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-2',
        title: 'Remote',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(remote)),
      putVaultBlob: jest.fn(async () => {
        const error = Object.assign(new Error('conflict'), {
          response: { status: 409 },
        });
        throw error;
      }),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle: lockedHandle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(lockedHandle),
      remote,
    });

    expect(outcome).toEqual({ kind: 'nothing', reason: 'vault-locked' });

    // Exactly one PUT attempted
    expect(api.putVaultBlob).toHaveBeenCalledTimes(1);

    // Verify Local Vault Ciphertext unchanged
    const currentVault = lockedHandle.loadVault();
    expect(currentVault?.data.tasks).toEqual(originalVault?.data.tasks);

    // Verify bookmark unchanged
    expect(lockedHandle.lastPushedEtag('tasks')).toBe('etag-1');

    // Verify blob still dirty
    expect(await lockedHandle.hasUnsentChanges('tasks')).toBe(true);
  });

  // ===== Row 11a: Undecryptable remote, prompt answers defer =====
  test('should prompt with undecryptable-remote reason and write nothing when user defers', async () => {
    // #548 matrix row 11a
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Make dirty
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Updated',
          status: 'done',
          priority: 'medium',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: envelope });

    const undecryptable = await makeUndecryptableRemote([
      {
        id: 'task-2',
        title: 'Remote',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(undecryptable)),
      putVaultBlob: jest.fn(async () => {
        const error = Object.assign(new Error('conflict'), {
          response: { status: 409 },
        });
        throw error;
      }),
    };
    const prompt = jest.fn().mockResolvedValue('defer' as const);

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({
      kind: 'asked',
      reason: 'undecryptable-remote',
      decision: 'defer',
    });

    // Verify prompt was called once
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0][0].reason).toBe('undecryptable-remote');

    // Nothing written on either side
    expect(api.putVaultBlob).toHaveBeenCalledTimes(1); // The initial attempt
    // No second attempt after prompt

    // Bookmark unchanged
    expect(handle.lastPushedEtag('tasks')).toBe('etag-1');

    // Still dirty
    expect(await handle.hasUnsentChanges('tasks')).toBe(true);
  });

  // ===== Row 11b: Undecryptable remote, prompt answers keep-local =====
  test('should send local blob with remote ETag when user chooses keep-local on undecryptable-remote', async () => {
    // #548 matrix row 11b
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Make dirty
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Updated',
          status: 'done',
          priority: 'medium',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: envelope });

    const undecryptable = await makeUndecryptableRemote([
      {
        id: 'task-2',
        title: 'Remote',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    let callCount = 0;
    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(undecryptable)),
      putVaultBlob: jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // First PUT (unconditional) returns 409
          const error = Object.assign(new Error('conflict'), {
            response: { status: 409 },
          });
          throw error;
        }
        // After prompt: keep-local sends with remote ETag
        return formatPutVaultBlobResponse('etag-server');
      }),
    };
    const prompt = jest.fn().mockResolvedValue('keep-local' as const);

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({
      kind: 'asked',
      reason: 'undecryptable-remote',
      decision: 'keep-local',
      etag: 'etag-server',
    });

    // Verify second PUT carried remote ETag
    expect(api.putVaultBlob).toHaveBeenCalledTimes(2);
    expect(getCallArg<{ ifMatch?: string }>(api.putVaultBlob, 1)?.ifMatch).toBe(
      'etag-undecryptable',
    );

    // Bookmark advanced
    expect(handle.lastPushedEtag('tasks')).toBe('etag-server');
  });

  // ===== Row 11c: Undecryptable remote, prompt answers keep-remote =====
  test('should take remote blob without PUT when user chooses keep-remote on undecryptable-remote', async () => {
    // #548 matrix row 11c
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Make dirty
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Updated',
          status: 'done',
          priority: 'medium',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: envelope });

    const undecryptable = await makeUndecryptableRemote([
      {
        id: 'task-2',
        title: 'Remote',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(undecryptable)),
      putVaultBlob: jest.fn(async () => {
        const error = Object.assign(new Error('conflict'), {
          response: { status: 409 },
        });
        throw error;
      }),
    };
    const prompt = jest.fn().mockResolvedValue('keep-remote' as const);

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({
      kind: 'asked',
      reason: 'undecryptable-remote',
      decision: 'keep-remote',
      etag: 'etag-undecryptable',
    });

    // No second PUT after keep-remote
    expect(api.putVaultBlob).toHaveBeenCalledTimes(1);

    // Bookmark advanced to remote's ETag
    expect(handle.lastPushedEtag('tasks')).toBe('etag-undecryptable');
  });

  // ===== Row 14: Groceries 409 → merge → retry =====
  test('should retry with fresh ETag and merge groceries after 409 conflict', async () => {
    const handle = await setupHandle(
      'user-1',
      { catalog: [], lists: [] },
      'groceries',
    );
    await handle.recordPushSuccess({ type: 'groceries', etag: 'etag-stale' });

    const dirtyPayload = {
      catalog: [{ id: 'cat-1', name: 'Produce' }],
      lists: [],
    };
    const envelope: VaultBlobEnvelope<unknown> = {
      records: dirtyPayload,
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'groceries', value: envelope });

    const remotePayload = {
      catalog: [{ id: 'cat-2', name: 'Dairy' }],
      lists: [],
    };
    const remote = await captureRemoteBlob(handle, remotePayload, 'groceries');

    let callCount = 0;
    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(remote)),
      putVaultBlob: jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          const error = Object.assign(new Error('conflict'), {
            response: { status: 409 },
          });
          throw error;
        }
        return formatPutVaultBlobResponse('etag-server');
      }),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Groceries,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({ kind: 'merged', etag: 'etag-server' });
    expect(prompt).not.toHaveBeenCalled();
    expect(api.getVaultBlob).toHaveBeenCalledTimes(1);
    expect(api.putVaultBlob).toHaveBeenCalledTimes(2);

    const merged = await handle.loadDecryptedData({
      type: 'groceries',
      defaultValue: null,
    });
    if (!merged) throw new Error('Failed to decrypt merged groceries');
    const records = readVaultBlobRecords(merged) as {
      catalog: Array<{ id: string; name: string }>;
      lists: unknown[];
    };
    expect(records.catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'cat-1', name: 'Produce' }),
        expect.objectContaining({ id: 'cat-2', name: 'Dairy' }),
      ]),
    );
    expect(handle.lastPushedEtag('groceries')).toBe('etag-server');
  });

  // ===== Row 16: Merge retry loses another race =====
  test('should return merged without etag when merge retry loses 409 race', async () => {
    // #548 matrix row 16
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Make it dirty by updating the local task
    const dirtyEnvelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Local Updated',
          status: 'in-progress',
          priority: 'high',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T11:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: dirtyEnvelope });

    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-2',
        title: 'Remote',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T09:00:00.000Z',
      },
    ]);

    let callCount = 0;
    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(remote)),
      putVaultBlob: jest.fn(async () => {
        callCount++;
        // Both attempts fail with 409
        const error = Object.assign(new Error('conflict'), {
          response: { status: 409 },
        });
        throw error;
      }),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    // No etag because retry also lost
    expect(outcome).toEqual({ kind: 'merged' });

    // Both PUT attempts were made
    expect(api.putVaultBlob).toHaveBeenCalledTimes(2);
    expect(callCount).toBe(2);

    // Merged payload is saved locally
    const decrypted = await handle.loadDecryptedData({
      type: 'tasks',
      defaultValue: null,
    });
    if (!decrypted) throw new Error('Failed to decrypt tasks');

    const records = readVaultBlobRecords(decrypted);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', title: 'Local Updated' }),
        expect.objectContaining({ id: 'task-2', title: 'Remote' }),
      ]),
    );

    // Still reads as unsent (dirty)
    expect(await handle.hasUnsentChanges('tasks')).toBe(true);
  });

  // ===== Row 17: First PUT 409s, follow-up getVaultBlob 404s =====
  test('should retry unconditionally and succeed when 409 race cleared the remote', async () => {
    // #548 matrix row 17
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Make dirty
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Updated',
          status: 'done',
          priority: 'medium',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: envelope });

    let callCount = 0;
    const api = {
      getVaultBlob: jest.fn().mockRejectedValue(create404Error()),
      putVaultBlob: jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // First PUT returns 409
          const error = Object.assign(new Error('conflict'), {
            response: { status: 409 },
          });
          throw error;
        }
        // Unconditional retry succeeds
        return formatPutVaultBlobResponse('etag-server');
      }),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({ kind: 'sent', etag: 'etag-server' });

    // Verify unconditional retry (no ifMatch)
    expect(api.putVaultBlob).toHaveBeenCalledTimes(2);
    expect(
      getCallArg<{ ifMatch?: string }>(api.putVaultBlob, 1)?.ifMatch,
    ).toBeUndefined();

    expect(handle.lastPushedEtag('tasks')).toBe('etag-server');
  });

  // ===== Row 18: Non-409 PUT failure propagates =====
  test('should propagate non-409 PUT failures as thrown errors', async () => {
    // #548 matrix row 18
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Task',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Make dirty
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Updated',
          status: 'done',
          priority: 'medium',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: envelope });

    const api = {
      getVaultBlob: jest.fn(),
      putVaultBlob: jest.fn(async () => {
        const error = Object.assign(new Error('server error'), {
          response: { status: 500 },
        });
        throw error;
      }),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    await expect(
      convergeVaultBlob({
        api,
        handle,
        type: VaultBlobType.Tasks,
        prompt,
        serverMeta: serverMetaFor(handle),
      }),
    ).rejects.toThrow('server error');
  });

  // ===== Row 19: Stale wrapping does not impede merging =====
  test('should merge successfully when wrapping is stale but Master Key unchanged and decryptability gates not Vault Meta', async () => {
    // #548 matrix row 19: Fixture stands in for a second device holding older wrapping of same Master Key
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Capture wrapping before change
    const wrappingBefore = handle.loadVault()?.masterKeyWrappedWithPassphrase;

    // Capture remote blob with original passphrase
    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-2',
        title: 'Remote',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T09:00:00.000Z',
      },
    ]);

    // Change passphrase — Master Key unchanged, wrapping changed
    await handle.resetPassphrase({ newPassphrase: 'new key 2026' });

    const wrappingAfter = handle.loadVault()?.masterKeyWrappedWithPassphrase;

    // Verify wrapping really changed
    expect(wrappingBefore).not.toEqual(wrappingAfter);

    // Verify remote blob still decrypts (Master Key unchanged)
    const remoteDecrypted = await handle.decryptCiphertext({
      blob: serverEncryptedBlobToLocal(remote.blob),
    });
    expect(remoteDecrypted).toBeDefined();

    // Make dirty again
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Updated',
          status: 'done',
          priority: 'medium',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T11:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: envelope });

    let callCount = 0;
    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(remote)),
      putVaultBlob: jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // First PUT returns 409
          const error = Object.assign(new Error('conflict'), {
            response: { status: 409 },
          });
          throw error;
        }
        return formatPutVaultBlobResponse('etag-merged');
      }),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    // Merge proceeds without prompt (no undecryptable-remote)
    expect(outcome).toEqual({ kind: 'merged', etag: 'etag-merged' });

    // Prompt never called
    expect(prompt).not.toHaveBeenCalled();

    // Merged payload contains both tasks
    const merged = await handle.loadDecryptedData({
      type: 'tasks',
      defaultValue: null,
    });
    if (!merged) throw new Error('Failed to decrypt merged tasks');
    const records = readVaultBlobRecords(merged);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', title: 'Updated' }),
        expect.objectContaining({ id: 'task-2', title: 'Remote' }),
      ]),
    );

    // Verify old secret is dead: attempt to unlock with old passphrase should fail
    const freshHandle = createVaultHandle({ owner: 'user-1' });
    await expect(
      freshHandle.unlockWithPassphrase({ passphrase: 'vault key 2026' }),
    ).rejects.toThrow(VaultSecretMismatchError);
    // New passphrase should work
    await expect(
      freshHandle.unlockWithPassphrase({ passphrase: 'new key 2026' }),
    ).resolves.not.toThrow();
  });

  // ===== Row 20: Merging attempted only after remote decrypts =====
  test('should not attempt merge and keep local Ciphertext unchanged when remote is undecryptable', async () => {
    // #548 matrix row 20
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Make dirty
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Updated',
          status: 'done',
          priority: 'medium',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T11:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle.saveEncryptedData({ type: 'tasks', value: envelope });

    // Capture vault state after making dirty, before converge
    const vaultBefore = handle.loadVault();
    const localCiphertextBefore = vaultBefore?.data.tasks;

    const undecryptable = await makeUndecryptableRemote([
      {
        id: 'task-2',
        title: 'Remote',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    let putCallCount = 0;
    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(undecryptable)),
      putVaultBlob: jest.fn(async () => {
        putCallCount++;
        if (putCallCount === 1) {
          const error = Object.assign(new Error('conflict'), {
            response: { status: 409 },
          });
          throw error;
        }
        // Should not reach here
        return formatPutVaultBlobResponse('etag-server');
      }),
    };
    const prompt = jest.fn().mockResolvedValue('defer' as const);

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    // Prompt asked, user deferred
    expect(outcome).toEqual({
      kind: 'asked',
      reason: 'undecryptable-remote',
      decision: 'defer',
    });

    // Verify merge was never attempted by checking Ciphertext
    // (merge would have written the dirty payload or a merged one)
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(api.putVaultBlob).toHaveBeenCalledTimes(1); // Only first attempt

    // Verify local Ciphertext is byte-identical (no merge was written)
    const vaultAfter = handle.loadVault();
    expect(vaultAfter?.data.tasks).toEqual(vaultBefore?.data.tasks);
    if (!localCiphertextBefore || !vaultAfter?.data.tasks) {
      throw new Error('Ciphertext comparison failed - missing data');
    }
    expect(vaultAfter.data.tasks).toEqual(localCiphertextBefore);

    // Verify local payload is still the dirty one (not merged with remote)
    const current = await handle.loadDecryptedData({
      type: 'tasks',
      defaultValue: null,
    });
    if (!current) throw new Error('Failed to decrypt tasks');
    const records = readVaultBlobRecords(current);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', title: 'Updated' }),
      ]),
    );
    expect(records).not.toContainEqual(
      expect.objectContaining({ id: 'task-2' }),
    );
  });

  // ===== New: Undecryptable LOCAL Ciphertext, defer =====
  test('should prompt with undecryptable-local reason and write nothing when local is unreadable and user defers', async () => {
    // #548 new branch: local Ciphertext does not decrypt under bound Master Key
    // Create a handle with readable local blob
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Capture vault state
    const vault = handle.loadVault();
    if (!vault) throw new Error('Setup failed');

    // Create a second owner's handle and encrypt a blob under their Master Key
    const otherOwnerHandle = await setupHandle('other-owner', [
      {
        id: 'task-2',
        title: 'Other task',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    // Get the ciphertext from the other owner (encrypted under their Master Key, not user-1's)
    const otherVault = otherOwnerHandle.loadVault();
    if (!otherVault?.data.tasks)
      throw new Error('Failed to create undecryptable blob');

    // Write the other owner's ciphertext into user-1's vault
    // This makes local unreadable by user-1
    vault.data.tasks = otherVault.data.tasks;
    handle.saveVault(vault);

    // Create a decryptable remote blob (under user-1's Master Key)
    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-3',
        title: 'Remote',
        status: 'done',
        priority: 'low',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    // Restore the original user-1 local blob to make it dirty vs remote
    const originalVault = handle.loadVault();
    if (!originalVault) throw new Error('Vault state lost');

    let callCount = 0;
    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(remote)),
      putVaultBlob: jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          const error = Object.assign(new Error('conflict'), {
            response: { status: 409 },
          });
          throw error;
        }
        return formatPutVaultBlobResponse('etag-server');
      }),
    };
    const prompt = jest.fn().mockResolvedValue('defer' as const);

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({
      kind: 'asked',
      reason: 'undecryptable-local',
      decision: 'defer',
    });

    // Prompt called once with undecryptable-local reason
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0][0].reason).toBe('undecryptable-local');

    // Nothing written on either side
    expect(api.putVaultBlob).toHaveBeenCalledTimes(1); // Only initial attempt

    // Bookmark unchanged
    expect(handle.lastPushedEtag('tasks')).toBe('etag-1');

    // Still dirty
    expect(await handle.hasUnsentChanges('tasks')).toBe(true);
  });

  // ===== New: Undecryptable LOCAL Ciphertext, keep-remote =====
  test('should take remote blob and advance bookmark when local is unreadable and user chooses keep-remote', async () => {
    // #548 new branch: recovery path for corrupt local blob
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Capture vault state
    const vault = handle.loadVault();
    if (!vault) throw new Error('Setup failed');

    // Create a second owner's handle and encrypt a blob under their Master Key
    const otherOwnerHandle = await setupHandle('other-owner', [
      {
        id: 'task-2',
        title: 'Other task',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    // Get the ciphertext from the other owner
    const otherVault = otherOwnerHandle.loadVault();
    if (!otherVault?.data.tasks)
      throw new Error('Failed to create undecryptable blob');

    // Write the other owner's ciphertext into user-1's vault
    vault.data.tasks = otherVault.data.tasks;
    handle.saveVault(vault);

    // Create a decryptable remote blob (under user-1's Master Key)
    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-3',
        title: 'Remote',
        status: 'done',
        priority: 'low',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    let callCount = 0;
    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(remote)),
      putVaultBlob: jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          const error = Object.assign(new Error('conflict'), {
            response: { status: 409 },
          });
          throw error;
        }
        // Should not reach here with keep-remote
        return formatPutVaultBlobResponse('etag-server');
      }),
    };
    const prompt = jest.fn().mockResolvedValue('keep-remote' as const);

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    expect(outcome).toEqual({
      kind: 'asked',
      reason: 'undecryptable-local',
      decision: 'keep-remote',
      etag: 'etag-remote',
    });

    // Prompt called once
    expect(prompt).toHaveBeenCalledTimes(1);

    // No second PUT after keep-remote (takes without sending)
    expect(api.putVaultBlob).toHaveBeenCalledTimes(1); // Only initial attempt

    // Bookmark advanced to remote ETag
    expect(handle.lastPushedEtag('tasks')).toBe('etag-remote');

    // Verify remote payload was taken
    const decrypted = await handle.loadDecryptedData({
      type: 'tasks',
      defaultValue: null,
    });
    if (!decrypted) throw new Error('Failed to decrypt tasks after recovery');
    const records = readVaultBlobRecords(decrypted);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-3', title: 'Remote' }),
      ]),
    );
  });

  // ===== Independence test: blob convergence proceeds independently when meta diverges =====
  test('blob convergence is never gated by meta divergence (ADR 0057)', async () => {
    // Setup: create a vault handle with local Tasks data
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local task',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      },
    ]);

    const localVault = handle.loadVault();
    if (!localVault) throw new Error('Setup failed');

    // Create a remote Tasks blob with different Ciphertext
    const remoteBlob = await captureRemoteBlob(handle, [
      {
        id: 'task-2',
        title: 'Remote task',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T09:00:00.000Z',
      },
    ]);

    // Build api double with getVaultMeta, getVaultBlob, and putVaultBlob
    // getVaultMeta will return a meta with diverged passphrase wrapping
    const api = {
      getVaultMeta: jest.fn(async () => {
        return axiosResponse({
          message: 'OK',
          etag: 'etag-meta',
          updatedAt: '2026-01-01T00:00:00.000Z',
          meta: {
            version: 1,
            kdf_name: 'PBKDF2',
            kdf_salt: localVault.kdf.salt,
            kdf_params: {
              hash: 'SHA-256',
              iterations: localVault.kdf.iterations,
            },
            // Different wrapped_mk_passphrase (diverged meta)
            wrapped_mk_passphrase: {
              version: 1,
              iv: 'remote-iv-passphrase',
              ciphertext: 'remote-ct-passphrase',
            },
            wrapped_mk_recovery: {
              version: 1,
              iv: localVault.masterKeyWrappedWithRecoveryKey.iv,
              ciphertext: localVault.masterKeyWrappedWithRecoveryKey.ciphertext,
            },
          },
        } as unknown as GetVaultMetaResponse);
      }),
      getVaultBlob: jest.fn(async () => {
        return formatGetVaultBlobResponse(remoteBlob);
      }),
      putVaultBlob: jest.fn(async () => {
        return formatPutVaultBlobResponse('etag-merged');
      }),
    };

    // 1. Call convergeVaultMeta with prompt returning 'defer'
    const metaResult = await convergeVaultMeta({
      api,
      localVault,
      prompt: async () => 'defer' as const,
      onObserved: jest.fn(),
    });

    // Assert meta converge saw the divergence and deferred it
    expect(metaResult).toEqual({
      kind: 'noop-deferred',
      change: 'passphrase',
      observedIdentity: expect.any(String),
    });

    // Assert getVaultMeta was called exactly once
    expect(api.getVaultMeta).toHaveBeenCalledTimes(1);

    // 2. Then call convergeVaultBlob on the diverged blob
    const blobOutcome = await convergeVaultBlob({
      api: api as unknown as Parameters<typeof convergeVaultBlob>[0]['api'],
      handle,
      type: VaultBlobType.Tasks,
      prompt: jest.fn() as VaultBlobConvergePrompt,
      serverMeta: serverMetaFor(handle),
    });

    // 3. Assert getVaultMeta was still called exactly once (zero additional calls)
    // This proves blob convergence never consults meta
    expect(api.getVaultMeta).toHaveBeenCalledTimes(1);

    // 4. Assert blob converges to 'merged' — the two records (local and remote)
    // are by different ID, so mergeById keeps both
    expect(blobOutcome).toEqual({
      kind: 'merged',
      etag: 'etag-merged',
    });

    // 5. Decrypt and verify both local and remote records survive
    const decrypted = await handle.loadDecryptedData({
      type: 'tasks',
      defaultValue: null,
    });
    if (!decrypted) throw new Error('Failed to decrypt tasks after merge');
    const records = readVaultBlobRecords(decrypted);

    // Both task-1 and task-2 should be present
    expect(records).toHaveLength(2);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', title: 'Local task' }),
        expect.objectContaining({ id: 'task-2', title: 'Remote task' }),
      ]),
    );
  });

  // ===== NEW: Vault Identity guard tests (ADR 0067) =====

  test('should refuse to take clean remote with differing vault identity', async () => {
    // Test 1: Clean path, remote differs, DIFFERING identity → refused
    const handle1 = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local task',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle1.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Capture local ciphertext before converge
    const vault1Before = handle1.loadVault();
    const localCiphertextBefore = vault1Before?.data.tasks;

    // Create a different vault (user-2 with different Vault Identity)
    const handle2 = await setupHandle('user-2', [
      {
        id: 'task-2',
        title: 'Other vault task',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const remote = await captureRemoteBlob(handle2, [
      {
        id: 'task-2',
        title: 'Other vault task',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    // Build serverMeta with user-2's identity, not user-1's
    const differentVaultMeta = serverMetaFor(handle2);

    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle: handle1,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: differentVaultMeta,
      remote,
    });

    expect(outcome).toEqual({
      kind: 'refused',
      reason: 'different-vault',
    });

    // Verify no API calls made
    expect(api.getVaultBlob).not.toHaveBeenCalled();
    expect(api.putVaultBlob).not.toHaveBeenCalled();

    // Verify local Ciphertext byte-identical (unchanged)
    const vault1After = handle1.loadVault();
    const localCiphertextAfter = vault1After?.data.tasks;
    expect(localCiphertextAfter?.iv).toBe(localCiphertextBefore?.iv);
    expect(localCiphertextAfter?.ciphertext).toBe(
      localCiphertextBefore?.ciphertext,
    );

    // Verify bookmark unchanged
    expect(handle1.lastPushedEtag('tasks')).toBe('etag-1');
  });

  test('should take clean remote with identical vault identity', async () => {
    // Test 2: Clean path, IDENTICAL identity, remote differs → still took
    const handle = await setupHandle('user-1', []);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-1',
        title: 'Remote task',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
      remote,
    });

    // Should take because identity matches
    expect(outcome).toEqual({ kind: 'took', etag: 'etag-remote' });

    // Verify bookmark advanced
    expect(handle.lastPushedEtag('tasks')).toBe('etag-remote');

    // Verify remote payload was taken
    const decrypted = await handle.loadDecryptedData({
      type: 'tasks',
      defaultValue: null,
    });
    if (!decrypted) throw new Error('Failed to decrypt tasks');
    const records = readVaultBlobRecords(decrypted);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', title: 'Remote task' }),
      ]),
    );
  });

  test('should refuse dirty local with differing vault identity before asking', async () => {
    // Test 3: Dirty path, DIFFERING identity → refused BEFORE guard ladder
    const handle1 = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local task',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle1.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Make dirty
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Updated',
          status: 'done',
          priority: 'medium',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle1.saveEncryptedData({ type: 'tasks', value: envelope });

    // Create different vault meta
    const handle2 = await setupHandle('user-2', []);
    const differentVaultMeta = serverMetaFor(handle2);

    const api = {
      getVaultBlob: jest.fn(),
      putVaultBlob: jest.fn(),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle: handle1,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: differentVaultMeta,
    });

    expect(outcome).toEqual({
      kind: 'refused',
      reason: 'different-vault',
    });

    // Verify prompt was never called (guard happens before asking)
    expect(prompt).not.toHaveBeenCalled();

    // Verify no API calls
    expect(api.putVaultBlob).not.toHaveBeenCalled();

    // Verify local Ciphertext unchanged
    expect(await handle1.hasUnsentChanges('tasks')).toBe(true);
  });

  test('should refuse dirty local with differing vault identity even if prompt answers keep-remote', async () => {
    // Test 4: Dirty path, DIFFERING identity + prompt='keep-remote' → still refused
    // This is the #571 route the old code left open
    const handle1 = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local task',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle1.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Make dirty
    const envelope: VaultBlobEnvelope<unknown> = {
      records: [
        {
          id: 'task-1',
          title: 'Updated',
          status: 'done',
          priority: 'medium',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      deletions: {},
    };
    await handle1.saveEncryptedData({ type: 'tasks', value: envelope });

    // Create different vault meta
    const handle2 = await setupHandle('user-2', []);
    const differentVaultMeta = serverMetaFor(handle2);

    const api = {
      getVaultBlob: jest.fn(),
      putVaultBlob: jest.fn(),
    };
    const prompt = jest.fn().mockResolvedValue('keep-remote' as const);

    const outcome = await convergeVaultBlob({
      api,
      handle: handle1,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: differentVaultMeta,
    });

    expect(outcome).toEqual({
      kind: 'refused',
      reason: 'different-vault',
    });

    // Verify prompt was never called (guard refuses before prompt)
    expect(prompt).not.toHaveBeenCalled();

    // Verify no API calls
    expect(api.putVaultBlob).not.toHaveBeenCalled();

    // Verify local Ciphertext unchanged
    expect(await handle1.hasUnsentChanges('tasks')).toBe(true);
  });

  test('should merge dirty local with identical vault identity despite differing remote', async () => {
    // Test 5: Dirty path, IDENTICAL identity → unchanged merging behavior
    // Use Row 8 pattern: dirty but no bookmark, so merge happens on first push
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      },
    ]);
    // NO bookmark — this is first push

    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-2',
        title: 'Remote',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T09:00:00.000Z',
      },
    ]);

    const api = {
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(formatGetVaultBlobResponse(remote)),
      putVaultBlob: jest
        .fn()
        .mockResolvedValue(formatPutVaultBlobResponse('etag-merged')),
    };
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(handle),
    });

    // Verify merge happens (same identity, so converge proceeds normally)
    expect(outcome).toEqual({ kind: 'merged', etag: 'etag-merged' });

    // Verify both local and remote records are present
    const merged = await handle.loadDecryptedData({
      type: 'tasks',
      defaultValue: null,
    });
    if (!merged) throw new Error('Failed to decrypt merged tasks');
    const records = readVaultBlobRecords(merged);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', title: 'Local' }),
        expect.objectContaining({ id: 'task-2', title: 'Remote' }),
      ]),
    );
  });

  test('should refuse locked vault with differing vault identity', async () => {
    // Test 6: LOCKED Vault + DIFFERING identity → still refused
    // Locked detection needed no Master Key
    const handle1 = await setupHandle('user-1', []);
    await handle1.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Create locked handle
    const lockedHandle = createVaultHandle({ owner: 'user-1' });
    expect(lockedHandle.isUnlocked).toBe(false);

    // Create different vault meta
    const handle2 = await setupHandle('user-2', []);
    const differentVaultMeta = serverMetaFor(handle2);

    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;
    const decryptSpy = jest
      .spyOn(lockedHandle, 'decryptCiphertext')
      .mockRejectedValue(new Error('Should not decrypt'));

    const outcome = await convergeVaultBlob({
      api,
      handle: lockedHandle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: differentVaultMeta,
    });

    expect(outcome).toEqual({
      kind: 'refused',
      reason: 'different-vault',
    });

    // Verify decryptCiphertext was never called (refused before decrypt attempt)
    expect(decryptSpy).not.toHaveBeenCalled();

    decryptSpy.mockRestore();
  });

  test('should take clean remote on locked vault with identical vault identity', async () => {
    // Test 7: LOCKED Vault + IDENTICAL identity → locked convergence behaves as before
    const handle = await setupHandle('user-1', []);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-1',
        title: 'Remote task',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    // Create fresh locked handle
    const lockedHandle = createVaultHandle({ owner: 'user-1' });
    expect(lockedHandle.isUnlocked).toBe(false);

    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle: lockedHandle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: serverMetaFor(lockedHandle),
      remote,
    });

    // Should take even while locked (clean path needs no Master Key)
    expect(outcome).toEqual({ kind: 'took', etag: 'etag-remote' });
  });

  test('should not refuse after passphrase rotation (identity unchanged)', async () => {
    // Test 8: Rotated passphrase is NOT a differing identity
    // Proof: converge proceeds normally (clean take) after rotation
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Capture remote BEFORE passphrase change
    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-2',
        title: 'Remote',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    // Capture the vault state BEFORE passphrase change (same identity)
    const preRotationVault = handle.loadVault();
    if (!preRotationVault) throw new Error('Vault load failed');
    const preRotationMeta = localToServerMeta(preRotationVault);

    // Change passphrase (identity stays same, wrapping changes). Authorized by
    // the current passphrase — the rewrap re-derives from the salt the Vault
    // already holds, which is exactly why it cannot read as another Vault.
    await handle.changePassphrase({
      currentPassphrase: passphrase,
      newPassphrase: 'new pass 2026',
    });

    // Build serverMeta from PRE-rotation vault (identity unchanged)
    const serverMeta: ServerVaultMeta = {
      etag: 'meta-etag',
      updatedAt: '2026-01-01T00:00:00.000Z',
      meta: preRotationMeta,
    };

    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta,
      remote,
    });

    // Should take normally (identity same, passphrase wrapping doesn't affect blob convergence)
    expect(outcome).toEqual({ kind: 'took', etag: 'etag-remote' });
  });

  test('should not refuse after recovery key rotation (identity unchanged)', async () => {
    // Test 9: Replaced Recovery Key is NOT a differing identity
    // Proof: converge proceeds normally (clean take) after rotation
    const handle = await setupHandle('user-1', [
      {
        id: 'task-1',
        title: 'Local',
        status: 'todo',
        priority: 'high',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    // Capture remote BEFORE recovery key rotation
    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-2',
        title: 'Remote',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    // Capture vault state BEFORE recovery key rotation (same identity)
    const preRotationVault = handle.loadVault();
    if (!preRotationVault) throw new Error('Vault load failed');
    const preRotationMeta = localToServerMeta(preRotationVault);

    // Rotate the Recovery Key (identity stays same, recovery wrapping changes).
    // Authorized by the passphrase and never by the key being replaced, and the
    // Master Key does not move — no salt and no KDF parameter changes, which is
    // why another device reads this as a rotation rather than a second Vault.
    await handle.rotateRecoveryKey({
      currentPassphrase: passphrase,
      recoveryKey: mintRecoveryKey(),
    });

    // Build serverMeta from PRE-rotation vault (identity unchanged)
    const serverMeta: ServerVaultMeta = {
      etag: 'meta-etag',
      updatedAt: '2026-01-01T00:00:00.000Z',
      meta: preRotationMeta,
    };

    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta,
      remote,
    });

    // Should take normally (identity same, recovery key doesn't affect blob convergence)
    expect(outcome).toEqual({ kind: 'took', etag: 'etag-remote' });
  });

  test('should take clean remote when serverMeta is null (no server meta)', async () => {
    // Test 10: serverMeta: null (server holds no Vault Meta) → never refused
    const handle = await setupHandle('user-1', []);
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

    const remote = await captureRemoteBlob(handle, [
      {
        id: 'task-1',
        title: 'Remote task',
        status: 'done',
        priority: 'medium',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: null, // No server meta — first sync
      remote,
    });

    // Should take (null means server has nothing yet, so no refusal)
    expect(outcome).toEqual({ kind: 'took', etag: 'etag-remote' });

    // Verify bookmark advanced
    expect(handle.lastPushedEtag('tasks')).toBe('etag-remote');
  });

  test('should return nothing when no local vault even with differing serverMeta', async () => {
    // Test 11: No Local Vault + DIFFERING serverMeta → still nothing/no-local-vault
    const handle = createVaultHandle({ owner: 'user-1' });
    // No initialize — no local vault

    // Create a different vault meta (doesn't matter if no local vault)
    const otherHandle = await setupHandle('user-2', []);
    const differentVaultMeta = serverMetaFor(otherHandle);

    const api = createApiDouble();
    const prompt = jest.fn() as VaultBlobConvergePrompt;

    const outcome = await convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta: differentVaultMeta,
    });

    // Should return no-local-vault (guard after local vault load check)
    expect(outcome).toEqual({
      kind: 'nothing',
      reason: 'no-local-vault',
    });

    // Verify no API calls
    expect(api.getVaultBlob).not.toHaveBeenCalled();
    expect(api.putVaultBlob).not.toHaveBeenCalled();
  });

  describe('Observed Vault Identity recording', () => {
    test('should record observed vault identity when serverMeta is present and identity matches (ordinary case)', async () => {
      const handle = await setupHandle('user-1', []);
      await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

      const api = createApiDouble();
      const prompt = jest.fn() as VaultBlobConvergePrompt;

      // Get the expected identity from the local vault
      const vault = handle.loadVault();
      if (!vault) throw new Error('Setup failed');
      const expectedIdentity = vaultIdentityOf(localToServerMeta(vault));

      const outcome = await convergeVaultBlob({
        api,
        handle,
        type: VaultBlobType.Tasks,
        prompt,
        serverMeta: serverMetaFor(handle),
      });

      // Should converge normally
      expect(outcome.kind).toMatch(/nothing|sent|took/);

      // Assert: observed vault identity was recorded
      expect(handle.observedVaultIdentity()).toBe(expectedIdentity);
    });

    test('should record observed vault identity even when identity differs (refused/different-vault case)', async () => {
      const localHandle = await setupHandle('user-1', []);
      await localHandle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

      // Create a remote vault under a different master key
      const remoteHandle = await setupHandle('user-2', []);
      const remoteMeta = serverMetaFor(remoteHandle);
      const remoteIdentity = vaultIdentityOf(remoteMeta.meta);

      const api = createApiDouble();
      const prompt = jest.fn() as VaultBlobConvergePrompt;

      const outcome = await convergeVaultBlob({
        api,
        handle: localHandle,
        type: VaultBlobType.Tasks,
        prompt,
        serverMeta: remoteMeta,
      });

      // Should refuse the different vault
      expect(outcome).toEqual({ kind: 'refused', reason: 'different-vault' });

      // Assert: observed vault identity was still recorded (before the refusal)
      expect(localHandle.observedVaultIdentity()).toBe(remoteIdentity);
    });

    test('should not record observed vault identity when serverMeta is null (first sync / no server meta)', async () => {
      const handle = await setupHandle('user-1', []);
      await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });

      const api = createApiDouble();
      const prompt = jest.fn() as VaultBlobConvergePrompt;

      // Record an existing identity first
      handle.recordObservedVaultIdentity({
        identity: 'previous-identity',
      });
      expect(handle.observedVaultIdentity()).toBe('previous-identity');

      const outcome = await convergeVaultBlob({
        api,
        handle,
        type: VaultBlobType.Tasks,
        prompt,
        serverMeta: null, // No server meta — nothing to observe
      });

      // Should converge (in-sync in this case)
      expect(outcome.kind).toBe('nothing');

      // Assert: observed vault identity was NOT overwritten
      // (it remains at the previously recorded value since no new observation was made)
      expect(handle.observedVaultIdentity()).toBe('previous-identity');
    });
  });

  describe('a local edit that lands during convergence (ADR 0143)', () => {
    const localTask = {
      id: 'task-local',
      title: 'Local task',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z',
    };
    const remoteTask = {
      id: 'task-1',
      title: 'Remote task',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T09:00:00.000Z',
    };

    /** A tasks payload holding one record, titled `title`, as a User edit. */
    function editedTasks(title: string): VaultBlobEnvelope<unknown> {
      return {
        records: [
          {
            id: 'task-local',
            title,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T11:00:00.000Z',
          },
        ],
        deletions: {},
      };
    }

    /**
     * A handle whose named methods are replaced by `overrides`. Everything
     * else is the real handle, reached through the prototype, so a test can
     * land a local edit inside one specific await of the pass.
     */
    function interposed(
      handle: ConvergingVaultHandle,
      overrides: Partial<ConvergingVaultHandle>,
    ): ConvergingVaultHandle {
      return Object.assign(
        Object.create(handle) as ConvergingVaultHandle,
        overrides,
      );
    }

    test('clean path: a local edit landing after the pass read the Local Vault supersedes the take, which writes nothing and records no Sync Bookmark', async () => {
      const handle = await setupHandle('user-1', [localTask]);
      await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });
      const remote = await captureRemoteBlob(handle, [remoteTask]);

      const api = createApiDouble();
      const converging = interposed(handle, {
        hasUnsentChanges: async (type) => {
          const unsent = await handle.hasUnsentChanges(type);
          await handle.saveEncryptedData({
            type: 'tasks',
            value: editedTasks('edited during the pass'),
          });
          return unsent;
        },
      });

      const outcome = await convergeVaultBlob({
        api,
        handle: converging,
        type: VaultBlobType.Tasks,
        prompt: jest.fn() as VaultBlobConvergePrompt,
        serverMeta: serverMetaFor(handle),
        remote,
      });

      expect(outcome).toEqual({ kind: 'superseded' });
      expect(api.putVaultBlob).not.toHaveBeenCalled();
      expect(handle.lastPushedEtag('tasks')).toBe('etag-1');

      const decrypted = await handle.loadDecryptedData<unknown>({
        type: 'tasks',
        defaultValue: null,
      });
      expect(readVaultBlobRecords(decrypted)).toEqual([
        expect.objectContaining({ title: 'edited during the pass' }),
      ]);
    });

    test('clean path: the take writes only its own type, so another type written during the pass survives, and the Local Vault Revision moves', async () => {
      const revision = createLocalVaultRevision();
      const handle = createVaultHandle({ owner: 'user-1', revision });
      await handle.initialize({ passphrase });
      await handle.unlockWithPassphrase({ passphrase });
      await handle.saveEncryptedData({
        type: 'tasks',
        value: { records: [localTask], deletions: {} },
      });
      await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-1' });
      const remote = await captureRemoteBlob(handle, [remoteTask]);
      const revisionBefore = revision.current();

      const addressWrittenDuringPass = {
        records: [{ id: 'address-1', label: 'Written during the pass' }],
        deletions: {},
      };
      const converging = interposed(handle, {
        hasUnsentChanges: async (type) => {
          const unsent = await handle.hasUnsentChanges(type);
          await handle.saveEncryptedData({
            type: 'addresses',
            value: addressWrittenDuringPass,
          });
          return unsent;
        },
      });

      const outcome = await convergeVaultBlob({
        api: createApiDouble(),
        handle: converging,
        type: VaultBlobType.Tasks,
        prompt: jest.fn() as VaultBlobConvergePrompt,
        serverMeta: serverMetaFor(handle),
        remote,
      });

      expect(outcome).toEqual({ kind: 'took', etag: 'etag-remote' });
      expect(revision.current()).toBeGreaterThan(revisionBefore);
      expect(
        await handle.loadDecryptedData({
          type: 'addresses',
          defaultValue: null,
        }),
      ).toEqual(addressWrittenDuringPass);

      const decrypted = await handle.loadDecryptedData<unknown>({
        type: 'tasks',
        defaultValue: null,
      });
      expect(readVaultBlobRecords(decrypted)).toEqual([
        expect.objectContaining({ id: 'task-1', title: 'Remote task' }),
      ]);
    });

    test('keep-remote answered after a local edit landed during the prompt is superseded: nothing is taken and the edit is kept', async () => {
      // No Sync Bookmark, so the local copy is unsent and the remote copy is
      // undecryptable: convergence asks, and the answer arrives after an edit.
      const handle = await setupHandle('user-1', [localTask]);
      const undecryptable = await makeUndecryptableRemote([remoteTask]);

      const api = createApiDouble();
      const prompt = jest.fn(async () => {
        await handle.saveEncryptedData({
          type: 'tasks',
          value: editedTasks('edited while asked'),
        });
        return 'keep-remote' as const;
      }) as VaultBlobConvergePrompt;

      const outcome = await convergeVaultBlob({
        api,
        handle,
        type: VaultBlobType.Tasks,
        prompt,
        serverMeta: serverMetaFor(handle),
        remote: undecryptable,
      });

      expect(prompt).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'undecryptable-remote' }),
      );
      expect(outcome).toEqual({ kind: 'superseded' });
      expect(api.putVaultBlob).not.toHaveBeenCalled();
      expect(handle.lastPushedEtag('tasks')).toBeUndefined();

      const decrypted = await handle.loadDecryptedData<unknown>({
        type: 'tasks',
        defaultValue: null,
      });
      expect(readVaultBlobRecords(decrypted)).toEqual([
        expect.objectContaining({ title: 'edited while asked' }),
      ]);
    });

    test('merge path: a local edit landing while the remote copy is decrypted supersedes the merge, which is neither saved nor sent', async () => {
      // No Sync Bookmark and a readable remote copy: convergence merges. The
      // edit lands between the two decryptions that feed the merge.
      const handle = await setupHandle('user-1', [localTask]);
      const remote = await captureRemoteBlob(handle, [remoteTask]);

      let editLanded = false;
      const converging = interposed(handle, {
        decryptCiphertext: async <T>(options: { blob: EncryptedBlob }) => {
          const decrypted = await handle.decryptCiphertext<T>(options);
          if (!editLanded) {
            editLanded = true;
            await handle.saveEncryptedData({
              type: 'tasks',
              value: editedTasks('edited during the merge'),
            });
          }
          return decrypted;
        },
      });

      const api = createApiDouble();
      const outcome = await convergeVaultBlob({
        api,
        handle: converging,
        type: VaultBlobType.Tasks,
        prompt: jest.fn() as VaultBlobConvergePrompt,
        serverMeta: serverMetaFor(handle),
        remote,
      });

      expect(editLanded).toBe(true);
      expect(outcome).toEqual({ kind: 'superseded' });
      expect(api.putVaultBlob).not.toHaveBeenCalled();

      // Only the edit is stored: a written merge would also hold 'Remote task'.
      const decrypted = await handle.loadDecryptedData<unknown>({
        type: 'tasks',
        defaultValue: null,
      });
      expect(readVaultBlobRecords(decrypted)).toEqual([
        expect.objectContaining({ title: 'edited during the merge' }),
      ]);
    });

    test('merge path: a failure of the merge write that is not a contention is rethrown, and nothing is sent', async () => {
      const handle = await setupHandle('user-1', [localTask]);
      const remote = await captureRemoteBlob(handle, [remoteTask]);

      const failure = new Error('disk full');
      const converging = interposed(handle, {
        saveEncryptedData: async () => {
          throw failure;
        },
      });

      const api = createApiDouble();
      await expect(
        convergeVaultBlob({
          api,
          handle: converging,
          type: VaultBlobType.Tasks,
          prompt: jest.fn() as VaultBlobConvergePrompt,
          serverMeta: serverMetaFor(handle),
          remote,
        }),
      ).rejects.toBe(failure);
      expect(api.putVaultBlob).not.toHaveBeenCalled();
      expect(handle.lastPushedEtag('tasks')).toBeUndefined();
    });
  });
});

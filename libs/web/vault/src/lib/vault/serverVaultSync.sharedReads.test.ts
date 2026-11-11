import {
  EncryptedBlobV1,
  VaultBlobType,
  VaultMetaV1,
} from '@myorganiser/app-api-client';
import {
  convergeVaultBlob,
  type VaultBlobConvergePrompt,
} from './vaultConverge';
import { createVaultHandle } from './vaultHandle';
import { expectStillPending } from './promisePending.testutil';
import {
  putServerVaultBlobEtagAware,
  putServerVaultMetaEtagAware,
  sendVaultWrite,
  shareInFlightVaultReads,
  type ServerVaultMeta,
} from './serverVaultSync';
import { localToServerMeta } from './vaultShapes';

type ApiForWrapper = Parameters<typeof shareInFlightVaultReads>[0];

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A hand-written stand-in for the generated VaultApi. Every call returns a
 * deferred request, appended to `requests` in call order, so each test decides
 * when each request settles and so keeps it in flight for as long as it needs.
 */
type FakeVaultApi = {
  api: {
    getVaultMeta: jest.Mock;
    getVaultBlobInventory: jest.Mock;
    getVaultBlob: jest.Mock;
    putVaultMeta: jest.Mock;
    putVaultBlob: jest.Mock;
  };
  requests: Deferred<unknown>[];
};

function fakeVaultApi(): FakeVaultApi {
  const requests: Deferred<unknown>[] = [];
  const request = () => {
    const pending = deferred<unknown>();
    requests.push(pending);
    return pending.promise;
  };
  return {
    api: {
      getVaultMeta: jest.fn(request),
      getVaultBlobInventory: jest.fn(request),
      getVaultBlob: jest.fn(request),
      putVaultMeta: jest.fn(request),
      putVaultBlob: jest.fn(request),
    },
    requests,
  };
}

/** The fake, behind the shared-read wrapper. */
function wrap(fake: FakeVaultApi, owner: string) {
  return shareInFlightVaultReads(fake.api as unknown as ApiForWrapper, owner);
}

/** The fake, unwrapped: the production shape for the sync queue, reconcile and meta push. */
function rawApi(fake: FakeVaultApi): ApiForWrapper {
  return fake.api as unknown as ApiForWrapper;
}

/** Resolve every request still open, so no promise is left pending. */
function settleOpen(fake: FakeVaultApi): void {
  for (const request of fake.requests) request.resolve({});
}

/** Let every pending microtask chain run to its next await on a request. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i += 1) await flush();
  if (!predicate()) throw new Error('condition was not reached');
}

function httpError(status: number): Error & { response: { status: number } } {
  const error = new Error(`HTTP ${status}`) as Error & {
    response: { status: number };
  };
  error.response = { status };
  return error;
}

function makeMeta(overrides: Partial<VaultMetaV1> = {}): VaultMetaV1 {
  return {
    version: 1,
    kdf_name: 'PBKDF2',
    kdf_salt: 'salt',
    kdf_params: { iterations: 1, hash: 'SHA-256' },
    wrapped_mk_passphrase: { iv: 'iv', ciphertext: 'ct' },
    wrapped_mk_recovery: { iv: 'iv', ciphertext: 'ct' },
    ...overrides,
  };
}

function makeBlob(): EncryptedBlobV1 {
  return { version: 1, iv: 'iv', ciphertext: 'ciphertext' };
}

function metaResponse(kdfSalt = 'salt') {
  return {
    data: {
      etag: 'meta-etag-1',
      updatedAt: 'meta-t1',
      meta: makeMeta({ kdf_salt: kdfSalt }),
    },
  };
}

function inventoryResponse(etag = 'inventory-etag-1') {
  return {
    data: {
      etag,
      blobs: [
        {
          type: VaultBlobType.Groceries,
          etag: 'groceries-etag-1',
          updatedAt: 'groceries-t1',
        },
      ],
    },
  };
}

function putMetaResponse(etag: string) {
  return {
    data: { ok: true, etag, updatedAt: 'meta-t2', message: 'ok' },
  };
}

function putBlobResponse(etag: string) {
  return {
    data: { ok: true, etag, updatedAt: 'blob-t2', message: 'ok' },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('shareInFlightVaultReads', () => {
  it('should share one wire request when an identical meta read is in flight', async () => {
    const owner = 'owner-meta-join';
    const first = fakeVaultApi();
    const second = fakeVaultApi();

    const a = wrap(first, owner).getVaultMeta();
    const b = wrap(second, owner).getVaultMeta();

    expect(first.api.getVaultMeta).toHaveBeenCalledTimes(1);
    expect(second.api.getVaultMeta).not.toHaveBeenCalled();

    first.requests[0].resolve(metaResponse());

    await expect(a).resolves.toEqual(metaResponse());
    await expect(b).resolves.toEqual(metaResponse());
  });

  it('should share one wire request for {} and undefined inventory params when both are in flight', async () => {
    const owner = 'owner-inventory-join';
    const first = fakeVaultApi();
    const second = fakeVaultApi();

    const a = wrap(first, owner).getVaultBlobInventory({});
    const b = wrap(second, owner).getVaultBlobInventory(undefined);

    expect(first.api.getVaultBlobInventory).toHaveBeenCalledTimes(1);
    expect(second.api.getVaultBlobInventory).not.toHaveBeenCalled();

    first.requests[0].resolve(inventoryResponse());

    await expect(a).resolves.toEqual(inventoryResponse());
    await expect(b).resolves.toEqual(inventoryResponse());
  });

  it('should send separate requests when owners or read kinds differ', async () => {
    const fakeA = fakeVaultApi();
    const fakeB = fakeVaultApi();

    wrap(fakeA, 'owner-keys-a').getVaultMeta();
    wrap(fakeB, 'owner-keys-b').getVaultMeta();

    // Different owner, same read: its own request.
    expect(fakeA.api.getVaultMeta).toHaveBeenCalledTimes(1);
    expect(fakeB.api.getVaultMeta).toHaveBeenCalledTimes(1);

    // Same owner, different read: its own request, not the meta one.
    wrap(fakeA, 'owner-keys-a').getVaultBlobInventory({});
    expect(fakeA.api.getVaultBlobInventory).toHaveBeenCalledTimes(1);

    // Different owner, inventory read, while owner A's inventory is in flight:
    // its own request too.
    wrap(fakeB, 'owner-keys-b').getVaultBlobInventory({});
    expect(fakeB.api.getVaultBlobInventory).toHaveBeenCalledTimes(1);

    settleOpen(fakeA);
    settleOpen(fakeB);
  });

  it('should share the request when ifNoneMatch is null', async () => {
    const owner = 'owner-null-match';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);
    // The generated type does not allow null; the wrapper must still treat it
    // as "no condition".
    const nullMatch = { ifNoneMatch: null } as unknown as {
      ifNoneMatch?: string;
    };

    const a = wrapper.getVaultBlobInventory(nullMatch);
    const b = wrapper.getVaultBlobInventory({});

    expect(fake.api.getVaultBlobInventory).toHaveBeenCalledTimes(1);

    fake.requests[0].resolve(inventoryResponse());

    await expect(a).resolves.toEqual(inventoryResponse());
    await expect(b).resolves.toEqual(inventoryResponse());
  });

  it('should send a new request when the previous shared read has settled or rejected', async () => {
    const owner = 'owner-settle-ok';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);

    const first = wrapper.getVaultMeta();
    fake.requests[0].resolve(metaResponse());
    await first;

    const second = wrapper.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(2);

    fake.requests[1].resolve(metaResponse());
    await expect(second).resolves.toEqual(metaResponse());

    // A rejected shared read rejects every waiter with that error, then is
    // forgotten like a settled one.
    const rejectOwner = 'owner-reject';
    const fakeA = fakeVaultApi();
    const fakeB = fakeVaultApi();
    const error = new Error('network down');

    const a = wrap(fakeA, rejectOwner).getVaultMeta();
    const b = wrap(fakeB, rejectOwner).getVaultMeta();
    expect(fakeB.api.getVaultMeta).not.toHaveBeenCalled();

    fakeA.requests[0].reject(error);

    await expect(a).rejects.toBe(error);
    await expect(b).rejects.toBe(error);

    const retry = wrap(fakeA, rejectOwner).getVaultMeta();
    expect(fakeA.api.getVaultMeta).toHaveBeenCalledTimes(2);

    fakeA.requests[1].resolve(metaResponse());
    await expect(retry).resolves.toEqual(metaResponse());
  });

  it('should pass conditional reads through unshared when ifNoneMatch is set', async () => {
    const owner = 'owner-conditional';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);

    const paramsOne = { ifNoneMatch: 'etag-1' };
    const optionsOne = { headers: { 'X-Probe': 'one' } };
    const paramsTwo = { ifNoneMatch: 'etag-2' };
    const optionsTwo = {};

    // requests[0] is unconditional; the two conditional reads start while it
    // is in flight.
    const unconditional = wrapper.getVaultBlobInventory({});
    const conditionalOne = wrapper.getVaultBlobInventory(paramsOne, optionsOne);
    const conditionalTwo = wrapper.getVaultBlobInventory(paramsTwo, optionsTwo);

    expect(fake.api.getVaultBlobInventory).toHaveBeenCalledTimes(3);
    expect(fake.api.getVaultBlobInventory.mock.calls[1][0]).toBe(paramsOne);
    expect(fake.api.getVaultBlobInventory.mock.calls[1][1]).toBe(optionsOne);
    expect(fake.api.getVaultBlobInventory.mock.calls[2][0]).toBe(paramsTwo);
    expect(fake.api.getVaultBlobInventory.mock.calls[2][1]).toBe(optionsTwo);

    // Each caller gets the answer to its own request, never another's.
    fake.requests[0].resolve(inventoryResponse('inventory-etag-new'));
    fake.requests[1].resolve(inventoryResponse('inventory-etag-1'));
    fake.requests[2].resolve(inventoryResponse('inventory-etag-2'));

    await expect(unconditional).resolves.toEqual(
      inventoryResponse('inventory-etag-new'),
    );
    await expect(conditionalOne).resolves.toEqual(
      inventoryResponse('inventory-etag-1'),
    );
    await expect(conditionalTwo).resolves.toEqual(
      inventoryResponse('inventory-etag-2'),
    );
  });

  it('should give each caller its own copy when a response is shared', async () => {
    const metaOwner = 'owner-copies-meta';
    const fakeA = fakeVaultApi();
    const fakeB = fakeVaultApi();

    const metaA = wrap(fakeA, metaOwner).getVaultMeta();
    const metaB = wrap(fakeB, metaOwner).getVaultMeta();
    const sourceMeta = metaResponse();
    fakeA.requests[0].resolve(sourceMeta);

    const resultMetaA = await metaA;
    const resultMetaB = await metaB;

    expect(resultMetaA.data).not.toBe(sourceMeta.data);
    expect(resultMetaB.data).not.toBe(sourceMeta.data);
    expect(resultMetaA.data).not.toBe(resultMetaB.data);

    resultMetaA.data.meta.kdf_salt = 'mutated-by-a';
    resultMetaA.data.meta.kdf_params.iterations = 999;

    expect(resultMetaB.data.meta.kdf_salt).toBe('salt');
    expect(resultMetaB.data.meta.kdf_params.iterations).toBe(1);
    expect(sourceMeta.data.meta.kdf_salt).toBe('salt');

    const inventoryOwner = 'owner-copies-inventory';
    const fakeC = fakeVaultApi();
    const fakeD = fakeVaultApi();

    const inventoryC = wrap(fakeC, inventoryOwner).getVaultBlobInventory({});
    const inventoryD = wrap(fakeD, inventoryOwner).getVaultBlobInventory({});
    const sourceInventory = inventoryResponse();
    fakeC.requests[0].resolve(sourceInventory);

    const resultInventoryC = await inventoryC;
    const resultInventoryD = await inventoryD;

    expect(resultInventoryC.data).not.toBe(sourceInventory.data);
    expect(resultInventoryD.data).not.toBe(sourceInventory.data);
    expect(resultInventoryC.data).not.toBe(resultInventoryD.data);

    resultInventoryC.data.blobs[0].etag = 'mutated-by-c';

    expect(resultInventoryD.data.blobs[0].etag).toBe('groceries-etag-1');
    expect(sourceInventory.data.blobs[0].etag).toBe('groceries-etag-1');
  });

  it('should reject only the aborting caller when one of two waiters aborts', async () => {
    const owner = 'owner-abort-one';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);
    const controller = new AbortController();
    const reason = new Error('superseded');

    const aborted = wrapper.getVaultMeta({ signal: controller.signal });
    const kept = wrapper.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(1);

    controller.abort(reason);

    await expect(aborted).rejects.toBe(reason);
    await expectStillPending(kept);

    const underlyingSignal = fake.api.getVaultMeta.mock.calls[0][0]
      .signal as AbortSignal;
    expect(underlyingSignal.aborted).toBe(false);

    fake.requests[0].resolve(metaResponse());
    await expect(kept).resolves.toEqual(metaResponse());
  });

  it('should abort the shared request only when every waiter has aborted', async () => {
    const owner = 'owner-abort-all';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);
    const first = new AbortController();
    const second = new AbortController();
    const reasonB = new Error('second gave up');

    const a = wrapper.getVaultMeta({ signal: first.signal });
    const b = wrapper.getVaultMeta({ signal: second.signal });
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(1);

    const underlyingSignal = fake.api.getVaultMeta.mock.calls[0][0]
      .signal as AbortSignal;

    first.abort(new Error('first gave up'));
    await expect(a).rejects.toThrow('first gave up');
    expect(underlyingSignal.aborted).toBe(false);

    second.abort(reasonB);
    await expect(b).rejects.toBe(reasonB);
    expect(underlyingSignal.aborted).toBe(true);
    expect(underlyingSignal.reason).toBe(reasonB);

    const fresh = wrapper.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(2);

    fake.requests[1].resolve(metaResponse());
    await expect(fresh).resolves.toEqual(metaResponse());
    settleOpen(fake);
  });

  it('should reject at once without sending when the signal is already aborted', async () => {
    const owner = 'owner-pre-aborted';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);
    const controller = new AbortController();
    const reason = new Error('already gone');
    controller.abort(reason);

    await expect(
      wrapper.getVaultMeta({ signal: controller.signal }),
    ).rejects.toBe(reason);
    await expect(
      wrapper.getVaultBlobInventory({}, { signal: controller.signal }),
    ).rejects.toBe(reason);

    expect(fake.api.getVaultMeta).not.toHaveBeenCalled();
    expect(fake.api.getVaultBlobInventory).not.toHaveBeenCalled();
  });

  it('should send the wrapper signal and forward other options when a read is shared', () => {
    const owner = 'owner-options';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);
    const controller = new AbortController();

    wrapper.getVaultMeta({
      signal: controller.signal,
      timeout: 5000,
      headers: { 'X-Probe': 'yes' },
    });

    const receivedMeta = fake.api.getVaultMeta.mock.calls[0][0];
    expect(receivedMeta.signal).not.toBe(controller.signal);
    expect(receivedMeta.signal.aborted).toBe(false);
    expect(receivedMeta).toMatchObject({
      timeout: 5000,
      headers: { 'X-Probe': 'yes' },
    });

    wrapper.getVaultBlobInventory(
      {},
      { signal: controller.signal, timeout: 7000 },
    );

    const receivedInventoryOptions =
      fake.api.getVaultBlobInventory.mock.calls[0][1];
    expect(receivedInventoryOptions.signal).not.toBe(controller.signal);
    expect(receivedInventoryOptions).toMatchObject({ timeout: 7000 });

    settleOpen(fake);
  });

  it('should pass getVaultBlob, putVaultMeta and putVaultBlob straight through when called on the wrapper', () => {
    const owner = 'owner-pass-through';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);

    const blobParams = { type: VaultBlobType.Groceries };
    const blobOptions = { timeout: 1 };
    wrapper.getVaultBlob(blobParams, blobOptions);
    wrapper.getVaultBlob(blobParams, blobOptions);

    expect(fake.api.getVaultBlob).toHaveBeenCalledTimes(2);
    expect(fake.api.getVaultBlob.mock.calls[0][0]).toBe(blobParams);
    expect(fake.api.getVaultBlob.mock.calls[0][1]).toBe(blobOptions);

    const putMetaParams = {
      putVaultMetaRequest: { meta: makeMeta() },
      ifMatch: 'meta-etag-1',
    };
    const putMetaOptions = { timeout: 2 };
    wrapper.putVaultMeta(putMetaParams, putMetaOptions);

    expect(fake.api.putVaultMeta).toHaveBeenCalledTimes(1);
    expect(fake.api.putVaultMeta.mock.calls[0][0]).toBe(putMetaParams);
    expect(fake.api.putVaultMeta.mock.calls[0][1]).toBe(putMetaOptions);

    const putBlobParams = {
      type: VaultBlobType.Groceries,
      putVaultBlobRequest: {
        type: VaultBlobType.Groceries,
        blob: makeBlob(),
      },
      ifMatch: 'groceries-etag-1',
    };
    const putBlobOptions = { timeout: 3 };
    wrapper.putVaultBlob(putBlobParams, putBlobOptions);

    expect(fake.api.putVaultBlob).toHaveBeenCalledTimes(1);
    expect(fake.api.putVaultBlob.mock.calls[0][0]).toBe(putBlobParams);
    expect(fake.api.putVaultBlob.mock.calls[0][1]).toBe(putBlobOptions);

    settleOpen(fake);
  });
});

describe('sendVaultWrite', () => {
  it('should send a new request when a read starts after a write began', async () => {
    const owner = 'owner-write-forget';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);

    const beforeWrite = wrapper.getVaultMeta();
    // requests[1] is the write itself.
    const write = sendVaultWrite(() => fake.api.putVaultMeta({}));
    const afterWriteBegan = wrapper.getVaultMeta();

    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(2);

    fake.requests[1].resolve({});
    await write;
    fake.requests[0].resolve(metaResponse('before-write'));
    fake.requests[2].resolve(metaResponse('after-write-began'));

    await expect(beforeWrite).resolves.toEqual(metaResponse('before-write'));
    await expect(afterWriteBegan).resolves.toEqual(
      metaResponse('after-write-began'),
    );
  });

  it('should forget a read started during a write once the write settles', async () => {
    const owner = 'owner-write-settle';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);

    // requests[0] is the write itself.
    const write = sendVaultWrite(() => fake.api.putVaultBlob({}));
    // requests[1] is a read started while the write is in flight.
    const during = wrapper.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(1);

    fake.requests[0].resolve({});
    await write;

    // requests[2] starts after the write settled: it must not join `during`.
    const after = wrapper.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(2);

    fake.requests[1].resolve(metaResponse('during-write'));
    fake.requests[2].resolve(metaResponse('after-write'));

    await expect(during).resolves.toEqual(metaResponse('during-write'));
    await expect(after).resolves.toEqual(metaResponse('after-write'));
  });

  it('should keep a newer entry when an older request settles', async () => {
    const owner = 'owner-identity-guard';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);

    // requests[0] is E1. The write clears it from the registry.
    const e1 = wrapper.getVaultMeta();
    // requests[1] is the write, which stays pending.
    const write = sendVaultWrite(() => fake.api.putVaultBlob({}));
    // requests[2] is E2, a newer entry under the same key.
    const e2 = wrapper.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(2);

    // E1 settles while the write is still pending. Its settle must not
    // remove E2 from the registry.
    fake.requests[0].resolve(metaResponse('e1'));
    await e1;

    // R3 starts while the write is still pending and must join E2.
    const r3 = wrapper.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(2);

    fake.requests[2].resolve(metaResponse('e2'));
    fake.requests[1].resolve({});
    await write;

    await expect(e2).resolves.toEqual(metaResponse('e2'));
    await expect(r3).resolves.toEqual(metaResponse('e2'));
  });

  it('should return the write value and rethrow its error, forgetting reads even when the write fails', async () => {
    await expect(sendVaultWrite(async () => 'written')).resolves.toBe(
      'written',
    );

    const owner = 'owner-write-error';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);
    const error = new Error('write refused');

    // requests[0] is the write, which fails.
    const write = sendVaultWrite(() => fake.api.putVaultBlob({}));
    // requests[1] starts while the failing write is in flight.
    const during = wrapper.getVaultMeta();

    fake.requests[0].reject(error);
    await expect(write).rejects.toBe(error);

    // requests[2] starts after the failed write: it must not join `during`.
    const after = wrapper.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(2);

    settleOpen(fake);
    await during;
    await after;
  });

  it('should forget in-flight reads when a PUT is made through the wrapper', async () => {
    const owner = 'owner-direct-put';
    const fake = fakeVaultApi();
    const wrapper = wrap(fake, owner);

    // Meta: requests[0] is a read in flight before the PUT; requests[1] is
    // the direct PUT, still pending.
    const beforePut = wrapper.getVaultMeta();
    const put = wrapper.putVaultMeta({
      putVaultMetaRequest: { meta: makeMeta() },
      ifMatch: 'meta-etag-1',
    });

    // requests[2] starts while the PUT is pending: must not join beforePut.
    const duringPut = wrapper.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(2);

    fake.requests[1].resolve(putMetaResponse('meta-etag-2'));
    await put;

    // requests[3] starts after the PUT settled: must not join duringPut.
    const afterPut = wrapper.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(3);

    // Blobs, more briefly: the same check on the Vault Blob Inventory.
    // requests[4] is the inventory read in flight; requests[5] the blob PUT.
    const beforeBlobPut = wrapper.getVaultBlobInventory({});
    const blobPut = wrapper.putVaultBlob({
      type: VaultBlobType.Groceries,
      putVaultBlobRequest: {
        type: VaultBlobType.Groceries,
        blob: makeBlob(),
      },
      ifMatch: 'groceries-etag-1',
    });

    // requests[6] starts while the blob PUT is pending: must not join beforeBlobPut.
    const duringBlobPut = wrapper.getVaultBlobInventory({});
    expect(fake.api.getVaultBlobInventory).toHaveBeenCalledTimes(2);

    fake.requests[5].resolve({});
    await blobPut;

    // requests[7] starts after the blob PUT settled: must not join duringBlobPut.
    const afterBlobPut = wrapper.getVaultBlobInventory({});
    expect(fake.api.getVaultBlobInventory).toHaveBeenCalledTimes(3);

    settleOpen(fake);
    await beforePut;
    await duringPut;
    await afterPut;
    await beforeBlobPut;
    await duringBlobPut;
    await afterBlobPut;
  });
});

describe('put functions and convergence', () => {
  it('should forget reads on the wrapper when a raw meta PUT is in flight', async () => {
    const owner = 'owner-raw-meta-put';
    const readFake = fakeVaultApi();
    const rawFake = fakeVaultApi();
    const reads = wrap(readFake, owner);

    // readFake.requests[0] is a read in flight before the PUT.
    const beforePut = reads.getVaultMeta();
    // rawFake.requests[0] is the PUT, which is not wrapped.
    const put = putServerVaultMetaEtagAware({
      api: rawApi(rawFake),
      meta: makeMeta(),
      ifMatch: 'meta-etag-1',
      onConflict: () => 'keep-remote',
    });

    // readFake.requests[1] starts during the PUT: must not join beforePut.
    const duringPut = reads.getVaultMeta();
    expect(readFake.api.getVaultMeta).toHaveBeenCalledTimes(2);

    rawFake.requests[0].resolve(putMetaResponse('meta-etag-2'));
    await expect(put).resolves.toEqual({
      kind: 'updated',
      etag: 'meta-etag-2',
      updatedAt: 'meta-t2',
    });

    // readFake.requests[2] starts after the PUT settled: must not join duringPut.
    const afterPut = reads.getVaultMeta();
    expect(readFake.api.getVaultMeta).toHaveBeenCalledTimes(3);

    settleOpen(readFake);
    settleOpen(rawFake);
    await beforePut;
    await duringPut;
    await afterPut;
  });

  it('should forget inventory reads on the wrapper when a raw blob PUT is in flight', async () => {
    const owner = 'owner-raw-blob-put';
    const readFake = fakeVaultApi();
    const rawFake = fakeVaultApi();
    const reads = wrap(readFake, owner);

    const beforePut = reads.getVaultBlobInventory({});
    const put = putServerVaultBlobEtagAware({
      api: rawApi(rawFake),
      type: VaultBlobType.Groceries,
      blob: makeBlob(),
      ifMatch: 'groceries-etag-1',
    });

    const duringPut = reads.getVaultBlobInventory({});
    expect(readFake.api.getVaultBlobInventory).toHaveBeenCalledTimes(2);

    rawFake.requests[0].resolve(putBlobResponse('groceries-etag-2'));
    await expect(put).resolves.toEqual({
      kind: 'updated',
      etag: 'groceries-etag-2',
      updatedAt: 'blob-t2',
    });

    const afterPut = reads.getVaultBlobInventory({});
    expect(readFake.api.getVaultBlobInventory).toHaveBeenCalledTimes(3);

    settleOpen(readFake);
    settleOpen(rawFake);
    await beforePut;
    await duringPut;
    await afterPut;
  });

  it('should forget reads started during the remote GET when a meta PUT retries after a 409', async () => {
    const owner = 'owner-retry-meta';
    const readFake = fakeVaultApi();
    const rawFake = fakeVaultApi();
    const reads = wrap(readFake, owner);

    // readFake.requests[0] is in flight before the first PUT.
    const beforeFirstPut = reads.getVaultMeta();
    const put = putServerVaultMetaEtagAware({
      api: rawApi(rawFake),
      meta: makeMeta({ kdf_salt: 'local' }),
      ifMatch: 'local-etag',
      onConflict: () => 'keep-local',
    });

    // rawFake.requests[0] is the first PUT, refused with a 409.
    rawFake.requests[0].reject(httpError(409));
    await flush();

    // readFake.requests[1] starts during the remote GET, after the first PUT
    // has settled. Only the retry's own write can forget it.
    const duringRemoteGet = reads.getVaultMeta();
    expect(readFake.api.getVaultMeta).toHaveBeenCalledTimes(2);

    // rawFake.requests[1] is the remote GET of Vault Meta.
    rawFake.requests[1].resolve(metaResponse('remote'));
    await flush();

    // rawFake.requests[2] is the retry PUT, still pending.
    expect(rawFake.api.putVaultMeta).toHaveBeenCalledTimes(2);

    // readFake.requests[2] starts during the retry: must not join
    // duringRemoteGet, nor beforeFirstPut.
    const duringRetry = reads.getVaultMeta();
    expect(readFake.api.getVaultMeta).toHaveBeenCalledTimes(3);

    rawFake.requests[2].resolve(putMetaResponse('meta-etag-2'));
    await expect(put).resolves.toEqual({
      kind: 'updated',
      etag: 'meta-etag-2',
      updatedAt: 'meta-t2',
    });

    settleOpen(readFake);
    settleOpen(rawFake);
    await beforeFirstPut;
    await duringRemoteGet;
    await duringRetry;
  });

  it('should forget reads started during the remote GET when a blob PUT retries after a 409', async () => {
    const owner = 'owner-retry-blob';
    const readFake = fakeVaultApi();
    const rawFake = fakeVaultApi();
    const reads = wrap(readFake, owner);

    const beforeFirstPut = reads.getVaultBlobInventory({});
    const put = putServerVaultBlobEtagAware({
      api: rawApi(rawFake),
      type: VaultBlobType.Groceries,
      blob: makeBlob(),
      ifMatch: 'groceries-etag-1',
      onConflict: () => 'keep-local',
    });

    // rawFake.requests[0] is the first PUT, refused with a 409.
    rawFake.requests[0].reject(httpError(409));
    await flush();

    const duringRemoteGet = reads.getVaultBlobInventory({});
    expect(readFake.api.getVaultBlobInventory).toHaveBeenCalledTimes(2);

    // rawFake.requests[1] is the remote GET of the Vault Blob.
    rawFake.requests[1].resolve({
      data: {
        etag: 'groceries-etag-remote',
        updatedAt: 'blob-t1',
        type: VaultBlobType.Groceries,
        blob: makeBlob(),
      },
    });
    await flush();

    // rawFake.requests[2] is the retry PUT, still pending.
    expect(rawFake.api.putVaultBlob).toHaveBeenCalledTimes(2);

    const duringRetry = reads.getVaultBlobInventory({});
    expect(readFake.api.getVaultBlobInventory).toHaveBeenCalledTimes(3);

    rawFake.requests[2].resolve(putBlobResponse('groceries-etag-2'));
    await expect(put).resolves.toEqual({
      kind: 'updated',
      etag: 'groceries-etag-2',
      updatedAt: 'blob-t2',
    });

    settleOpen(readFake);
    settleOpen(rawFake);
    await beforeFirstPut;
    await duringRemoteGet;
    await duringRetry;
  });

  it('should forget a shared read in flight when a convergence push starts', async () => {
    const owner = 'owner-converge-push';
    const passphrase = 'vault key 2026';
    const handle = createVaultHandle({ owner });
    await handle.initialize({ passphrase });
    await handle.unlockWithPassphrase({ passphrase });
    // Save a clean Ciphertext first: a Sync Bookmark needs one to record.
    await handle.saveEncryptedData({
      type: 'tasks',
      value: { records: [], deletions: {} },
    });
    await handle.recordPushSuccess({ type: 'tasks', etag: 'etag-old' });
    // Dirty the Vault Blob so the convergence pushes it.
    await handle.saveEncryptedData({
      type: 'tasks',
      value: {
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
      },
    });

    const vault = handle.loadVault();
    if (!vault) throw new Error('Handle has no vault');
    const serverMeta: ServerVaultMeta = {
      etag: 'meta-etag',
      updatedAt: '2026-01-01T00:00:00.000Z',
      meta: localToServerMeta(vault),
    };

    const fake = fakeVaultApi();
    // The convergence gets the raw api, so only send()'s own write can clear
    // the read below. The reads go through the shared wrapper.
    const api = rawApi(fake);
    const reads = wrap(fake, owner);

    // requests[0] is a read in flight before the push.
    const beforePush = reads.getVaultMeta();

    const prompt = jest.fn() as VaultBlobConvergePrompt;
    const outcome = convergeVaultBlob({
      api,
      handle,
      type: VaultBlobType.Tasks,
      prompt,
      serverMeta,
    });

    // The push is the last request created once it has started.
    await waitUntil(() => fake.api.putVaultBlob.mock.calls.length === 1);
    const pushIndex = fake.requests.length - 1;

    // A read started during the push must not join beforePush.
    const duringPush = reads.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(2);

    fake.requests[pushIndex].resolve(putBlobResponse('etag-server'));
    await expect(outcome).resolves.toEqual({
      kind: 'sent',
      etag: 'etag-server',
    });

    // A read started after the push settled must not join duringPush.
    const afterPush = reads.getVaultMeta();
    expect(fake.api.getVaultMeta).toHaveBeenCalledTimes(3);

    settleOpen(fake);
    await beforePush;
    await duringPush;
    await afterPush;
  });
});

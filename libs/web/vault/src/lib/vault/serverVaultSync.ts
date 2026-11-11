import {
  EncryptedBlobV1,
  GetVaultBlobInventoryResponse,
  GetVaultBlobResponse,
  GetVaultMetaResponse,
  PutVaultBlobResponse,
  PutVaultMetaResponse,
  VaultApi,
  VaultBlobType,
  VaultMetaV1,
} from '@myorganiser/app-api-client';

type VaultApiLike = Pick<
  VaultApi,
  | 'getVaultMeta'
  | 'putVaultMeta'
  | 'getVaultBlob'
  | 'putVaultBlob'
  | 'getVaultBlobInventory'
>;

export type ServerVaultMeta = {
  etag: string;
  updatedAt: string;
  meta: VaultMetaV1;
};

export type ServerVaultBlob = {
  etag: string;
  updatedAt: string;
  type: VaultBlobType;
  blob: EncryptedBlobV1;
};

export type ConflictDecision = 'keep-local' | 'keep-remote';

export type VaultMetaConflictHandler = (params: {
  local: VaultMetaV1;
  remote: ServerVaultMeta;
}) => Promise<ConflictDecision> | ConflictDecision;

export type VaultBlobConflictHandler = (params: {
  local: EncryptedBlobV1;
  remote: ServerVaultBlob;
}) => Promise<ConflictDecision> | ConflictDecision;

function getHttpStatus(error: unknown): number | undefined {
  const maybeAny = error as any;
  const status = maybeAny?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * The per-call request options a read passes to the generated client, and the
 * only way an `AbortSignal` reaches the network from here.
 *
 * The generated client takes a `RawAxiosRequestConfig` as the last argument of
 * every operation and axios reads `signal` off it, so a caller that holds a
 * budget or a supersede decision can end a request in flight
 * ([ADR 0088](../../../../../docs/adr/0088-a-vault-pull-pass-has-a-budget-and-is-superseded-never-queued.md),
 * decision 2). The client itself is a synced output and is never edited to
 * carry one — this is the seam that exists for it.
 *
 * Built even when there is no signal, so every read has exactly one call shape
 * rather than one per caller.
 */
function requestOptions(signal: AbortSignal | undefined): {
  signal?: AbortSignal;
} {
  return { signal };
}

/**
 * One wire request that several callers are waiting on.
 *
 * `waiting` counts the callers still waiting. The request is aborted only when
 * that count drops to zero, so a caller that gives up does not end the request
 * for the callers still waiting on it.
 */
type SharedVaultRead = {
  response: Promise<unknown>;
  controller: AbortController;
  waiting: number;
};

/**
 * The unconditional Vault reads in flight right now, keyed by owner and read.
 *
 * In-flight only: an entry is removed the moment its request settles, so
 * nothing here is ever a cache and a read that starts after a settle always
 * goes to the server (#1489).
 */
const inFlightVaultReads = new Map<string, SharedVaultRead>();

type SharedVaultReadKind = 'vault-meta' | 'vault-blob-inventory';

function sharedVaultReadKey(owner: string, kind: SharedVaultReadKind): string {
  return JSON.stringify([owner, kind]);
}

function forgetSharedVaultRead(key: string, entry: SharedVaultRead): void {
  // A write may already have removed this entry and a newer read may have
  // taken its key. Only remove the entry this request owns.
  if (inFlightVaultReads.get(key) === entry) inFlightVaultReads.delete(key);
}

/**
 * Each caller gets its own copy of the response body. The body is parsed from
 * JSON on the wire, so a JSON round trip copies it without loss. jsdom has no
 * `structuredClone`.
 */
function copyVaultReadResponse<T>(response: T): T {
  const maybeResponse = response as { data?: unknown } | null;
  if (!maybeResponse || maybeResponse.data === undefined) return response;
  return {
    ...maybeResponse,
    data: JSON.parse(JSON.stringify(maybeResponse.data)),
  } as T;
}

/**
 * Join the identical read already in flight for `key`, or send it.
 *
 * The request is sent with a signal this module owns, not the caller's. A
 * caller's own `signal` ends only that caller's wait. The request is aborted
 * once every caller waiting on it has aborted, so the budget and supersede
 * rules in ADR 0088 still free the socket when nobody is left to answer.
 */
function joinVaultRead<T>(
  key: string,
  send: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason);

  let entry = inFlightVaultReads.get(key);
  if (!entry) {
    const controller = new AbortController();
    const created: SharedVaultRead = {
      response: send(controller.signal),
      controller,
      waiting: 0,
    };
    inFlightVaultReads.set(key, created);
    // Both branches handle the rejection, so a request that every caller
    // abandoned does not raise an unhandled rejection.
    created.response.then(
      () => forgetSharedVaultRead(key, created),
      () => forgetSharedVaultRead(key, created),
    );
    entry = created;
  }

  const shared = entry;
  shared.waiting += 1;

  return new Promise<T>((resolve, reject) => {
    let left = false;
    const leave = () => {
      if (left) return false;
      left = true;
      signal?.removeEventListener('abort', onAbort);
      shared.waiting -= 1;
      return true;
    };
    const onAbort = () => {
      if (!leave()) return;
      if (shared.waiting === 0) {
        forgetSharedVaultRead(key, shared);
        shared.controller.abort(signal?.reason);
      }
      reject(signal?.reason);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    shared.response.then(
      (response) => {
        if (leave()) resolve(copyVaultReadResponse(response as T));
      },
      (error: unknown) => {
        if (leave()) reject(error);
      },
    );
  });
}

/**
 * Send a write of Vault Meta or a Vault Blob. Every in-flight shared read is
 * forgotten before the write is sent and again after it settles.
 *
 * Before: a read that starts while the write is in flight must not join a
 * request sent before the write. After: a read that starts after the write
 * settles must not join a request sent while the write was in flight. Every
 * owner's entries are forgotten, because a write does not name its owner. The
 * only cost of forgetting too much is one request that is not shared.
 *
 * Every `putVaultMeta` and `putVaultBlob` in this library goes through here.
 */
export async function sendVaultWrite<T>(write: () => Promise<T>): Promise<T> {
  inFlightVaultReads.clear();
  try {
    return await write();
  } finally {
    inFlightVaultReads.clear();
  }
}

/**
 * The same Vault API, except that its unconditional reads of Vault Meta and of
 * the Vault Blob Inventory share one wire request with any identical read
 * already in flight for the same `owner` (#1489).
 *
 * The dashboard mounts `VaultReconcileRunner`, `VaultMetaConvergeRunner` and
 * `VaultPullRunner` together, and each one reads at mount. They stay
 * independent on purpose (ADR 0057, ADR 0087). Only the wire request is
 * shared, never a decision:
 *
 * - In flight only. Nothing is kept after the request settles.
 * - A conditional read (`If-None-Match`) is never shared. Its answer depends
 *   on the ETag its caller holds, so the ETag and Sync Bookmark semantics are
 *   unchanged.
 * - Each caller gets its own copy of the response body, so no caller can
 *   change another caller's data.
 * - Any write through {@link sendVaultWrite}, or through this wrapper's own
 *   `putVaultMeta` / `putVaultBlob`, forgets the shared reads.
 * - The shared request uses the first caller's request options. Only `signal`
 *   is read per caller; every caller here passes nothing else.
 * - `getVaultBlob` is passed through unchanged.
 */
export function shareInFlightVaultReads(
  api: VaultApiLike,
  owner: string,
): VaultApiLike {
  const getVaultMeta: VaultApiLike['getVaultMeta'] = (options) =>
    joinVaultRead(
      sharedVaultReadKey(owner, 'vault-meta'),
      (signal) => api.getVaultMeta({ ...options, signal }),
      options?.signal as AbortSignal | undefined,
    );

  const getVaultBlobInventory: VaultApiLike['getVaultBlobInventory'] = (
    requestParameters,
    options,
  ) => {
    if (requestParameters?.ifNoneMatch != null) {
      return api.getVaultBlobInventory(requestParameters, options);
    }
    return joinVaultRead(
      sharedVaultReadKey(owner, 'vault-blob-inventory'),
      (signal) =>
        api.getVaultBlobInventory(requestParameters, { ...options, signal }),
      options?.signal as AbortSignal | undefined,
    );
  };

  return {
    getVaultMeta,
    getVaultBlobInventory,
    getVaultBlob: (requestParameters, options) =>
      api.getVaultBlob(requestParameters, options),
    // Nested inside `sendVaultWrite` when a caller in this library writes.
    // Forgetting twice costs nothing, and a direct write through this wrapper
    // still forgets.
    putVaultMeta: (requestParameters, options) =>
      sendVaultWrite(() => api.putVaultMeta(requestParameters, options)),
    putVaultBlob: (requestParameters, options) =>
      sendVaultWrite(() => api.putVaultBlob(requestParameters, options)),
  };
}

function defaultBlobConflictHandler(params: {
  local: EncryptedBlobV1;
  remote: ServerVaultBlob;
}): ConflictDecision {
  void params;
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
    return 'keep-remote';
  }

  const overwrite = window.confirm(
    'Your vault data was updated in another session. Overwrite the server version with your local changes?',
  );

  return overwrite ? 'keep-local' : 'keep-remote';
}

function toServerVaultMeta(data: GetVaultMetaResponse): ServerVaultMeta {
  return {
    etag: data.etag,
    updatedAt: data.updatedAt,
    meta: data.meta,
  };
}

function toServerVaultBlob(data: GetVaultBlobResponse): ServerVaultBlob {
  return {
    etag: data.etag,
    updatedAt: data.updatedAt,
    type: data.type,
    blob: data.blob,
  };
}

export async function getServerVaultMeta(
  // Narrower than `VaultApiLike` for the same reason as `getServerVaultBlob`:
  // reading Vault Meta needs one method, and asking for `putVaultMeta` would
  // hand every caller the ability to push a local wrapping over the server's
  // and undo a passphrase change made on another device.
  api: Pick<VaultApiLike, 'getVaultMeta'>,
  /** Ends this read in flight — see {@link requestOptions}. */
  signal?: AbortSignal,
): Promise<ServerVaultMeta | null> {
  try {
    const response = await api.getVaultMeta(requestOptions(signal));
    return toServerVaultMeta(response.data as GetVaultMetaResponse);
  } catch (error) {
    if (getHttpStatus(error) === 404) return null;
    throw error;
  }
}

/**
 * One pass's observation of the server's Vault Meta, made at most once and
 * only if something actually asks for it.
 *
 * Convergence refuses to take a Vault Blob across a differing Vault Identity
 * and cannot go and look for itself, because it runs once per Vault Blob Type
 * inside a loop ([ADR 0067](../../../../../docs/adr/0067-a-vault-blob-is-never-taken-across-a-vault-identity.md)).
 * So each pass observes once and hands the same answer to every type. Lazy
 * because a pass that converges nothing — every type answering 304, a drain
 * with nothing marked — has nothing for the evidence to guard.
 *
 * The promise is what is remembered, not its value, so a failed observation is
 * remembered too: every type after it re-throws the same rejection into its
 * caller's own failure handling instead of converging against evidence the
 * pass never got. Returning `null` there would be a claim this code cannot
 * make — that the server holds no Vault Meta — and that claim is exactly what
 * disarms the guard.
 *
 * One per pass, so a caller builds it inside the pass and lets it fall out of
 * scope afterwards; a shared one would pin an observation across passes.
 */
export function observeServerVaultMetaOnce(
  api: Pick<VaultApiLike, 'getVaultMeta'>,
  /**
   * Ends the observation in flight. A pass's own signal, so the one request
   * this makes is as abortable as the reads around it — a pass that gave up
   * should not be left holding a socket on the one endpoint it asks last.
   */
  signal?: AbortSignal,
): () => Promise<ServerVaultMeta | null> {
  let observation: Promise<ServerVaultMeta | null> | null = null;
  return () => (observation ??= getServerVaultMeta(api, signal));
}

export async function getServerVaultBlob(
  // Narrower than `VaultApiLike` on purpose: reading one Vault Blob needs one
  // method, and asking for the other three would make every caller hand over
  // the ability to rewrite Vault Meta.
  api: Pick<VaultApiLike, 'getVaultBlob'>,
  type: VaultBlobType,
  /** Ends this read in flight — see {@link requestOptions}. */
  signal?: AbortSignal,
): Promise<ServerVaultBlob | null> {
  try {
    const response = await api.getVaultBlob({ type }, requestOptions(signal));
    return toServerVaultBlob(response.data as GetVaultBlobResponse);
  } catch (error) {
    if (getHttpStatus(error) === 404) return null;
    throw error;
  }
}

/** What a conditional check of one Vault Blob Type found. */
export type ServerVaultBlobCheck =
  /** `ifNoneMatch` matched the server's ETag — nothing to do. */
  | { kind: 'not-modified' }
  /** The server holds no Ciphertext for this type. */
  | { kind: 'absent' }
  /** The server's Ciphertext moved (or `ifNoneMatch` was never given). */
  | { kind: 'changed'; blob: ServerVaultBlob };

/**
 * Ask the server whether one Vault Blob Type's Ciphertext still matches
 * `ifNoneMatch` — a Sync Bookmark's ETag, or `undefined` when this device
 * holds none.
 *
 * This is Vault Pull's whole "did anything change" question, answered by a
 * conditional GET rather than by fetching and comparing: a 304 costs no
 * body and leaves nothing for the caller to do.
 */
export async function checkServerVaultBlob(
  // Narrower than `VaultApiLike` for the same reason `getServerVaultBlob` is.
  api: Pick<VaultApiLike, 'getVaultBlob'>,
  type: VaultBlobType,
  ifNoneMatch: string | undefined,
  /** Ends this read in flight — see {@link requestOptions}. */
  signal?: AbortSignal,
): Promise<ServerVaultBlobCheck> {
  try {
    const response = await api.getVaultBlob(
      { type, ifNoneMatch },
      requestOptions(signal),
    );
    return {
      kind: 'changed',
      blob: toServerVaultBlob(response.data as GetVaultBlobResponse),
    };
  } catch (error) {
    const status = getHttpStatus(error);
    if (status === 304) return { kind: 'not-modified' };
    if (status === 404) return { kind: 'absent' };
    throw error;
  }
}

/** One Vault Blob Type the Vault Blob Inventory says the server holds. */
export type ServerVaultBlobInventoryEntry = {
  type: VaultBlobType;
  /** The identity of that type's Ciphertext, comparable to a Sync Bookmark's. */
  etag: string;
  updatedAt: string;
};

/**
 * What the server says it holds for one User: which Vault Blob Types exist and
 * the identity of each one's Ciphertext.
 *
 * It describes Ciphertext and carries none, so it needs no unlock
 * ([ADR 0068](../../../../../docs/adr/0068-a-locked-vault-blocks-exactly-the-operations-that-need-the-master-key.md)).
 * A Vault Blob Type missing from `blobs` means there is nothing to pull for it,
 * never that anything should be deleted — see `vaultPullCheck.ts`.
 */
export type ServerVaultBlobInventory = {
  /** The whole inventory's ETag, for the next read's `If-None-Match`. */
  etag: string;
  blobs: ServerVaultBlobInventoryEntry[];
};

/** What a conditional read of the Vault Blob Inventory found. */
export type ServerVaultBlobInventoryCheck =
  /** `ifNoneMatch` matched — no Vault Blob Type moved since it was read. */
  | { kind: 'not-modified' }
  /** The inventory as the server now holds it. */
  | { kind: 'inventory'; inventory: ServerVaultBlobInventory };

/**
 * Read the Vault Blob Inventory, conditionally on `ifNoneMatch` — the ETag a
 * previous read answered with, or `undefined` when this device holds none.
 *
 * The inventory's ETag is derived from its members', so it moves exactly when
 * some Vault Blob did: a 304 here is the whole of "nothing changed anywhere",
 * which is what makes the steady state of a Vault Pull Pass one request
 * ([ADR 0087](../../../../../docs/adr/0087-a-vault-pull-pass-asks-the-vault-blob-inventory-and-absence-deletes-nothing.md),
 * decision 3).
 *
 * Only 304 is read as an answer. Every other failure — including a 401/403 —
 * is re-thrown for the caller to classify, because there is no fallback to
 * fall back to: a pass that cannot read the inventory asks about nothing
 * (decision 6).
 */
export async function checkServerVaultBlobInventory(
  // Narrower than `VaultApiLike` for the same reason every other read here is.
  api: Pick<VaultApiLike, 'getVaultBlobInventory'>,
  ifNoneMatch: string | undefined,
  /** Ends this read in flight — see {@link requestOptions}. */
  signal?: AbortSignal,
): Promise<ServerVaultBlobInventoryCheck> {
  try {
    const response = await api.getVaultBlobInventory(
      { ifNoneMatch },
      requestOptions(signal),
    );
    const data = response.data as GetVaultBlobInventoryResponse;
    return {
      kind: 'inventory',
      inventory: {
        etag: data.etag,
        blobs: data.blobs.map((entry) => ({
          type: entry.type,
          etag: entry.etag,
          updatedAt: entry.updatedAt,
        })),
      },
    };
  } catch (error) {
    if (getHttpStatus(error) === 304) return { kind: 'not-modified' };
    throw error;
  }
}

/**
 * What pull and reconcile both need from one inventory read: the etag map,
 * a 304, a lost Session, or any other failure.
 *
 * `checkServerVaultBlobInventory` rethrows everything except 304. Both
 * callers then built the same `Map` and split 401/403 from the rest. That
 * parse lives here so a new caller cannot re-implement half of it.
 */
export type VaultBlobInventoryEtagsRead =
  | { kind: 'not-modified' }
  | {
      kind: 'inventory';
      etag: string;
      etags: Map<VaultBlobType, string>;
    }
  | { kind: 'unauthenticated' }
  | { kind: 'failed'; error: unknown };

/**
 * Await one inventory check and classify it. The caller still decides what
 * a lost Session or a failed read means for its pass — pull records every
 * type unanswered; reconcile throws — because those are pass semantics, not
 * inventory semantics.
 */
export async function readVaultBlobInventoryEtags(
  read: Promise<ServerVaultBlobInventoryCheck>,
): Promise<VaultBlobInventoryEtagsRead> {
  try {
    const check = await read;
    if (check.kind === 'not-modified') return { kind: 'not-modified' };
    return {
      kind: 'inventory',
      etag: check.inventory.etag,
      etags: new Map(
        check.inventory.blobs.map((entry) => [entry.type, entry.etag]),
      ),
    };
  } catch (error) {
    const status = getHttpStatus(error);
    if (status === 401 || status === 403) return { kind: 'unauthenticated' };
    return { kind: 'failed', error };
  }
}

/**
 * Whether one Vault Blob Type is worth a per-type GET, given this pass's
 * inventory etags and this device's Sync Bookmark.
 *
 * Absence is never a deletion (ADR 0087, decision 5). A matching bookmark
 * means the inventory already answered "not modified" for this type. The
 * caller still chooses the GET — pull sends If-None-Match; reconcile does
 * not — because those are transport shapes, not the decision.
 */
export type VaultBlobInventoryFetchDecision =
  | { kind: 'absent' }
  | { kind: 'unchanged' }
  | { kind: 'fetch'; serverEtag: string };

export function vaultBlobInventoryFetchDecision(options: {
  serverEtags: Map<VaultBlobType, string>;
  type: VaultBlobType;
  bookmark: string | undefined;
}): VaultBlobInventoryFetchDecision {
  const serverEtag = options.serverEtags.get(options.type);
  if (serverEtag === undefined) return { kind: 'absent' };
  if (options.bookmark === serverEtag) return { kind: 'unchanged' };
  return { kind: 'fetch', serverEtag };
}

export type PutVaultMetaResult =
  | {
      kind: 'updated';
      etag: string;
      updatedAt: string;
    }
  | {
      kind: 'kept-remote';
      remote: ServerVaultMeta;
    };

export async function putServerVaultMetaEtagAware(options: {
  // The two methods this actually uses, and not the two it does not. Handing
  // a caller `putVaultBlob` to write a Vault Meta is the same overreach this
  // file avoids on every read path.
  api: Pick<VaultApiLike, 'getVaultMeta' | 'putVaultMeta'>;
  meta: VaultMetaV1;
  ifMatch?: string;
  /**
   * Required, and deliberately not defaulted. A Vault Meta conflict means two
   * devices changed a wrapping independently, and a wrapping cannot be
   * verified without the passphrase it was derived from (ADR 0057) — so there
   * is no answer this function could pick that is safe in general, and a
   * default would pick one anyway. The blob path below still defaults,
   * because Ciphertext a conflict handler chooses between can at least be
   * decrypted and compared.
   */
  onConflict: VaultMetaConflictHandler;
}): Promise<PutVaultMetaResult> {
  const { onConflict } = options;

  try {
    const response = await sendVaultWrite(() =>
      options.api.putVaultMeta({
        putVaultMetaRequest: { meta: options.meta },
        ifMatch: options.ifMatch,
      }),
    );

    const data = response.data as PutVaultMetaResponse;
    return { kind: 'updated', etag: data.etag, updatedAt: data.updatedAt };
  } catch (error) {
    if (getHttpStatus(error) !== 409) throw error;

    const remote = await getServerVaultMeta(options.api);
    if (!remote) throw error;

    const decision = await onConflict({ local: options.meta, remote });
    if (decision === 'keep-remote') {
      return { kind: 'kept-remote', remote };
    }

    const retry = await sendVaultWrite(() =>
      options.api.putVaultMeta({
        putVaultMetaRequest: { meta: options.meta },
        ifMatch: remote.etag,
      }),
    );

    const data = retry.data as PutVaultMetaResponse;
    return { kind: 'updated', etag: data.etag, updatedAt: data.updatedAt };
  }
}

export type PutVaultBlobResult =
  | {
      kind: 'updated';
      etag: string;
      updatedAt: string;
    }
  | {
      kind: 'kept-remote';
      remote: ServerVaultBlob;
    };

export async function putServerVaultBlobEtagAware(options: {
  api: VaultApiLike;
  type: VaultBlobType;
  blob: EncryptedBlobV1;
  ifMatch?: string;
  onConflict?: VaultBlobConflictHandler;
}): Promise<PutVaultBlobResult> {
  const onConflict = options.onConflict ?? defaultBlobConflictHandler;

  try {
    const response = await sendVaultWrite(() =>
      options.api.putVaultBlob({
        type: options.type,
        putVaultBlobRequest: { type: options.type, blob: options.blob },
        ifMatch: options.ifMatch,
      }),
    );

    const data = response.data as PutVaultBlobResponse;
    return { kind: 'updated', etag: data.etag, updatedAt: data.updatedAt };
  } catch (error) {
    if (getHttpStatus(error) !== 409) throw error;

    const remote = await getServerVaultBlob(options.api, options.type);
    if (!remote) throw error;

    const decision = await onConflict({ local: options.blob, remote });
    if (decision === 'keep-remote') {
      return { kind: 'kept-remote', remote };
    }

    const retry = await sendVaultWrite(() =>
      options.api.putVaultBlob({
        type: options.type,
        putVaultBlobRequest: { type: options.type, blob: options.blob },
        ifMatch: remote.etag,
      }),
    );

    const data = retry.data as PutVaultBlobResponse;
    return { kind: 'updated', etag: data.etag, updatedAt: data.updatedAt };
  }
}

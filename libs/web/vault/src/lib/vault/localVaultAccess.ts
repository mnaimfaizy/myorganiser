/**
 * Every Local Vault operation, expressed against a single slot.
 *
 * This module is deliberately absent from the library's public surface. The
 * only supported way to reach it is `createVaultHandle`, which binds a slot to
 * one owner — see `vaultHandle.ts` and ADR 0047. The shim reaches it directly
 * for the one case that has no owner to bind, and the shim is temporary.
 */
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  deriveKeyFromPassphrase,
  importAesGcmKey,
  randomBytes,
  utf8ToBytes,
} from './crypto';
import { mintRecoveryKey, type MintedRecoveryKey } from './recoveryKeyMint';
import type {
  EncryptedBlob,
  LocalVaultReadResult,
  LocalVaultSlot,
  LocalVaultStatus,
  VaultRecordType,
  VaultStorageV1,
  VaultUnlockResult,
} from './localVaultStorage';

const PBKDF2_ITERATIONS = 310_000;

/** The secret a `VaultSecretMismatchError` says did not unwrap the Master Key. */
export type VaultMismatchedSecret = 'passphrase' | 'recovery-key' | 'passkey';

const doesNotUnlock = (secretName: string): string =>
  `The ${secretName} does not unlock this Vault`;

const VAULT_SECRET_MISMATCH_MESSAGE = {
  passphrase: doesNotUnlock('passphrase'),
  'recovery-key': doesNotUnlock('recovery key'),
  passkey: doesNotUnlock('passkey'),
} as const satisfies Record<VaultMismatchedSecret, string>;

/**
 * A wrapped Master Key would not unwrap. The secret is wrong — the Vault is
 * not corrupt and must never be offered as resettable.
 */
export class VaultSecretMismatchError extends Error {
  public readonly code = 'vault-secret-mismatch';
  public readonly secret: VaultMismatchedSecret;

  constructor(secret: VaultMismatchedSecret) {
    super(VAULT_SECRET_MISMATCH_MESSAGE[secret]);
    this.name = 'VaultSecretMismatchError';
    this.secret = secret;
    // Preserve prototype chain for instanceof checks across module boundaries.
    Object.setPrototypeOf(this, VaultSecretMismatchError.prototype);
  }
}

/**
 * A Vault Claim was attempted on a device that holds no Unclaimed Local Vault.
 * Distinct from a wrong secret: there is nothing here to prove ownership of.
 */
export class NoUnclaimedLocalVaultError extends Error {
  public readonly code = 'no-unclaimed-local-vault';

  constructor() {
    super('There is no Unclaimed Local Vault on this device');
    this.name = 'NoUnclaimedLocalVaultError';
    Object.setPrototypeOf(this, NoUnclaimedLocalVaultError.prototype);
  }
}

/**
 * A Vault Claim would have replaced a Local Vault this owner already holds.
 *
 * Refused rather than performed. Replacing a User's own Vault is an explicit,
 * acknowledged act (CONTEXT.md, "Vault Claim"), so a claim that asks the User
 * for nothing must never be the thing that carries it out.
 */
export class LocalVaultAlreadyOwnedError extends Error {
  public readonly code = 'local-vault-already-owned';

  constructor() {
    super('This User already holds a Local Vault on this device');
    this.name = 'LocalVaultAlreadyOwnedError';
    Object.setPrototypeOf(this, LocalVaultAlreadyOwnedError.prototype);
  }
}

/**
 * A Vault Claim that replaces an owned Vault was attempted with no owned
 * Vault to replace.
 *
 * Distinct from `NoUnclaimedLocalVaultError`: evidence for the Unclaimed
 * Local Vault may be perfectly good here, but there is nothing owned to
 * replace it with — that is an ordinary claim, and
 * `claimUnclaimedLocalVaultLocked` is where it belongs.
 */
export class NoOwnedLocalVaultToReplaceError extends Error {
  public readonly code = 'no-owned-local-vault-to-replace';

  constructor() {
    super('This owner holds no Local Vault to replace');
    this.name = 'NoOwnedLocalVaultToReplaceError';
    Object.setPrototypeOf(this, NoOwnedLocalVaultToReplaceError.prototype);
  }
}

/**
 * A Local Vault write found that its Vault Blob Type's Ciphertext had moved
 * since the write read it, and wrote nothing.
 *
 * Every encryption carries a fresh IV, so any write to the type, by any
 * writer in this tab or another, moves its Ciphertext. A write that went ahead
 * anyway would revert that writer's data
 * ([ADR 0143](../../../../../docs/adr/0143-a-local-vault-write-is-conditional-on-the-ciphertext-it-read-and-a-contended-save-merges.md)).
 *
 * `saveEncryptedData` throws it after one attempt. The record write funnel
 * (`vaultRecordWrite.ts`) merges and retries, and throws it only once three
 * attempts in total have all been contended. Either way the stored state is
 * whatever the other writer left there.
 */
export class VaultWriteContendedError extends Error {
  public readonly code = 'vault-write-contended';
  public readonly type: VaultRecordType;

  constructor(type: VaultRecordType) {
    super(
      `The saved "${type}" data changed while this save was in progress. Nothing was saved.`,
    );
    this.name = 'VaultWriteContendedError';
    this.type = type;
    Object.setPrototypeOf(this, VaultWriteContendedError.prototype);
  }
}

/**
 * Whether two reads of one Vault Blob Type's Ciphertext are the same bytes.
 * Absent on both sides is the same; absent on one side is not.
 */
export function sameStoredCiphertext(
  a: EncryptedBlob | null | undefined,
  b: EncryptedBlob | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return a.iv === b.iv && a.ciphertext === b.ciphertext;
}

/** An operation needing the Master Key was called before one was bound. */
export class VaultLockedError extends Error {
  public readonly code = 'vault-locked';

  constructor() {
    super('This Vault is locked');
    this.name = 'VaultLockedError';
    Object.setPrototypeOf(this, VaultLockedError.prototype);
  }
}

export type LocalVaultAccess = {
  /** Whether a Master Key is currently bound. */
  readonly isUnlocked: boolean;

  hasVault(): boolean;
  /** Whether this slot currently holds a claimed (owned), not Unclaimed, Local Vault. */
  hasOwnedVault(): boolean;
  /**
   * What this owner's slot resolves right now: their own Vault, an Unclaimed
   * Local Vault offered to them, an entry naming somebody else, or nothing.
   * Reading the status claims nothing.
   */
  vaultStatus(): LocalVaultStatus;
  /**
   * Whether this device holds an Unclaimed Local Vault at all — true even when
   * this owner already has a Vault of their own, which `vaultStatus` hides
   * because their own entry wins. This is what keeps a claim reachable after a
   * User has already created their own Vault.
   */
  hasUnclaimedLocalVault(): boolean;
  loadVault(): VaultStorageV1 | null;
  /**
   * The Unclaimed Local Vault this device holds, independent of what this
   * owner's slot resolves — `null` when there is none. Reading it is not
   * claiming it, the same as `hasUnclaimedLocalVault`; this is its sibling
   * for a caller that needs the Vault itself, not just whether one exists —
   * to offer it for export before a Vault Claim replaces what this owner
   * already holds (CONTEXT.md, "Claim Offer").
   */
  loadUnclaimedVault(): VaultStorageV1 | null;
  saveVault(vault: VaultStorageV1): void;
  /** Explicit Local Vault removal (ADR 0033). Locks this access afterward. */
  removeVault(): void;

  /**
   * Create this owner's Local Vault and mint its first Recovery Key.
   *
   * The key comes back branded because it is minted here exactly as a
   * rotation's is — `mintRecoveryKey` is the only place either comes from.
   * Typing it `string` would have made the Recovery Key a Vault has at
   * creation the one key that could not be handed to `rotateRecoveryKey`
   * without a cast, which says something false about where it came from.
   */
  initialize(options: {
    passphrase: string;
  }): Promise<{ recoveryKey: MintedRecoveryKey }>;
  unlockWithPassphrase(options: {
    passphrase: string;
  }): Promise<VaultUnlockResult>;
  /**
   * Vault Claim, on evidence established elsewhere: record the Unclaimed Local
   * Vault as this owner's, and leave it locked.
   *
   * It takes no secret because a secret is not proof. Key derivation uses the
   * Vault's own salt, so two people sharing a passphrase string each derive
   * the same Master Key and each unwrap the other's Vault — an unwrap
   * establishes knowledge of a string, never ownership of a Vault
   * ([ADR 0061](../../../../../docs/adr/0061-vault-claim-is-proven-by-evidence-not-by-unwrap.md)).
   * There is deliberately no sibling method that claims on a passphrase: the
   * one that used to be here is what made a shared passphrase enough to open
   * somebody else's Vault.
   *
   * Nothing is unlocked either. Ownership and readability are different
   * questions (CONTEXT.md, "Vault Claim"), so no Master Key is derived, none
   * is bound, and one already bound is left exactly as it was. The caller
   * establishes the evidence — see `vaultClaimEvidence.ts` — and this records
   * the ownership that evidence proved already held.
   *
   * Refuses with `LocalVaultAlreadyOwnedError` when this owner already holds a
   * Local Vault: evidence alone never replaces one.
   */
  claimUnclaimedLocalVaultLocked(): void;
  /**
   * Vault Claim by recovery key: record the Unclaimed Local Vault as this
   * owner's, and unlock it.
   *
   * The recovery-key counterpart to `claimUnclaimedLocalVaultLocked`. That one
   * takes no secret because the evidence was established elsewhere; this one
   * takes the evidence itself, because a recovery key *is* proof — it is minted
   * per Vault and cannot collide across Users, which is exactly what a
   * passphrase cannot promise (ADR 0061).
   *
   * It exists because unlocking must no longer be able to claim. This is the
   * only remaining path from a recovery key to an Unclaimed Local Vault, and it
   * reads that Vault explicitly rather than resolving it — `unlockWithRecoveryKey`
   * cannot reach one at all.
   *
   * Unlocked on success, unlike the locked claim, because the evidence *is* the
   * key: there is nothing further to ask the User for. Unwraps before writing
   * anything, so a wrong key throws `VaultSecretMismatchError('recovery-key')`
   * and leaves the Unclaimed Local Vault byte-identical (ADR 0033).
   *
   * Refuses with `LocalVaultAlreadyOwnedError` when this owner already holds a
   * Local Vault — evidence alone never replaces one, which is what
   * `replaceOwnedLocalVaultWithUnclaimedByRecoveryKey` is for. Refuses with
   * `NoUnclaimedLocalVaultError` when there is nothing here to claim.
   */
  claimUnclaimedLocalVaultByRecoveryKey(options: {
    recoveryKey: string;
  }): Promise<VaultUnlockResult>;
  /**
   * Vault Claim, replacing a Local Vault this owner already holds — the
   * explicit, acknowledged act `claimUnclaimedLocalVaultLocked` refuses to be
   * (CONTEXT.md, "Vault Claim").
   *
   * Performs no check of its own that the User meant it: the acknowledgement
   * is obtained by the caller before this is reached — see
   * `vaultClaimEvidence.ts`, the one place that decides whether a Vault Claim
   * happens. Overwrites this owner's entry with the Unclaimed Local Vault and
   * unbinds any Master Key that was bound, because that key unwraps a Vault
   * this slot no longer holds — leaving it bound would leave `isUnlocked` true
   * over the wrong Vault. The caller unlocks the replacement afterward in the
   * ordinary way, exactly as a fresh claim does.
   *
   * Refuses with `NoOwnedLocalVaultToReplaceError` when this owner holds no
   * Vault to replace — that is an ordinary claim, not a replacement.  Refuses
   * with `NoUnclaimedLocalVaultError` when there is nothing here to replace it
   * with. Neither refusal writes anything.
   */
  replaceOwnedLocalVaultWithUnclaimedLocked(): void;
  unlockWithRecoveryKey(options: {
    recoveryKey: string;
  }): Promise<VaultUnlockResult>;
  /**
   * Vault Claim by recovery key, replacing a Local Vault this owner already
   * holds, and unlocking the result.
   *
   * The recovery-key counterpart to
   * `replaceOwnedLocalVaultWithUnclaimedLocked`: same replacement, same
   * refusals, but authorized by a secret rather than an acknowledgement
   * obtained elsewhere, so it unwraps the Unclaimed Local Vault's Master Key
   * before writing anything. A wrong key throws `VaultSecretMismatchError`
   * and leaves both Vaults byte-identical — the same unwrap-then-write order
   * `unlockWithRecoveryKey` uses. Unlocked on success because the evidence
   * *is* the key: there is nothing further to ask the User for.
   */
  replaceOwnedLocalVaultWithUnclaimedByRecoveryKey(options: {
    recoveryKey: string;
  }): Promise<VaultUnlockResult>;
  /**
   * Change the passphrase of an unlocked Vault, authorized by the current one.
   *
   * The Master Key is already bound, so the current passphrase is not needed
   * to do the work. It is required because it is the only check on who is at
   * the keyboard: an unlocked session left unattended would otherwise be a way
   * to change the passphrase, and with Vault Meta Push that change reaches
   * every device the owner has.
   *
   * It also proves the caller knows the passphrase wrapping *this* device's
   * Master Key right now, which catches a device sitting on a stale wrapping
   * before it pushes its opinion of the Vault Meta to the server.
   *
   * Verification happens before anything is written, so a wrong current
   * passphrase leaves the Local Vault byte-identical and throws
   * `VaultSecretMismatchError` — the secret is wrong, the Vault is not damaged,
   * and it must never be offered as resettable.
   */
  changePassphrase(options: {
    currentPassphrase: string;
    newPassphrase: string;
  }): Promise<void>;
  /**
   * Set a passphrase on an unlocked Vault without asking for the current one.
   *
   * Named apart from `changePassphrase` rather than reached by omitting a
   * field, because the two differ in what authorizes them and only one of them
   * is available to a User who has forgotten their passphrase. An optional
   * `currentPassphrase` would make the check skippable by omission, which is
   * the shape ADR 0053 exists to stop.
   *
   * Its authorization is the recovery key the caller has already presented:
   * reaching an unlocked Vault through `unlockWithRecoveryKey` is the proof,
   * and there is nothing further to verify here.
   */
  resetPassphrase(options: { newPassphrase: string }): Promise<void>;
  /**
   * Retire this Vault's Recovery Key and start using `recoveryKey` instead,
   * from an unlocked session, authorized by the current passphrase.
   *
   * Authorized by the passphrase and never by the key being replaced: a User
   * rotating because the old key is lost cannot produce it, and an unattended
   * unlocked session must not be enough to mint a credential that opens the
   * Vault (CONTEXT.md, "Recovery Key Rotation"). The check is the same one
   * `changePassphrase` makes, for the same reason and against the same
   * wrapping, so a wrong current passphrase throws `VaultSecretMismatchError`
   * before anything is written and leaves the Local Vault byte-identical.
   *
   * The key is supplied rather than minted here, because the User has to have
   * recorded it before the old one stops working — see `recoveryKeyMint.ts`.
   * `MintedRecoveryKey` is what keeps that the only thing a caller can pass.
   *
   * The Master Key does not move. Only its recovery wrapping is replaced, so
   * every Vault Blob stays readable and no salt and no KDF parameter changes —
   * which is why another device reads this as a rotation rather than as a
   * different Vault.
   */
  rotateRecoveryKey(options: {
    currentPassphrase: string;
    recoveryKey: MintedRecoveryKey;
  }): Promise<void>;

  loadDecryptedData<T>(options: {
    type: VaultRecordType;
    defaultValue: T;
  }): Promise<T>;
  /**
   * `loadDecryptedData`, plus the Ciphertext that was decrypted — `null` when
   * none is stored, in which case `value` is `defaultValue`.
   *
   * The Ciphertext is read once, synchronously, and the value is decrypted from
   * exactly those bytes, so the pair always agrees. A writer passes it back to
   * `saveEncryptedData` as `expectedCiphertext` to write only if nobody else
   * has written the type since (ADR 0143).
   */
  loadDecryptedDataWithCiphertext<T>(options: {
    type: VaultRecordType;
    defaultValue: T;
  }): Promise<{ value: T; ciphertext: EncryptedBlob | null }>;
  /**
   * Decrypt Ciphertext this Local Vault does not hold — the server's copy of a
   * Vault Blob — under the Master Key currently bound.
   *
   * Success is the proof that both sides are the same Vault, which is the only
   * precondition a merge has (ADR 0054). It is established by trying it: Vault
   * Meta equality answers a different question, since changing a passphrase
   * rewraps the same Master Key and leaves every Vault Blob readable.
   *
   * Throws `VaultLockedError` when no Master Key is bound, and rethrows the
   * decryption failure otherwise. A caller must not read either as "keep the
   * local copy".
   */
  decryptCiphertext<T>(options: { blob: EncryptedBlob }): Promise<T>;
  /**
   * Encrypt `value` and write it as `type`'s Ciphertext, replacing that type
   * and nothing else (ADR 0143).
   *
   * Conditional. The write goes ahead only if `type`'s stored Ciphertext is
   * still `expectedCiphertext` (`null`: still absent) at the moment of writing.
   * Omit it and the Ciphertext stored when this call starts is expected. The
   * check and the write run on a Local Vault read synchronously after the last
   * await, so no other type written meanwhile is reverted.
   *
   * Throws `VaultWriteContendedError`, having written nothing, when the type's
   * Ciphertext moved.
   */
  saveEncryptedData(options: {
    type: VaultRecordType;
    value: unknown;
    expectedCiphertext?: EncryptedBlob | null;
  }): Promise<void>;
};

async function wrapMasterKeyWithKey(options: {
  wrappingKey: CryptoKey;
  masterKeyBytes: Uint8Array;
}): Promise<EncryptedBlob> {
  const iv = randomBytes(12);
  const ciphertext = await aesGcmEncrypt({
    key: options.wrappingKey,
    plaintext: options.masterKeyBytes,
    iv,
  });

  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) };
}

async function unwrapMasterKeyWithKey(options: {
  wrappingKey: CryptoKey;
  wrapped: EncryptedBlob;
}): Promise<Uint8Array> {
  const iv = base64ToBytes(options.wrapped.iv);
  const ciphertext = base64ToBytes(options.wrapped.ciphertext);
  return aesGcmDecrypt({ key: options.wrappingKey, iv, ciphertext });
}

async function encryptJsonWithMasterKey(options: {
  masterKey: CryptoKey;
  value: unknown;
}): Promise<EncryptedBlob> {
  const iv = randomBytes(12);
  const plaintext = utf8ToBytes(JSON.stringify(options.value));
  const ciphertext = await aesGcmEncrypt({
    key: options.masterKey,
    plaintext,
    iv,
  });
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) };
}

async function decryptJsonWithMasterKey<T>(options: {
  masterKey: CryptoKey;
  blob: EncryptedBlob;
}): Promise<T> {
  const iv = base64ToBytes(options.blob.iv);
  const ciphertext = base64ToBytes(options.blob.ciphertext);
  const plaintext = await aesGcmDecrypt({
    key: options.masterKey,
    iv,
    ciphertext,
  });
  return JSON.parse(bytesToUtf8(plaintext)) as T;
}

/**
 * The Vault a read yields, which is only ever this owner's own.
 *
 * `unclaimed` deliberately yields nothing. The status says the unsuffixed slot
 * is occupied; it does not say the Vault in it belongs to this owner, and only
 * Vault Claim Evidence can (ADR 0061). The read result no longer carries a
 * Vault for that status at all, so this is enforced by the type rather than by
 * remembering to check here.
 */
function vaultOf(read: LocalVaultReadResult): VaultStorageV1 | null {
  return read.status === 'owned' ? read.vault : null;
}

export function createLocalVaultAccess(options: {
  slot: LocalVaultSlot;
  masterKeyBytes?: Uint8Array | null;
}): LocalVaultAccess {
  const slot = options.slot;
  let boundMasterKeyBytes: Uint8Array | null = options.masterKeyBytes ?? null;

  const requireMasterKey = (): Uint8Array => {
    if (!boundMasterKeyBytes) throw new VaultLockedError();
    return boundMasterKeyBytes;
  };

  const requireVault = (): VaultStorageV1 => {
    const vault = vaultOf(slot.read());
    if (!vault) throw new Error('Vault is not initialized');
    return vault;
  };

  /**
   * A failed unwrap means the secret is wrong. It is never evidence that the
   * Vault is damaged, and it must never be reported as one.
   */
  const unwrapOrMismatch = async (options: {
    wrappingKey: CryptoKey;
    wrapped: EncryptedBlob;
    secret: 'passphrase' | 'recovery-key';
  }): Promise<Uint8Array> => {
    try {
      return await unwrapMasterKeyWithKey({
        wrappingKey: options.wrappingKey,
        wrapped: options.wrapped,
      });
    } catch {
      throw new VaultSecretMismatchError(options.secret);
    }
  };

  /**
   * Unwrap, then bind the Master Key.
   *
   * It no longer claims, and there is no branch left here that could. Unlocking
   * reaches a Vault only through `requireVault`, which yields this owner's own
   * Vault or nothing — so by the time this runs the Vault is already theirs and
   * there is nothing to claim. Claiming an Unclaimed Local Vault is a separate,
   * evidence-checked act (ADR 0061); an unwrap succeeding is not evidence,
   * because two people sharing a passphrase string both get one.
   */
  const unwrapAndBind = async (options: {
    wrappingKey: CryptoKey;
    wrapped: EncryptedBlob;
    secret: 'passphrase' | 'recovery-key';
  }): Promise<VaultUnlockResult> => {
    const masterKeyBytes = await unwrapOrMismatch({
      wrappingKey: options.wrappingKey,
      wrapped: options.wrapped,
      secret: options.secret,
    });

    boundMasterKeyBytes = masterKeyBytes;
    return { masterKeyBytes };
  };

  /**
   * Rewrap the Master Key under a new passphrase and write the result.
   *
   * The salt is deliberately reused rather than minted. A moved salt is how
   * another device tells two separate Vaults apart from one Vault whose
   * passphrase rotated, so minting one here would make every rotation look
   * like a stranger's Vault (#578).
   */
  const rewrapWithPassphrase = async (options: {
    vault: VaultStorageV1;
    masterKeyBytes: Uint8Array;
    newPassphrase: string;
  }): Promise<void> => {
    const derivedKey = await deriveKeyFromPassphrase({
      passphrase: options.newPassphrase,
      salt: base64ToBytes(options.vault.kdf.salt),
      iterations: options.vault.kdf.iterations,
    });

    options.vault.masterKeyWrappedWithPassphrase = await wrapMasterKeyWithKey({
      wrappingKey: derivedKey,
      masterKeyBytes: options.masterKeyBytes,
    });

    slot.write(options.vault);
  };

  return {
    get isUnlocked() {
      return boundMasterKeyBytes !== null;
    },

    hasVault() {
      return vaultOf(slot.read()) !== null;
    },

    hasOwnedVault() {
      return slot.read().status === 'owned';
    },

    vaultStatus() {
      return slot.read().status;
    },

    hasUnclaimedLocalVault() {
      return slot.readUnclaimed() !== null;
    },

    loadVault() {
      return vaultOf(slot.read());
    },

    loadUnclaimedVault() {
      return slot.readUnclaimed();
    },

    saveVault(vault) {
      slot.write(vault);
    },

    removeVault() {
      slot.remove();
      boundMasterKeyBytes = null;
    },

    async initialize({ passphrase }) {
      const salt = randomBytes(16);
      const derivedKey = await deriveKeyFromPassphrase({
        passphrase,
        salt,
        iterations: PBKDF2_ITERATIONS,
      });

      const masterKeyBytes = randomBytes(32);

      const recoveryKey = mintRecoveryKey();
      const recoveryWrappingKey = await importAesGcmKey(
        base64ToBytes(recoveryKey),
      );

      const vault: VaultStorageV1 = {
        version: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: PBKDF2_ITERATIONS,
          salt: bytesToBase64(salt),
        },
        masterKeyWrappedWithPassphrase: await wrapMasterKeyWithKey({
          wrappingKey: derivedKey,
          masterKeyBytes,
        }),
        masterKeyWrappedWithRecoveryKey: await wrapMasterKeyWithKey({
          wrappingKey: recoveryWrappingKey,
          masterKeyBytes,
        }),
        data: {},
      };

      slot.createNew(vault);

      return { recoveryKey };
    },

    /**
     * Unlock this owner's own Local Vault.
     *
     * There is deliberately no path from here to an Unclaimed Local Vault, not
     * even with the right passphrase for it: `requireVault` yields this owner's
     * Vault or throws, so a User who holds none is told the Vault is not
     * initialized rather than being offered somebody else's to guess at. That
     * refusal is the fix for the defect this whole change exists for — the
     * harm was never in the ownership record, it was in the unlock.
     */
    async unlockWithPassphrase({ passphrase }) {
      const vault = requireVault();

      const derivedKey = await deriveKeyFromPassphrase({
        passphrase,
        salt: base64ToBytes(vault.kdf.salt),
        iterations: vault.kdf.iterations,
      });

      return unwrapAndBind({
        wrappingKey: derivedKey,
        wrapped: vault.masterKeyWrappedWithPassphrase,
        secret: 'passphrase',
      });
    },

    claimUnclaimedLocalVaultLocked() {
      // Read before anything is written, and refused before the Unclaimed
      // Local Vault is even looked at: there is no evidence a caller could
      // hold that makes overwriting this User's own Vault the right move here.
      if (slot.read().status === 'owned') {
        throw new LocalVaultAlreadyOwnedError();
      }

      const vault = slot.readUnclaimed();
      if (!vault) throw new NoUnclaimedLocalVaultError();

      slot.claim(vault);
      // `boundMasterKeyBytes` is deliberately untouched. The Vault is claimed
      // and still locked, which is the whole point of this method existing.
    },

    async claimUnclaimedLocalVaultByRecoveryKey({ recoveryKey }) {
      // Refused before the Unclaimed Local Vault is even looked at, the same
      // guard and the same reason as `claimUnclaimedLocalVaultLocked`: holding
      // proof that a second Vault is also yours is not a reason to overwrite
      // the one you are using.
      if (slot.read().status === 'owned') {
        throw new LocalVaultAlreadyOwnedError();
      }

      const vault = slot.readUnclaimed();
      if (!vault) throw new NoUnclaimedLocalVaultError();

      let recoveryWrappingKey: CryptoKey;
      try {
        recoveryWrappingKey = await importAesGcmKey(base64ToBytes(recoveryKey));
      } catch {
        // Not importable is still a wrong secret, not a damaged Vault.
        throw new VaultSecretMismatchError('recovery-key');
      }

      // Unwrap before writing anything, so a key that proves nothing leaves the
      // Unclaimed Local Vault exactly where it was for whoever it does belong
      // to (ADR 0033).
      const masterKeyBytes = await unwrapOrMismatch({
        wrappingKey: recoveryWrappingKey,
        wrapped: vault.masterKeyWrappedWithRecoveryKey,
        secret: 'recovery-key',
      });

      slot.claim(vault);
      boundMasterKeyBytes = masterKeyBytes;
      return { masterKeyBytes };
    },

    replaceOwnedLocalVaultWithUnclaimedLocked() {
      // Read before anything is written. The opposite guard to
      // `claimUnclaimedLocalVaultLocked`'s: that method exists to refuse this
      // exact overwrite, so this one is reached only once a caller has
      // obtained the acknowledgement that makes the overwrite deliberate.
      if (slot.read().status !== 'owned') {
        throw new NoOwnedLocalVaultToReplaceError();
      }

      const vault = slot.readUnclaimed();
      if (!vault) throw new NoUnclaimedLocalVaultError();

      slot.claim(vault);
      // The Master Key just bound, if any, unwraps a Vault this slot no
      // longer holds — leaving it bound would leave `isUnlocked` true over
      // the wrong Vault.
      boundMasterKeyBytes = null;
    },

    async unlockWithRecoveryKey({ recoveryKey }) {
      const vault = requireVault();

      let recoveryWrappingKey: CryptoKey;
      try {
        recoveryWrappingKey = await importAesGcmKey(base64ToBytes(recoveryKey));
      } catch {
        // A recovery key that is not even importable is still a wrong secret,
        // not a damaged Vault.
        throw new VaultSecretMismatchError('recovery-key');
      }

      return unwrapAndBind({
        wrappingKey: recoveryWrappingKey,
        wrapped: vault.masterKeyWrappedWithRecoveryKey,
        secret: 'recovery-key',
      });
    },

    async replaceOwnedLocalVaultWithUnclaimedByRecoveryKey({ recoveryKey }) {
      if (slot.read().status !== 'owned') {
        throw new NoOwnedLocalVaultToReplaceError();
      }

      const vault = slot.readUnclaimed();
      if (!vault) throw new NoUnclaimedLocalVaultError();

      let recoveryWrappingKey: CryptoKey;
      try {
        recoveryWrappingKey = await importAesGcmKey(base64ToBytes(recoveryKey));
      } catch {
        throw new VaultSecretMismatchError('recovery-key');
      }

      // Unwrap before writing anything, so a wrong key leaves both the
      // Unclaimed Local Vault and this owner's current entry byte-identical.
      const masterKeyBytes = await unwrapOrMismatch({
        wrappingKey: recoveryWrappingKey,
        wrapped: vault.masterKeyWrappedWithRecoveryKey,
        secret: 'recovery-key',
      });

      slot.claim(vault);
      boundMasterKeyBytes = masterKeyBytes;
      return { masterKeyBytes };
    },

    async changePassphrase({ currentPassphrase, newPassphrase }) {
      const masterKeyBytes = requireMasterKey();
      const vault = requireVault();

      // Authorization first, and nothing written until it passes. Derived from
      // the Vault's own salt against the wrapping it currently holds, so this
      // answers "does this unlock this device's Vault right now" rather than
      // "does this match something remembered from an earlier unlock".
      const currentKey = await deriveKeyFromPassphrase({
        passphrase: currentPassphrase,
        salt: base64ToBytes(vault.kdf.salt),
        iterations: vault.kdf.iterations,
      });
      await unwrapOrMismatch({
        wrappingKey: currentKey,
        wrapped: vault.masterKeyWrappedWithPassphrase,
        secret: 'passphrase',
      });

      await rewrapWithPassphrase({ vault, masterKeyBytes, newPassphrase });
    },

    async resetPassphrase({ newPassphrase }) {
      const masterKeyBytes = requireMasterKey();
      const vault = requireVault();

      await rewrapWithPassphrase({ vault, masterKeyBytes, newPassphrase });
    },

    async rotateRecoveryKey({ currentPassphrase, recoveryKey }) {
      const masterKeyBytes = requireMasterKey();
      const vault = requireVault();

      // Authorization first, and nothing written until it passes — the same
      // check `changePassphrase` makes, against the same wrapping. The Master
      // Key is already bound, so this is not needed to do the work; it is the
      // only thing standing between an unattended unlocked session and a
      // freshly minted credential that opens this Vault everywhere.
      const currentKey = await deriveKeyFromPassphrase({
        passphrase: currentPassphrase,
        salt: base64ToBytes(vault.kdf.salt),
        iterations: vault.kdf.iterations,
      });
      await unwrapOrMismatch({
        wrappingKey: currentKey,
        wrapped: vault.masterKeyWrappedWithPassphrase,
        secret: 'passphrase',
      });

      // Not wrapped in the `VaultSecretMismatchError` translation the unlock
      // paths use, and `initialize` does not wrap its import either — the four
      // sites that do translate are the four taking a *User-supplied* key.
      // There is no secret being checked here: the key is one this library
      // minted, so a key that will not import is a caller who cast past
      // `MintedRecoveryKey`. That surfaces as WebCrypto's own error, which is
      // the right report for a programming error and the wrong one for a
      // User's mistake.
      const recoveryWrappingKey = await importAesGcmKey(
        base64ToBytes(recoveryKey),
      );

      // The Master Key does not move; only the wrapping that opens it does.
      // The salt and the KDF parameters are untouched because the Recovery Key
      // derives nothing — which is what keeps another device reading this as a
      // rotation rather than as a different Vault.
      vault.masterKeyWrappedWithRecoveryKey = await wrapMasterKeyWithKey({
        wrappingKey: recoveryWrappingKey,
        masterKeyBytes,
      });

      slot.write(vault);
    },

    async loadDecryptedData<T>({
      type,
      defaultValue,
    }: {
      type: VaultRecordType;
      defaultValue: T;
    }): Promise<T> {
      const masterKeyBytes = requireMasterKey();

      const vault = vaultOf(slot.read());
      if (!vault) return defaultValue;

      const blob = vault.data[type];
      if (!blob) return defaultValue;

      const masterKey = await importAesGcmKey(masterKeyBytes);
      return decryptJsonWithMasterKey<T>({ masterKey, blob });
    },

    async loadDecryptedDataWithCiphertext<T>({
      type,
      defaultValue,
    }: {
      type: VaultRecordType;
      defaultValue: T;
    }): Promise<{ value: T; ciphertext: EncryptedBlob | null }> {
      const masterKeyBytes = requireMasterKey();

      const blob = vaultOf(slot.read())?.data[type] ?? null;
      if (!blob) return { value: defaultValue, ciphertext: null };

      const masterKey = await importAesGcmKey(masterKeyBytes);
      return {
        value: await decryptJsonWithMasterKey<T>({ masterKey, blob }),
        ciphertext: blob,
      };
    },

    async decryptCiphertext<T>({ blob }: { blob: EncryptedBlob }): Promise<T> {
      const masterKeyBytes = requireMasterKey();
      const masterKey = await importAesGcmKey(masterKeyBytes);
      return decryptJsonWithMasterKey<T>({ masterKey, blob });
    },

    async saveEncryptedData({ type, value, expectedCiphertext }) {
      const masterKeyBytes = requireMasterKey();
      // What this write expects to replace, fixed before the first await.
      const expected =
        expectedCiphertext !== undefined
          ? expectedCiphertext
          : (requireVault().data[type] ?? null);

      const masterKey = await importAesGcmKey(masterKeyBytes);
      const blob = await encryptJsonWithMasterKey({ masterKey, value });

      // Read, check and write with no await between them. The Local Vault
      // read before the awaits is never written back: any type another writer
      // saved meanwhile would be reverted with it (ADR 0143, decision 1).
      const vault = requireVault();
      if (!sameStoredCiphertext(vault.data[type], expected)) {
        throw new VaultWriteContendedError(type);
      }
      vault.data[type] = blob;
      slot.write(vault);
    },
  };
}

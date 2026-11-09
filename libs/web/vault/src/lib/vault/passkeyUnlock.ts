/**
 * Passkey Unlock policy (ADR 0136; CONTEXT.md, "Passkey Unlock").
 *
 * The rules — when to offer, how to enrol, how to unlock, when to fall back —
 * live here as plain functions over a small WebAuthn Platform Adapter
 * (`PasskeyPlatform`), the way ADR 0108 tests Biometric Unlock against a fake
 * keystore. The browser implementation is `createBrowserPasskeyPlatform`;
 * tests pass a fake authenticator.
 *
 * What these functions never do:
 * - store the Master Key unwrapped, or send anything to the server;
 * - delete the wrapping record because a ceremony was cancelled or failed —
 *   a failure only falls back to the passphrase (ADR 0136, decision 6);
 * - make a request without `userVerification: 'required'` (decision 4).
 */

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  bytesToBase64,
  importAesGcmKey,
  randomBytes,
} from './crypto';
import {
  readPasskeyUnlockOffered,
  removePasskeyUnlockRecord,
  readPasskeyUnlockRecord,
  writePasskeyUnlockOffered,
  writePasskeyUnlockRecord,
} from './passkeyUnlockStorage';

/** Every create and get Passkey Unlock makes requires user verification. */
export const PASSKEY_USER_VERIFICATION = 'required';

/** The PRF output length Passkey Unlock accepts: one AES-256 key. */
export const PASSKEY_PRF_OUTPUT_LENGTH = 32;

const PRF_SALT_LENGTH = 32;
const CHALLENGE_LENGTH = 32;
const USER_HANDLE_LENGTH = 32;
const AES_GCM_IV_LENGTH = 12;

/** What Passkey Unlock asks the platform to create. */
export type PasskeyCreationRequest = {
  /** Random. Nothing verifies it: the passkey proves nothing to a server here. */
  challenge: Uint8Array;
  /**
   * Random per enrolment, never the owner id. A passkey provider replaces a
   * credential that shares a user handle, so a fixed handle would let one
   * device's enrolment silently break another device's.
   */
  userId: Uint8Array;
  userName: string;
  userDisplayName: string;
  /** Evaluated at creation so the PRF output can be read straight away. */
  prfSalt: Uint8Array;
  userVerification: typeof PASSKEY_USER_VERIFICATION;
};

/**
 * What the platform reports from creating a credential. `prfEnabled` false
 * means the passkey cannot produce a PRF output. `prfOutput` is null when the
 * passkey supports PRF but did not evaluate it at creation; Passkey Unlock
 * then asks for one assertion to read it.
 */
export type PasskeyCreationResult = {
  credentialId: Uint8Array;
  prfEnabled: boolean;
  prfOutput: Uint8Array | null;
};

/** What Passkey Unlock asks the platform to assert. */
export type PasskeyAssertionRequest = {
  challenge: Uint8Array;
  /** The one credential this device enrolled. */
  credentialId: Uint8Array;
  prfSalt: Uint8Array;
  userVerification: typeof PASSKEY_USER_VERIFICATION;
};

export type PasskeyAssertionResult = {
  prfOutput: Uint8Array | null;
};

/**
 * The WebAuthn Platform Adapter. `createCredential` and `getAssertion` throw
 * when the User cancels or the ceremony fails — the browser reports both the
 * same way, so Passkey Unlock treats every throw as a fall-back.
 */
export interface PasskeyPlatform {
  /** Whether this browser can create a user-verifying passkey at all. */
  canCreatePasskeys(): Promise<boolean>;
  createCredential(
    request: PasskeyCreationRequest,
  ): Promise<PasskeyCreationResult>;
  getAssertion(
    request: PasskeyAssertionRequest,
  ): Promise<PasskeyAssertionResult>;
  /**
   * Best effort: tell the passkey provider a just-created credential will
   * never be used, so it can drop it. Must not throw.
   */
  abandonCredential(credentialId: Uint8Array): Promise<void>;
}

/** How an enrolment ended. Only `enrolled` writes anything. */
export type PasskeyEnrolmentOutcome = 'enrolled' | 'unsupported' | 'failed';

/** How a passkey unlock ended. Only `unlocked` carries the Master Key. */
export type PasskeyUnlockOutcome =
  | { outcome: 'unlocked'; masterKeyBytes: Uint8Array }
  | { outcome: 'not-enrolled' }
  | { outcome: 'failed' };

function hasUsablePrfOutput(output: Uint8Array | null): output is Uint8Array {
  return output !== null && output.length === PASSKEY_PRF_OUTPUT_LENGTH;
}

/** Whether `owner` holds a valid passkey wrapping record on this device. */
export function isPasskeyUnlockEnrolled(owner: string): boolean {
  return readPasskeyUnlockRecord(owner) !== undefined;
}

/**
 * Turn Passkey Unlock off for `owner` on this device: delete the wrapping
 * record. The offer record stays, so turning it off never re-triggers the
 * one-time offer. Returns false when storage refused the removal.
 */
export function disablePasskeyUnlock(owner: string): boolean {
  try {
    removePasskeyUnlockRecord(owner);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the one-time offer may be shown to `owner` on this device: the
 * browser can create passkeys, and this owner has neither a wrapping record
 * nor an answered offer here. Which unlock it follows is the caller's
 * question — only a passphrase unlock is followed by the offer.
 */
export async function canOfferPasskeyUnlock(options: {
  owner: string;
  platform: PasskeyPlatform;
}): Promise<boolean> {
  if (isPasskeyUnlockEnrolled(options.owner)) return false;
  if (readPasskeyUnlockOffered(options.owner)) return false;
  try {
    return await options.platform.canCreatePasskeys();
  } catch {
    return false;
  }
}

/**
 * Record that `owner` answered the offer on this device. A storage failure is
 * swallowed: it costs the offer being shown again, never an unlock.
 */
export function recordPasskeyUnlockOffered(owner: string): void {
  try {
    writePasskeyUnlockOffered(owner);
  } catch {
    // Fails toward offering again.
  }
}

async function readPrfOutputAfterCreation(options: {
  platform: PasskeyPlatform;
  created: PasskeyCreationResult;
  prfSalt: Uint8Array;
}): Promise<Uint8Array | null> {
  if (!options.created.prfEnabled) return null;
  if (options.created.prfOutput !== null) return options.created.prfOutput;
  const asserted = await options.platform.getAssertion({
    challenge: randomBytes(CHALLENGE_LENGTH),
    credentialId: options.created.credentialId,
    prfSalt: options.prfSalt,
    userVerification: PASSKEY_USER_VERIFICATION,
  });
  return asserted.prfOutput;
}

/**
 * Enrol Passkey Unlock for `owner` on this device with the unlocked Master
 * Key. The caller must already hold a passphrase-authorized Master Key.
 *
 * - `unsupported`: the new passkey produced no usable PRF output. The
 *   credential is abandoned and nothing is stored.
 * - `failed`: the User cancelled, the ceremony failed, or storage refused the
 *   write. Nothing is stored.
 */
export async function enrolPasskeyUnlock(options: {
  owner: string;
  masterKeyBytes: Uint8Array;
  userName: string;
  platform: PasskeyPlatform;
}): Promise<PasskeyEnrolmentOutcome> {
  const prfSalt = randomBytes(PRF_SALT_LENGTH);

  let created: PasskeyCreationResult;
  try {
    created = await options.platform.createCredential({
      challenge: randomBytes(CHALLENGE_LENGTH),
      userId: randomBytes(USER_HANDLE_LENGTH),
      userName: options.userName,
      userDisplayName: options.userName,
      prfSalt,
      userVerification: PASSKEY_USER_VERIFICATION,
    });
  } catch {
    return 'failed';
  }

  const abandon = async (): Promise<void> => {
    try {
      await options.platform.abandonCredential(created.credentialId);
    } catch {
      // Best effort only.
    }
  };

  let prfOutput: Uint8Array | null;
  try {
    prfOutput = await readPrfOutputAfterCreation({
      platform: options.platform,
      created,
      prfSalt,
    });
  } catch {
    await abandon();
    return 'failed';
  }

  if (!hasUsablePrfOutput(prfOutput)) {
    await abandon();
    return 'unsupported';
  }

  try {
    const wrappingKey = await importAesGcmKey(prfOutput);
    const iv = randomBytes(AES_GCM_IV_LENGTH);
    const ciphertext = await aesGcmEncrypt({
      key: wrappingKey,
      plaintext: options.masterKeyBytes,
      iv,
    });
    writePasskeyUnlockRecord({
      owner: options.owner,
      credentialId: bytesToBase64(created.credentialId),
      prfSalt: bytesToBase64(prfSalt),
      wrappedMasterKey: {
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(ciphertext),
      },
    });
  } catch {
    await abandon();
    return 'failed';
  }

  return 'enrolled';
}

/**
 * Recover `owner`'s Master Key with the passkey enrolled on this device.
 *
 * `failed` covers a cancel, a failed ceremony, a missing PRF output and a
 * wrapping that does not decrypt under it. None of them deletes the record:
 * the caller falls back to the passphrase. Whether the recovered key still
 * opens the server's Ciphertext is a separate check.
 */
export async function unlockWithPasskey(options: {
  owner: string;
  platform: PasskeyPlatform;
}): Promise<PasskeyUnlockOutcome> {
  const record = readPasskeyUnlockRecord(options.owner);
  if (!record) return { outcome: 'not-enrolled' };

  try {
    const prfSalt = base64ToBytes(record.prfSalt);
    const asserted = await options.platform.getAssertion({
      challenge: randomBytes(CHALLENGE_LENGTH),
      credentialId: base64ToBytes(record.credentialId),
      prfSalt,
      userVerification: PASSKEY_USER_VERIFICATION,
    });
    if (!hasUsablePrfOutput(asserted.prfOutput)) return { outcome: 'failed' };

    const wrappingKey = await importAesGcmKey(asserted.prfOutput);
    const masterKeyBytes = await aesGcmDecrypt({
      key: wrappingKey,
      ciphertext: base64ToBytes(record.wrappedMasterKey.ciphertext),
      iv: base64ToBytes(record.wrappedMasterKey.iv),
    });
    return { outcome: 'unlocked', masterKeyBytes };
  } catch {
    return { outcome: 'failed' };
  }
}

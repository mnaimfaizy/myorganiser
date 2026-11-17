/**
 * The browser's WebAuthn Platform Adapter for Passkey Unlock (ADR 0136).
 *
 * A thin translation from `PasskeyPlatform` to `navigator.credentials`. Every
 * rule lives in `passkeyUnlock.ts`; this file only shapes requests and reads
 * the `prf` extension result. Jest covers that translation against a stubbed
 * `navigator.credentials`; real WebAuthn runs only on real devices and under
 * the Playwright virtual authenticator.
 *
 * The relying party id is left to the browser's default — the page's own
 * domain — on create and get alike, so the two always agree.
 */

import { bytesToBase64 } from './crypto';
import {
  PasskeyCredentialGoneError,
  type PasskeyAssertionRequest,
  type PasskeyAssertionResult,
  type PasskeyCreationRequest,
  type PasskeyCreationResult,
  type PasskeyPlatform,
} from './passkeyUnlock';

const RELYING_PARTY_NAME = 'MyOrganiser';
const CEREMONY_TIMEOUT_MS = 120_000;

/**
 * The `prf` extension's client output, which not every lib.dom version types.
 * `first` is `unknown` because a passkey provider extension may answer in
 * place of the browser and break the spec's BufferSource shape.
 */
type PrfExtensionOutput = {
  prf?: {
    enabled?: boolean;
    results?: { first?: unknown };
  };
};

type PublicKeyCredentialStatics = {
  isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
  signalUnknownCredential?: (options: {
    rpId: string;
    credentialId: string;
  }) => Promise<void>;
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function isByte(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255
  );
}

/**
 * A copy of a PRF result's bytes, or null when it holds none.
 *
 * The spec returns a BufferSource (an `ArrayBuffer` or a view over one). The
 * 1Password browser extension returns a plain array of byte values instead
 * (its issue FS-5593), so an array whose every element is a byte is accepted
 * too. Anything else is no PRF output — never a throw, so a malformed result
 * after a created passkey ends as `unsupported` and the passkey is abandoned.
 * Length is not checked here: `passkeyUnlock.ts` owns that rule.
 */
export function prfOutputBytes(value: unknown): Uint8Array | null {
  try {
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(
        value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength,
        ),
      );
    }
  } catch {
    // A detached buffer holds no bytes to read.
    return null;
  }
  if (Array.isArray(value) && value.length > 0 && isByteArray(value)) {
    return Uint8Array.from(value);
  }
  return null;
}

/** Every index holds a byte; unlike `every`, a hole fails. */
function isByteArray(values: readonly unknown[]): values is number[] {
  for (let index = 0; index < values.length; index += 1) {
    if (!isByte(values[index])) return false;
  }
  return true;
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function publicKeyCredentialStatics(): PublicKeyCredentialStatics | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as { PublicKeyCredential?: unknown })
    .PublicKeyCredential;
  if (typeof ctor !== 'function') return null;
  return ctor as unknown as PublicKeyCredentialStatics;
}

function credentialsContainer(): CredentialsContainer {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn is unavailable in this browser');
  }
  return navigator.credentials;
}

/**
 * The credential's `prf` output, or undefined when it reports none. A
 * provider that throws here reports no PRF output rather than failing the
 * ceremony, so a just-created passkey is still abandoned.
 */
function prfOutputOf(
  credential: PublicKeyCredential,
): PrfExtensionOutput['prf'] {
  try {
    const results =
      credential.getClientExtensionResults() as PrfExtensionOutput;
    return results?.prf;
  } catch {
    return undefined;
  }
}

function asPublicKeyCredential(
  credential: Credential | null,
): PublicKeyCredential {
  if (credential === null || credential.type !== 'public-key') {
    throw new Error('The browser returned no passkey');
  }
  return credential as PublicKeyCredential;
}

async function canCreatePasskeys(): Promise<boolean> {
  const statics = publicKeyCredentialStatics();
  if (!statics) return false;
  if (typeof navigator === 'undefined' || !navigator.credentials) return false;

  if (statics.getClientCapabilities) {
    try {
      const capabilities = await statics.getClientCapabilities();
      // Only a definite "no" rules PRF out: support is decided after creation.
      if (capabilities['extension:prf'] === false) return false;
    } catch {
      // Fall through to the platform check.
    }
  }

  if (!statics.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  return statics.isUserVerifyingPlatformAuthenticatorAvailable();
}

async function createCredential(
  request: PasskeyCreationRequest,
): Promise<PasskeyCreationResult> {
  const credential = asPublicKeyCredential(
    await credentialsContainer().create({
      publicKey: {
        rp: { name: RELYING_PARTY_NAME },
        user: {
          id: toArrayBuffer(request.userId),
          name: request.userName,
          displayName: request.userDisplayName,
        },
        challenge: toArrayBuffer(request.challenge),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: request.userVerification,
        },
        attestation: 'none',
        timeout: CEREMONY_TIMEOUT_MS,
        extensions: {
          prf: { eval: { first: toArrayBuffer(request.prfSalt) } },
        } as AuthenticationExtensionsClientInputs,
      },
    }),
  );

  const prf = prfOutputOf(credential);
  const prfOutput = prfOutputBytes(prf?.results?.first);
  return {
    credentialId: new Uint8Array(credential.rawId.slice(0)),
    prfEnabled: prf?.enabled === true || prfOutput !== null,
    prfOutput,
  };
}

/**
 * WebAuthn deliberately reports a cancel and an unknown credential alike
 * (`NotAllowedError`), so only a browser that names the unknown credential —
 * `NotFoundError` — ends Passkey Unlock here. Everything else stays a plain
 * failure that deletes nothing.
 */
function isCredentialGone(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'NotFoundError'
  );
}

async function getAssertion(
  request: PasskeyAssertionRequest,
): Promise<PasskeyAssertionResult> {
  try {
    return await getAssertionUnchecked(request);
  } catch (error) {
    if (isCredentialGone(error)) throw new PasskeyCredentialGoneError();
    throw error;
  }
}

async function getAssertionUnchecked(
  request: PasskeyAssertionRequest,
): Promise<PasskeyAssertionResult> {
  const credential = asPublicKeyCredential(
    await credentialsContainer().get({
      publicKey: {
        challenge: toArrayBuffer(request.challenge),
        allowCredentials: [
          { type: 'public-key', id: toArrayBuffer(request.credentialId) },
        ],
        userVerification: request.userVerification,
        timeout: CEREMONY_TIMEOUT_MS,
        extensions: {
          prf: { eval: { first: toArrayBuffer(request.prfSalt) } },
        } as AuthenticationExtensionsClientInputs,
      },
    }),
  );
  return {
    prfOutput: prfOutputBytes(prfOutputOf(credential)?.results?.first),
  };
}

async function abandonCredential(credentialId: Uint8Array): Promise<void> {
  const statics = publicKeyCredentialStatics();
  if (!statics?.signalUnknownCredential) return;
  try {
    await statics.signalUnknownCredential({
      rpId: window.location.hostname,
      credentialId: toBase64Url(credentialId),
    });
  } catch {
    // Best effort: a provider that keeps the credential costs a stray entry
    // in the User's passkey list, never an unlock.
  }
}

/** The `PasskeyPlatform` over this browser's `navigator.credentials`. */
export function createBrowserPasskeyPlatform(): PasskeyPlatform {
  return {
    canCreatePasskeys,
    createCredential,
    getAssertion,
    abandonCredential,
  };
}

/**
 * The browser's WebAuthn Platform Adapter for Passkey Unlock (ADR 0136).
 *
 * A thin translation from `PasskeyPlatform` to `navigator.credentials`. Every
 * rule lives in `passkeyUnlock.ts`; this file only shapes requests and reads
 * the `prf` extension result. It is exercised on real devices and by the
 * Playwright virtual authenticator, not by Jest.
 *
 * The relying party id is left to the browser's default — the page's own
 * domain — on create and get alike, so the two always agree.
 */

import { bytesToBase64 } from './crypto';
import type {
  PasskeyAssertionRequest,
  PasskeyAssertionResult,
  PasskeyCreationRequest,
  PasskeyCreationResult,
  PasskeyPlatform,
} from './passkeyUnlock';

const RELYING_PARTY_NAME = 'MyOrganiser';
const CEREMONY_TIMEOUT_MS = 120_000;

/** The `prf` extension's client output, which not every lib.dom version types. */
type PrfExtensionOutput = {
  prf?: {
    enabled?: boolean;
    results?: { first?: ArrayBuffer | ArrayBufferView };
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

function toBytes(
  value: ArrayBuffer | ArrayBufferView | undefined,
): Uint8Array | null {
  if (value === undefined) return null;
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return new Uint8Array(
    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
  );
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

function prfOutputOf(
  credential: PublicKeyCredential,
): PrfExtensionOutput['prf'] {
  const results = credential.getClientExtensionResults() as PrfExtensionOutput;
  return results.prf;
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
  const prfOutput = toBytes(prf?.results?.first);
  return {
    credentialId: new Uint8Array(credential.rawId.slice(0)),
    prfEnabled: prf?.enabled === true || prfOutput !== null,
    prfOutput,
  };
}

async function getAssertion(
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
  return { prfOutput: toBytes(prfOutputOf(credential)?.results?.first) };
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

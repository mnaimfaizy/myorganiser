/**
 * Tests for the browser Platform Adapter (ADR 0136).
 *
 * `prfOutputBytes` reads a PRF result as bytes: the spec's BufferSource, or a
 * plain array of byte values as the 1Password extension returns it. Anything
 * else — a detached buffer, a malformed array, a throwing extension read — is
 * null, never a throw. `createCredential` and `getAssertion` read the PRF
 * output through it, and create must still request user verification and the
 * PRF salt. Assertion failures keep one translation: WebAuthn's
 * `NotFoundError` becomes `PasskeyCredentialGoneError`, and every other
 * rejection passes through as a plain failure.
 *
 * The acceptance block runs the real enrolment and unlock over this adapter.
 * Only `navigator.credentials` and `PublicKeyCredential.signalUnknownCredential`
 * are stubbed; no real WebAuthn runs.
 */

import {
  createBrowserPasskeyPlatform,
  prfOutputBytes,
} from './passkeyPlatform';
import {
  enrolPasskeyUnlock,
  isPasskeyUnlockEnrolled,
  PasskeyCredentialGoneError,
  unlockWithPasskey,
} from './passkeyUnlock';

const ASSERTION_REQUEST = {
  challenge: new Uint8Array(32).fill(1),
  credentialId: new Uint8Array(16).fill(7),
  prfSalt: new Uint8Array(32).fill(2),
  userVerification: 'required' as const,
};

const CREATION_REQUEST = {
  challenge: new Uint8Array(32).fill(1),
  userId: new Uint8Array(16).fill(3),
  userName: 'owner',
  userDisplayName: 'Owner',
  prfSalt: new Uint8Array(32).fill(2),
  userVerification: 'required' as const,
};

const OWNER = 'owner-a';
const MASTER_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 100);

/** The 1Password extension's shape: a plain array of 32 byte values. */
const PLAIN_ARRAY_PRF_OUTPUT = Array.from({ length: 32 }, (_, index) => index);

/** A three-slot array with a hole at index 1; a literal `[1, , 3]` trips no-sparse-arrays. */
const SPARSE_BYTES: unknown[] = [1, 2, 3];
delete SPARSE_BYTES[1];

/**
 * The credential id `fakeCredential` returns (16 bytes of 7), base64url-encoded.
 * `BwcH` encodes three 0x07 bytes; `Bw` is the unpadded final byte.
 */
const RAW_CREDENTIAL_ID_BASE64URL = 'BwcH'.repeat(5) + 'Bw';

function stubCredentials(container: {
  create?: jest.Mock;
  get?: jest.Mock;
}): void {
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: container,
  });
}

/** Stubs `PublicKeyCredential.signalUnknownCredential` on the window; returns the spy. */
function stubSignalUnknownCredential(): jest.Mock {
  const signal = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: Object.assign(function PublicKeyCredential() {}, {
      signalUnknownCredential: signal,
    }),
  });
  return signal;
}

/** Detaches a buffer in place, as a transfer to another realm would. */
function detachBuffer(buffer: ArrayBuffer): void {
  (buffer as ArrayBuffer & { transfer: () => ArrayBuffer }).transfer();
}

/** A credential as the browser returns it, with the given extension output. */
function fakeCredential(extensionResults: Record<string, unknown>) {
  return {
    type: 'public-key',
    rawId: new Uint8Array(16).fill(7).buffer,
    getClientExtensionResults: () => extensionResults,
  };
}

/** A credential whose PRF extension result carries `first` as its output. */
function fakePrfCredential(first: unknown) {
  return fakeCredential({ prf: { results: { first } } });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'credentials');
  Reflect.deleteProperty(window, 'PublicKeyCredential');
  localStorage.clear();
});

describe('prfOutputBytes', () => {
  test('an ArrayBuffer yields its bytes as a copy, not a view of the source', () => {
    const source = new Uint8Array([1, 2, 3, 4]).buffer;

    const bytes = prfOutputBytes(source);
    new Uint8Array(source)[0] = 99;

    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  test('a subarray view yields only its own bytes, not the backing buffer', () => {
    const backing = new Uint8Array([9, 1, 2, 3, 9]);

    expect(prfOutputBytes(backing.subarray(1, 4))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  test('a plain array of byte values yields a Uint8Array with those bytes', () => {
    expect(prfOutputBytes(PLAIN_ARRAY_PRF_OUTPUT)).toEqual(
      Uint8Array.from(PLAIN_ARRAY_PRF_OUTPUT),
    );
  });

  test.each([
    ['an empty array', []],
    ['an element of 256', [256]],
    ['an element of -1', [-1]],
    ['an element of 1.5', [1.5]],
    ['a string element', ['x']],
    ['a new Array(32) with only holes', new Array(32)],
    ['an array with a hole at index 1', SPARSE_BYTES],
  ])('a malformed array (%s) yields null', (_label, value) => {
    expect(prfOutputBytes(value)).toBeNull();
  });

  test('the byte boundaries 0 and 255 are accepted', () => {
    expect(prfOutputBytes([0, 255])).toEqual(new Uint8Array([0, 255]));
  });

  test('a detached ArrayBuffer, or a view over one, yields null instead of throwing', () => {
    // jsdom has no structuredClone; transfer() detaches the buffer in place.
    const detached = new ArrayBuffer(4);
    detachBuffer(detached);

    const viewed = new ArrayBuffer(4);
    const view = new Uint8Array(viewed);
    detachBuffer(viewed);

    expect(detached.byteLength).toBe(0);
    expect(view.byteLength).toBe(0);
    expect(prfOutputBytes(detached)).toBeNull();
    expect(prfOutputBytes(view)).toBeNull();
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a plain object', { 0: 1 }],
    ['a string', 'abc'],
  ])('%s yields null', (_label, value) => {
    expect(prfOutputBytes(value)).toBeNull();
  });
});

describe('createBrowserPasskeyPlatform — createCredential', () => {
  test('a plain array of 32 byte values (the 1Password shape) is the PRF output', async () => {
    stubCredentials({
      create: jest
        .fn()
        .mockResolvedValue(fakePrfCredential(PLAIN_ARRAY_PRF_OUTPUT)),
    });

    const result =
      await createBrowserPasskeyPlatform().createCredential(CREATION_REQUEST);

    expect(result.prfOutput).toEqual(Uint8Array.from(PLAIN_ARRAY_PRF_OUTPUT));
    expect(result.prfEnabled).toBe(true);
  });

  test('an ArrayBuffer PRF output is still read as the spec shape', async () => {
    stubCredentials({
      create: jest
        .fn()
        .mockResolvedValue(
          fakePrfCredential(new Uint8Array(32).fill(5).buffer),
        ),
    });

    const result =
      await createBrowserPasskeyPlatform().createCredential(CREATION_REQUEST);

    expect(result.prfOutput).toEqual(new Uint8Array(32).fill(5));
    expect(result.prfEnabled).toBe(true);
  });

  test('PRF enabled without a result reports enabled with no output', async () => {
    stubCredentials({
      create: jest
        .fn()
        .mockResolvedValue(fakeCredential({ prf: { enabled: true } })),
    });

    const result =
      await createBrowserPasskeyPlatform().createCredential(CREATION_REQUEST);

    expect(result.prfEnabled).toBe(true);
    expect(result.prfOutput).toBeNull();
  });

  test('a credential with no prf extension output reports disabled with no output', async () => {
    stubCredentials({
      create: jest.fn().mockResolvedValue(fakeCredential({})),
    });

    const result =
      await createBrowserPasskeyPlatform().createCredential(CREATION_REQUEST);

    expect(result.prfEnabled).toBe(false);
    expect(result.prfOutput).toBeNull();
  });

  test('an extension read that throws reports disabled with no output', async () => {
    const credential = {
      ...fakeCredential({}),
      getClientExtensionResults: () => {
        throw new Error('extension failed');
      },
    };
    stubCredentials({ create: jest.fn().mockResolvedValue(credential) });

    await expect(
      createBrowserPasskeyPlatform().createCredential(CREATION_REQUEST),
    ).resolves.toMatchObject({ prfEnabled: false, prfOutput: null });
  });

  test('a malformed PRF result resolves as unsupported instead of rejecting', async () => {
    stubCredentials({
      create: jest.fn().mockResolvedValue(fakePrfCredential(['x'])),
    });

    await expect(
      createBrowserPasskeyPlatform().createCredential(CREATION_REQUEST),
    ).resolves.toMatchObject({ prfEnabled: false, prfOutput: null });
  });

  test('the create request asks for user verification and evaluates the PRF salt', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(fakeCredential({ prf: { enabled: true } }));
    stubCredentials({ create });

    await createBrowserPasskeyPlatform().createCredential(CREATION_REQUEST);

    const options = create.mock.calls[0][0] as {
      publicKey: {
        authenticatorSelection: { userVerification: string };
        extensions: { prf: { eval: { first: ArrayBuffer } } };
      };
    };
    expect(options.publicKey.authenticatorSelection.userVerification).toBe(
      'required',
    );
    expect(new Uint8Array(options.publicKey.extensions.prf.eval.first)).toEqual(
      CREATION_REQUEST.prfSalt,
    );
  });
});

describe('createBrowserPasskeyPlatform — getAssertion output', () => {
  test('a plain array of byte values is the PRF output', async () => {
    stubCredentials({
      get: jest
        .fn()
        .mockResolvedValue(fakePrfCredential(PLAIN_ARRAY_PRF_OUTPUT)),
    });

    await expect(
      createBrowserPasskeyPlatform().getAssertion(ASSERTION_REQUEST),
    ).resolves.toEqual({
      prfOutput: Uint8Array.from(PLAIN_ARRAY_PRF_OUTPUT),
    });
  });

  test('an assertion with no PRF output reports null', async () => {
    stubCredentials({ get: jest.fn().mockResolvedValue(fakeCredential({})) });

    await expect(
      createBrowserPasskeyPlatform().getAssertion(ASSERTION_REQUEST),
    ).resolves.toEqual({ prfOutput: null });
  });

  test('a malformed PRF result on assertion reports null instead of rejecting', async () => {
    stubCredentials({
      get: jest.fn().mockResolvedValue(fakePrfCredential(['x'])),
    });

    await expect(
      createBrowserPasskeyPlatform().getAssertion(ASSERTION_REQUEST),
    ).resolves.toEqual({ prfOutput: null });
  });

  test('the get request names the credential, requires user verification, and evaluates the PRF salt', async () => {
    const get = jest.fn().mockResolvedValue(fakeCredential({}));
    stubCredentials({ get });

    await createBrowserPasskeyPlatform().getAssertion(ASSERTION_REQUEST);

    const options = get.mock.calls[0][0] as {
      publicKey: {
        allowCredentials: { id: ArrayBuffer }[];
        userVerification: string;
        extensions: { prf: { eval: { first: ArrayBuffer } } };
      };
    };
    expect(new Uint8Array(options.publicKey.allowCredentials[0].id)).toEqual(
      ASSERTION_REQUEST.credentialId,
    );
    expect(options.publicKey.userVerification).toBe('required');
    expect(new Uint8Array(options.publicKey.extensions.prf.eval.first)).toEqual(
      ASSERTION_REQUEST.prfSalt,
    );
  });
});

describe('createBrowserPasskeyPlatform — getAssertion failures', () => {
  test('a NotFoundError from the browser is credential-gone', async () => {
    stubCredentials({
      get: jest
        .fn()
        .mockRejectedValue(
          new DOMException('The credential no longer exists', 'NotFoundError'),
        ),
    });

    await expect(
      createBrowserPasskeyPlatform().getAssertion(ASSERTION_REQUEST),
    ).rejects.toBeInstanceOf(PasskeyCredentialGoneError);
  });

  test('a NotAllowedError (a cancel) is a plain failure, not credential-gone', async () => {
    const cancelled = new DOMException(
      'The operation either timed out or was not allowed.',
      'NotAllowedError',
    );
    stubCredentials({ get: jest.fn().mockRejectedValue(cancelled) });

    const rejection =
      createBrowserPasskeyPlatform().getAssertion(ASSERTION_REQUEST);

    await expect(rejection).rejects.toBe(cancelled);
    await expect(rejection).rejects.not.toBeInstanceOf(
      PasskeyCredentialGoneError,
    );
  });
});

describe('Passkey Unlock over the browser platform adapter (acceptance)', () => {
  test('a 1Password-shaped passkey enrols, then unlocks to the enrolled Master Key', async () => {
    stubCredentials({
      create: jest
        .fn()
        .mockResolvedValue(fakePrfCredential(PLAIN_ARRAY_PRF_OUTPUT)),
      get: jest
        .fn()
        .mockResolvedValue(fakePrfCredential(PLAIN_ARRAY_PRF_OUTPUT)),
    });
    const platform = createBrowserPasskeyPlatform();

    await expect(
      enrolPasskeyUnlock({
        owner: OWNER,
        masterKeyBytes: MASTER_KEY,
        userName: 'owner',
        platform,
      }),
    ).resolves.toBe('enrolled');
    expect(isPasskeyUnlockEnrolled(OWNER)).toBe(true);

    await expect(
      unlockWithPasskey({ owner: OWNER, platform }),
    ).resolves.toEqual({ outcome: 'unlocked', masterKeyBytes: MASTER_KEY });
  });

  test('a malformed PRF result on create ends unsupported, stores nothing, and abandons the passkey', async () => {
    const signalUnknownCredential = stubSignalUnknownCredential();
    stubCredentials({
      create: jest.fn().mockResolvedValue(fakePrfCredential(['x'])),
    });

    await expect(
      enrolPasskeyUnlock({
        owner: OWNER,
        masterKeyBytes: MASTER_KEY,
        userName: 'owner',
        platform: createBrowserPasskeyPlatform(),
      }),
    ).resolves.toBe('unsupported');

    expect(isPasskeyUnlockEnrolled(OWNER)).toBe(false);
    expect(signalUnknownCredential).toHaveBeenCalledWith({
      rpId: window.location.hostname,
      credentialId: RAW_CREDENTIAL_ID_BASE64URL,
    });
  });
});

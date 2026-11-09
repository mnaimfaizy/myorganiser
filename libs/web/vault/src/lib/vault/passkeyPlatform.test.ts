/**
 * Tests for the browser Platform Adapter's assertion failures (ADR 0136).
 *
 * Only one translation is under test: WebAuthn's `NotFoundError` means the
 * enrolled credential no longer exists, so it becomes
 * `PasskeyCredentialGoneError`; every other rejection passes through as a plain
 * failure. `navigator.credentials` is stubbed, so no real WebAuthn runs.
 */

import { createBrowserPasskeyPlatform } from './passkeyPlatform';
import { PasskeyCredentialGoneError } from './passkeyUnlock';

const ASSERTION_REQUEST = {
  challenge: new Uint8Array(32).fill(1),
  credentialId: new Uint8Array(16).fill(7),
  prfSalt: new Uint8Array(32).fill(2),
  userVerification: 'required' as const,
};

function stubCredentialsGet(get: jest.Mock): void {
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { get },
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'credentials');
});

describe('createBrowserPasskeyPlatform — getAssertion failures', () => {
  test('a NotFoundError from the browser is credential-gone', async () => {
    stubCredentialsGet(
      jest
        .fn()
        .mockRejectedValue(
          new DOMException('The credential no longer exists', 'NotFoundError'),
        ),
    );

    await expect(
      createBrowserPasskeyPlatform().getAssertion(ASSERTION_REQUEST),
    ).rejects.toBeInstanceOf(PasskeyCredentialGoneError);
  });

  test('a NotAllowedError (a cancel) is a plain failure, not credential-gone', async () => {
    const cancelled = new DOMException(
      'The operation either timed out or was not allowed.',
      'NotAllowedError',
    );
    stubCredentialsGet(jest.fn().mockRejectedValue(cancelled));

    const rejection =
      createBrowserPasskeyPlatform().getAssertion(ASSERTION_REQUEST);

    await expect(rejection).rejects.toBe(cancelled);
    await expect(rejection).rejects.not.toBeInstanceOf(
      PasskeyCredentialGoneError,
    );
  });
});

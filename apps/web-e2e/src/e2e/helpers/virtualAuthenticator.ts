import type { Page } from '@playwright/test';

export interface VirtualAuthenticatorOptions {
  /** Whether the authenticator supports the WebAuthn `prf` extension. */
  prf: boolean;
  /** Whether the authenticator can verify the User (fingerprint, face, PIN). */
  userVerification: boolean;
}

/** A CDP-backed platform authenticator attached to one page's browser context. */
export interface VirtualAuthenticator {
  /** Number of credentials the authenticator currently holds. */
  credentialCount(): Promise<number>;
  /** Drop every credential, keeping the authenticator attached. */
  reset(): Promise<void>;
  /** Remove the authenticator and detach the CDP session. Safe to call twice. */
  dispose(): Promise<void>;
}

/**
 * Attach a CTAP2 platform authenticator to `page` over the Chrome DevTools
 * Protocol, so `navigator.credentials` calls resolve without a real device.
 *
 * Chromium only: the WebAuthn domain is a Chrome DevTools feature. Callers
 * skip on other engines before calling this. Attach before the page loads the
 * app, so the authenticator is present when the first credential call is made.
 */
export async function attachVirtualAuthenticator(
  page: Page,
  { prf, userVerification }: VirtualAuthenticatorOptions,
): Promise<VirtualAuthenticator> {
  const session = await page.context().newCDPSession(page);
  await session.send('WebAuthn.enable');

  const { authenticatorId } = await session.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        ctap2Version: 'ctap2_1',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: userVerification,
        isUserVerified: userVerification,
        automaticPresenceSimulation: true,
        hasPrf: prf,
      },
    },
  );

  let disposed = false;

  return {
    async credentialCount() {
      const { credentials } = await session.send('WebAuthn.getCredentials', {
        authenticatorId,
      });
      return credentials.length;
    },

    async reset() {
      await session.send('WebAuthn.clearCredentials', { authenticatorId });
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      // Teardown must not fail a test that already finished its assertions:
      // the page may have closed, or the session may already be gone.
      await session
        .send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
        .catch(() => undefined);
      await session.send('WebAuthn.disable').catch(() => undefined);
      await session.detach().catch(() => undefined);
    },
  };
}

/* eslint-disable import/first -- jest.mock must precede application imports */

import React from 'react';

const mockGetCurrentUser = jest.fn();
const mockToast = jest.fn();

jest.mock('@myorganiser/auth', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: () => ({ toast: mockToast }),
}));

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  isPasskeyUnlockEnrolled,
  type PasskeyAssertionRequest,
  type PasskeyCreationRequest,
  type PasskeyPlatform,
} from '@myorganiser/web-vault';
import { PasskeyPlatformProvider } from './passkeyPlatformContext';
import { PasskeyUnlockOfferRunner } from './passkeyUnlockOfferRunner';
import {
  VaultSessionContext,
  type VaultSessionContextValue,
  type VaultUnlockSecret,
} from './session';

const OFFER_TITLE = /Unlock faster with a passkey/;
const CREDENTIAL_ID = new Uint8Array(16).fill(7);

/**
 * A deterministic fake authenticator: the PRF output is SHA-256 over the
 * credential id and the salt, so enrolment and a later assertion agree
 * without any browser WebAuthn.
 */
async function fakePrf(
  credentialId: Uint8Array,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const input = new Uint8Array(credentialId.length + salt.length);
  input.set(credentialId, 0);
  input.set(salt, credentialId.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

function createFakePlatform(
  options: { canCreate?: boolean; prf?: boolean } = {},
) {
  const canCreate = options.canCreate ?? true;
  const prf = options.prf ?? true;
  return {
    canCreatePasskeys: jest.fn(async () => canCreate),
    createCredential: jest.fn(async (request: PasskeyCreationRequest) => ({
      credentialId: CREDENTIAL_ID,
      prfEnabled: prf,
      prfOutput: prf ? await fakePrf(CREDENTIAL_ID, request.prfSalt) : null,
    })),
    getAssertion: jest.fn(async (request: PasskeyAssertionRequest) => ({
      prfOutput: await fakePrf(request.credentialId, request.prfSalt),
    })),
    abandonCredential: jest.fn(async () => undefined),
  };
}

type FakePlatform = ReturnType<typeof createFakePlatform>;

/** A session value carrying only what the offer reads: the owner and the unlock. */
function sessionFor(
  owner: string,
  unlockSecret: VaultUnlockSecret = 'passphrase',
): VaultSessionContextValue {
  return {
    handle: { owner },
    masterKeyBytes: new Uint8Array(32).fill(9),
    unlockSecret,
  } as unknown as VaultSessionContextValue;
}

function tree(session: VaultSessionContextValue, platform: PasskeyPlatform) {
  return (
    <VaultSessionContext.Provider value={session}>
      <PasskeyPlatformProvider platform={platform}>
        <PasskeyUnlockOfferRunner />
      </PasskeyPlatformProvider>
    </VaultSessionContext.Provider>
  );
}

/** Let the offer's async eligibility check settle, then return. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('PasskeyUnlockOfferRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockGetCurrentUser.mockReturnValue({ email: 'owner-a@example.com' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a passphrase unlock offers once; Set up passkey enrols, closes, and never re-offers that owner', async () => {
    const platform: FakePlatform = createFakePlatform();
    const session = sessionFor('owner-a');
    const { rerender } = render(tree(session, platform));

    expect(
      await screen.findByRole('dialog', { name: OFFER_TITLE }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set up passkey' }));

    await waitFor(() => {
      expect(isPasskeyUnlockEnrolled('owner-a')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Passkey Unlock is on' }),
    );
    expect(platform.createCredential).toHaveBeenCalledTimes(1);
    expect(platform.createCredential).toHaveBeenCalledWith(
      expect.objectContaining({ userVerification: 'required' }),
    );

    // Re-render with the same session object (the same unlock), then a fresh
    // passphrase unlock. Neither reopens the offer, and only the fresh unlock
    // runs a new eligibility check, which finds the record and says no.
    rerender(tree(session, platform));
    await settle();
    expect(platform.canCreatePasskeys).toHaveBeenCalledTimes(1);

    rerender(tree(sessionFor('owner-a'), platform));
    await settle();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(platform.createCredential).toHaveBeenCalledTimes(1);
  });

  test('Not now closes the offer and is remembered for this owner after a remount', async () => {
    const platform = createFakePlatform();
    const first = render(tree(sessionFor('owner-a'), platform));

    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    first.unmount();

    render(tree(sessionFor('owner-a'), platform));
    await settle();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(platform.createCredential).not.toHaveBeenCalled();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
  });

  test('Escape counts as declining: the offer closes and is remembered', async () => {
    const platform = createFakePlatform();
    const first = render(tree(sessionFor('owner-a'), platform));

    fireEvent.keyDown(
      await screen.findByRole('dialog', { name: OFFER_TITLE }),
      { key: 'Escape' },
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    first.unmount();

    render(tree(sessionFor('owner-a'), platform));
    await settle();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(platform.createCredential).not.toHaveBeenCalled();
  });

  test.each(['passkey', 'recovery-key'] as const)(
    'is not shown after a %s unlock, and the browser is not asked',
    async (unlockSecret) => {
      const platform = createFakePlatform();
      render(tree(sessionFor('owner-a', unlockSecret), platform));
      await settle();

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(platform.canCreatePasskeys).not.toHaveBeenCalled();
    },
  );

  test('is not shown when the browser cannot create passkeys', async () => {
    const platform = createFakePlatform({ canCreate: false });
    render(tree(sessionFor('owner-a'), platform));
    await settle();

    expect(platform.canCreatePasskeys).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
  });

  test('a created passkey with no PRF output stores nothing, abandons the credential, and is never offered again', async () => {
    const platform = createFakePlatform({ prf: false });
    const first = render(tree(sessionFor('owner-a'), platform));

    fireEvent.click(
      await screen.findByRole('button', { name: 'Set up passkey' }),
    );

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "This passkey can't unlock your vault",
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(platform.abandonCredential).toHaveBeenCalledWith(CREDENTIAL_ID);
    first.unmount();

    render(tree(sessionFor('owner-a'), platform));
    await settle();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(platform.createCredential).toHaveBeenCalledTimes(1);
  });

  test("another owner is offered independently and never sees the first owner's answer", async () => {
    const platform = createFakePlatform();
    const first = render(tree(sessionFor('owner-a'), platform));

    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    first.rerender(tree(sessionFor('owner-b'), platform));

    fireEvent.click(
      await screen.findByRole('button', { name: 'Set up passkey' }),
    );

    await waitFor(() => {
      expect(isPasskeyUnlockEnrolled('owner-b')).toBe(true);
    });
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
    expect(platform.createCredential).toHaveBeenCalledWith(
      expect.objectContaining({ userVerification: 'required' }),
    );
  });

  test('a rejected passkey creation (NotAllowedError) shows the failure toast, closes the offer, and stores nothing', async () => {
    const platform = createFakePlatform();
    platform.createCredential.mockRejectedValueOnce(
      new DOMException('The user cancelled the request', 'NotAllowedError'),
    );
    render(tree(sessionFor('owner-a'), platform));

    fireEvent.click(
      await screen.findByRole('button', { name: 'Set up passkey' }),
    );

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Passkey Unlock was not set up' }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(isPasskeyUnlockEnrolled('owner-a')).toBe(false);
  });

  test('the per-unlock guard holds when the offer answer cannot be stored: the same unlock does not reopen it', async () => {
    const platform = createFakePlatform();
    const session = sessionFor('owner-a');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { rerender } = render(tree(session, platform));

    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // A new platform object re-runs the eligibility effect, but the same
    // Master Key bytes were already asked for, so the check is not repeated.
    const replacement = createFakePlatform();
    rerender(tree(session, replacement));
    await settle();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(platform.canCreatePasskeys).toHaveBeenCalledTimes(1);
    expect(replacement.canCreatePasskeys).not.toHaveBeenCalled();
  });

  test('a platform whose eligibility check rejects offers nothing', async () => {
    const platform = createFakePlatform();
    platform.canCreatePasskeys.mockRejectedValueOnce(new Error('boom'));
    render(tree(sessionFor('owner-a'), platform));
    await settle();

    expect(platform.canCreatePasskeys).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(platform.createCredential).not.toHaveBeenCalled();
  });

  test('unmounting before the eligibility check resolves shows no dialog', async () => {
    const platform = createFakePlatform();
    let resolveCheck: (value: boolean) => void = () => undefined;
    platform.canCreatePasskeys.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const view = render(tree(sessionFor('owner-a'), platform));
    expect(platform.canCreatePasskeys).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => {
      resolveCheck(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

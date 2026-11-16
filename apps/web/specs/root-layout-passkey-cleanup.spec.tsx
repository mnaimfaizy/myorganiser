import { act, render } from '@testing-library/react';
import { AuthenticationApi } from '@myorganiser/app-api-client';
import {
  authSession,
  setAccessToken,
  setCurrentUser,
  type AuthUser,
  type RestoreSessionOutcome,
} from '@myorganiser/auth';
import {
  isPasskeyUnlockEnrolled,
  passkeyUnlockRecordFixture,
  passkeyUnlockStorageKey,
} from '@myorganiser/web-vault';
import { useEffect } from 'react';

import RootLayout from '../src/app/layout';

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

// The key the auth module writes the current User under (libs/auth
// auth-session-storage-adapter.ts). Not exported, so it is named here.
const CURRENT_USER_KEY = 'myorganiser_user';

function seedRecord(owner: string): void {
  localStorage.setItem(
    passkeyUnlockStorageKey(owner),
    JSON.stringify(passkeyUnlockRecordFixture(owner)),
  );
}

function userFor(id: string): AuthUser {
  return {
    id,
    email: `${id}@example.com`,
    name: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    role: 'user',
    disabled: false,
  };
}

/**
 * A cold load with only the User in localStorage and no access token, the
 * state a new window starts in when the token was kept per-window. That is the
 * only shape that makes `restoreSession` ask the server.
 */
function seedColdLoad(owner: string): void {
  setCurrentUser(userFor(owner));
}

/** Only the server's answer is stubbed: the generated client's refresh call. */
function refreshAnswers(rejection: unknown): void {
  jest
    .spyOn(AuthenticationApi.prototype, 'refreshToken')
    .mockRejectedValue(rejection);
}

function refusedWith(status: number): unknown {
  return Object.assign(new Error('Unauthorized'), { response: { status } });
}

/**
 * Renders the real root layout with one child whose effect runs `onMount`.
 * Passive effects run in tree order within one commit, so the layout's
 * cleanup (an earlier sibling of `{children}`) subscribes before the child's
 * effect runs. Tests 4 and 5 depend on that order; tests 1-3 do not, because a
 * refresh-path emit always follows an `await` and so cannot race the child's
 * synchronous effect.
 */
function renderLayoutWithChild(onMount: () => void): void {
  render(
    <RootLayout>
      <EffectChild onMount={onMount} />
    </RootLayout>,
  );
}

function EffectChild({ onMount }: { onMount: () => void }): null {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return null;
}

describe('root layout ended-session passkey cleanup on a cold-load restore', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    // RTL mounts into a <div>, so React reports the layout's <html> root as
    // misnested. That is the one message this suite accepts; any other
    // console.error still reaches the real console.
    const original = console.error;
    consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        const text = args.map(String).join(' ');
        if (text.includes('cannot be a child of') && text.includes('<html>')) {
          return;
        }
        original(...args);
      });
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('removes the record of the User whose session the server refused', async () => {
    seedColdLoad(OWNER_A);
    seedRecord(OWNER_A);
    refreshAnswers(refusedWith(401));
    const restores: Promise<RestoreSessionOutcome>[] = [];

    renderLayoutWithChild(() => {
      restores.push(authSession.restoreSession());
    });
    const [restore] = restores;
    await act(async () => {
      expect(await restore).toEqual({ kind: 'session_cleared' });
    });

    expect(localStorage.getItem(passkeyUnlockStorageKey(OWNER_A))).toBeNull();
  });

  it('removes only the refused owner record and keeps another User on the device', async () => {
    seedColdLoad(OWNER_A);
    seedRecord(OWNER_A);
    seedRecord(OWNER_B);
    refreshAnswers(refusedWith(401));
    const restores: Promise<RestoreSessionOutcome>[] = [];

    renderLayoutWithChild(() => {
      restores.push(authSession.restoreSession());
    });
    const [restore] = restores;
    await act(async () => {
      await restore;
    });

    expect(localStorage.getItem(passkeyUnlockStorageKey(OWNER_A))).toBeNull();
    expect(isPasskeyUnlockEnrolled(OWNER_B)).toBe(true);
  });

  it('keeps the record when the restore fails without an answer from the server', async () => {
    seedColdLoad(OWNER_A);
    seedRecord(OWNER_A);
    refreshAnswers(new Error('Network Error'));
    const restores: Promise<RestoreSessionOutcome>[] = [];

    renderLayoutWithChild(() => {
      restores.push(authSession.restoreSession());
    });
    const [restore] = restores;
    await act(async () => {
      expect(await restore).toEqual({ kind: 'not_restored' });
    });

    expect(
      localStorage.getItem(passkeyUnlockStorageKey(OWNER_A)),
    ).not.toBeNull();
    expect(authSession.getCurrentUser()?.id).toBe(OWNER_A);
  });

  it('keeps the record and clears the token when another window signs out', async () => {
    setAccessToken('access-token-a', 'local');
    setCurrentUser(userFor(OWNER_A));
    seedRecord(OWNER_A);

    renderLayoutWithChild(() => {
      localStorage.removeItem(CURRENT_USER_KEY);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: CURRENT_USER_KEY,
          newValue: null,
          storageArea: localStorage,
        }),
      );
    });

    // The token is cleared only by the signed-out-elsewhere path, so this
    // proves the listener ran. The record is kept because that event carries
    // no owner, not because of the reason guard; the guard is covered by the
    // refresh_rejected tests above.
    expect(authSession.getAccessToken()).toBeUndefined();
    expect(
      localStorage.getItem(passkeyUnlockStorageKey(OWNER_A)),
    ).not.toBeNull();
  });

  it('keeps the record when the refused restore has no owner to remove', async () => {
    setAccessToken('access-token-a', 'session');
    seedRecord(OWNER_A);
    refreshAnswers(refusedWith(401));
    const restores: Promise<RestoreSessionOutcome>[] = [];

    renderLayoutWithChild(() => {
      restores.push(authSession.restoreSession());
    });
    const [restore] = restores;
    await act(async () => {
      expect(await restore).toEqual({ kind: 'session_cleared' });
    });

    expect(
      localStorage.getItem(passkeyUnlockStorageKey(OWNER_A)),
    ).not.toBeNull();
  });

  it('registers the other-window sign-out listener before the child effect starts the restore', async () => {
    seedColdLoad(OWNER_A);
    seedRecord(OWNER_A);
    refreshAnswers(refusedWith(401));
    const addListener = jest.spyOn(window, 'addEventListener');
    const restores: Promise<RestoreSessionOutcome>[] = [];
    let storageListenerAtRestoreStart = false;

    renderLayoutWithChild(() => {
      // The module's first subscriber registers the window `storage` listener
      // that reports another window's sign-out (auth-session-storage-adapter).
      // It is in place only if the layout's cleanup subscribed first.
      storageListenerAtRestoreStart = addListener.mock.calls.some(
        ([type]) => type === 'storage',
      );
      restores.push(authSession.restoreSession());
    });
    const [restore] = restores;
    await act(async () => {
      await restore;
    });

    expect(storageListenerAtRestoreStart).toBe(true);
    expect(localStorage.getItem(passkeyUnlockStorageKey(OWNER_A))).toBeNull();
  });
});

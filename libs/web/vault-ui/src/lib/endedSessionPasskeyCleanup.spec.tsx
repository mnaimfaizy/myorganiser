/* eslint-disable import/first -- jest.mock must precede application imports */
jest.mock('@myorganiser/auth', () => ({
  ...jest.requireActual('@myorganiser/auth'),
  onSessionEnded: jest.fn(),
}));

import { render } from '@testing-library/react';
import {
  createAuthSessionModule,
  createBrowserAuthSessionStorageAdapter,
  onSessionEnded,
  type AuthUser,
} from '@myorganiser/auth';
import {
  isPasskeyUnlockEnrolled,
  passkeyUnlockRecordFixture,
  passkeyUnlockStorageKey,
} from '@myorganiser/web-vault';

import {
  EndedSessionPasskeyCleanup,
  removePasskeyUnlockForEndedSession,
} from './endedSessionPasskeyCleanup';

const mockOnSessionEnded = onSessionEnded as jest.MockedFunction<
  typeof onSessionEnded
>;

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

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

describe('removePasskeyUnlockForEndedSession', () => {
  beforeEach(() => {
    localStorage.clear();
    seedRecord(OWNER_A);
    seedRecord(OWNER_B);
  });

  it('removes only the ended owner record when the server ended the session', () => {
    removePasskeyUnlockForEndedSession({
      reason: 'refresh_rejected',
      owner: OWNER_A,
    });

    expect(localStorage.getItem(passkeyUnlockStorageKey(OWNER_A))).toBeNull();
    expect(
      localStorage.getItem(passkeyUnlockStorageKey(OWNER_B)),
    ).not.toBeNull();
    expect(isPasskeyUnlockEnrolled(OWNER_B)).toBe(true);
  });

  it('removes nothing and does not throw when the event carries no owner', () => {
    expect(() =>
      removePasskeyUnlockForEndedSession({ reason: 'refresh_rejected' }),
    ).not.toThrow();

    expect(
      localStorage.getItem(passkeyUnlockStorageKey(OWNER_A)),
    ).not.toBeNull();
    expect(
      localStorage.getItem(passkeyUnlockStorageKey(OWNER_B)),
    ).not.toBeNull();
  });

  it('removes nothing when the session ended because another window signed out', () => {
    removePasskeyUnlockForEndedSession({
      reason: 'signed_out_elsewhere',
      owner: OWNER_A,
    });

    expect(
      localStorage.getItem(passkeyUnlockStorageKey(OWNER_A)),
    ).not.toBeNull();
    expect(
      localStorage.getItem(passkeyUnlockStorageKey(OWNER_B)),
    ).not.toBeNull();
  });

  it('does not throw when the browser refuses the removal', () => {
    const removeItem = jest
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => {
        throw new Error('storage refused');
      });

    try {
      expect(() =>
        removePasskeyUnlockForEndedSession({
          reason: 'refresh_rejected',
          owner: OWNER_A,
        }),
      ).not.toThrow();
      expect(removeItem).toHaveBeenCalled();
    } finally {
      removeItem.mockRestore();
    }

    expect(
      localStorage.getItem(passkeyUnlockStorageKey(OWNER_A)),
    ).not.toBeNull();
  });
});

describe('EndedSessionPasskeyCleanup', () => {
  let unsubscribe: jest.Mock<void, []>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    unsubscribe = jest.fn();
    mockOnSessionEnded.mockReset();
    mockOnSessionEnded.mockReturnValue(unsubscribe);
  });

  it('subscribes on mount and unsubscribes on unmount', () => {
    const { unmount } = render(<EndedSessionPasskeyCleanup />);

    expect(mockOnSessionEnded).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('removes the ended owner record through the subscribed listener', () => {
    seedRecord(OWNER_A);
    seedRecord(OWNER_B);
    render(<EndedSessionPasskeyCleanup />);
    const listener = mockOnSessionEnded.mock.calls[0][0];

    listener({ reason: 'refresh_rejected', owner: OWNER_A });

    expect(localStorage.getItem(passkeyUnlockStorageKey(OWNER_A))).toBeNull();
    expect(
      localStorage.getItem(passkeyUnlockStorageKey(OWNER_B)),
    ).not.toBeNull();
  });

  describe.each([401, 403])(
    'when a cold-load restore is refused by the server with %i',
    (status) => {
      it('removes the record of the User whose session ended', async () => {
        const storage = createBrowserAuthSessionStorageAdapter();
        storage.setCurrentUser(userFor(OWNER_A));
        const refreshToken = jest.fn().mockRejectedValue(
          Object.assign(new Error('Unauthorized'), {
            response: { status },
          }),
        );
        const authModule = createAuthSessionModule({
          storage,
          transport: {
            getAuthAxios: jest.fn(),
            getAuthApi: () => ({ refreshToken }),
          } as unknown as Parameters<
            typeof createAuthSessionModule
          >[0]['transport'],
        });
        mockOnSessionEnded.mockImplementation((listener) =>
          authModule.onSessionEnded(listener),
        );
        seedRecord(OWNER_A);
        seedRecord(OWNER_B);

        render(<EndedSessionPasskeyCleanup />);
        const result = await authModule.restoreSession();

        expect(result).toEqual({ kind: 'session_cleared' });
        expect(refreshToken).toHaveBeenCalledTimes(1);
        expect(
          localStorage.getItem(passkeyUnlockStorageKey(OWNER_A)),
        ).toBeNull();
        expect(
          localStorage.getItem(passkeyUnlockStorageKey(OWNER_B)),
        ).not.toBeNull();
      });
    },
  );
});

import { AxiosError } from 'axios';

import {
  clearAuthSession,
  getAccessToken,
  getAuthAxios,
  getCurrentUser,
  onSessionEnded,
  setAccessToken,
  setCurrentUser,
} from './auth';

describe('auth storage', () => {
  beforeEach(() => {
    clearAuthSession();
  });

  it('stores access token in localStorage when requested', () => {
    setAccessToken('abc', 'local');
    expect(getAccessToken()).toBe('abc');
    expect(window.localStorage.getItem('myorganiser_access_token')).toBe('abc');
    expect(window.sessionStorage.getItem('myorganiser_access_token')).toBe(
      null,
    );
  });

  it('stores access token in sessionStorage when requested', () => {
    setAccessToken('def', 'session');
    expect(getAccessToken()).toBe('def');
    expect(window.sessionStorage.getItem('myorganiser_access_token')).toBe(
      'def',
    );
    expect(window.localStorage.getItem('myorganiser_access_token')).toBe(null);
  });

  it('stores and loads current user', () => {
    setCurrentUser({
      id: 'u1',
      email: 'a@example.com',
      name: 'A',
      firstName: 'A',
      lastName: 'B',
      role: 'user',
      disabled: false,
    });

    const user = getCurrentUser();
    expect(user?.id).toBe('u1');
    expect(user?.email).toBe('a@example.com');
  });
});

describe('onSessionEnded', () => {
  const user = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    role: 'user' as const,
    disabled: false,
  };

  function otherWindowRemovesUser(): void {
    // What the browser does in every *other* window when one signs out: the
    // shared user is already gone from localStorage when the event arrives.
    window.localStorage.removeItem('myorganiser_user');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'myorganiser_user',
        newValue: null,
        storageArea: window.localStorage,
      }),
    );
  }

  beforeEach(() => {
    clearAuthSession();
  });

  it("drops this window's own token and notifies when another window signs out", () => {
    setAccessToken('tab-token', 'session');
    setCurrentUser(user);
    const listener = jest.fn();
    const unsubscribe = onSessionEnded(listener);

    otherWindowRemovesUser();
    unsubscribe();

    expect(getAccessToken()).toBeUndefined();
    expect(
      window.sessionStorage.getItem('myorganiser_access_token'),
    ).toBeNull();
    expect(getCurrentUser()).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ reason: 'signed_out_elsewhere' });
  });

  it('leaves the session alone once unsubscribed', () => {
    setAccessToken('tab-token', 'session');
    setCurrentUser(user);
    const listener = jest.fn();
    onSessionEnded(listener)();

    otherWindowRemovesUser();

    expect(getAccessToken()).toBe('tab-token');
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies once when the default interceptor is refused a refresh', async () => {
    setAccessToken('expired-token', 'session');
    setCurrentUser(user);
    const authAxios = getAuthAxios();
    const originalAdapter = authAxios.defaults.adapter;
    const requestedUrls: string[] = [];
    // The server answers 401 to everything: the protected call is refused,
    // which starts a refresh, and the refresh is refused in turn.
    authAxios.defaults.adapter = async (config) => {
      requestedUrls.push(config.url ?? '');
      throw new AxiosError(
        'Request failed with status code 401',
        'ERR_BAD_REQUEST',
        config,
        undefined,
        {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config,
          data: {},
        },
      );
    };
    const listener = jest.fn();
    const unsubscribe = onSessionEnded(listener);

    try {
      await expect(authAxios.get('/todos')).rejects.toMatchObject({
        response: { status: 401 },
      });

      expect(requestedUrls).toEqual([
        expect.stringContaining('/todos'),
        expect.stringContaining('/auth/refresh'),
      ]);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        reason: 'refresh_rejected',
        owner: 'user-1',
      });
      expect(getAccessToken()).toBeUndefined();
      expect(getCurrentUser()).toBeUndefined();
    } finally {
      unsubscribe();
      authAxios.defaults.adapter = originalAdapter;
    }
  });
});

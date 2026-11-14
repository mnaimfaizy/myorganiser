jest.mock('@myorganiser/app-api-client');
jest.mock('@myorganiser/core');
jest.mock('axios');

import { AuthenticationApi } from '@myorganiser/app-api-client';
import { getApiBaseUrl } from '@myorganiser/core';
import axios from 'axios';
import type { AxiosInstance } from 'axios';

import {
  createAuthSessionTransportAdapter,
  type AuthSessionTransportAdapter,
} from './auth-session-transport-adapter';
import type { AuthSessionStorageAdapter } from './auth-session-storage-adapter';
import {
  createSessionEndedSignal,
  type SessionEndedListener,
} from './session-ended-signal';

describe('createAuthSessionTransportAdapter', () => {
  let mockStorage: jest.Mocked<AuthSessionStorageAdapter>;
  let adapter: AuthSessionTransportAdapter;
  let mockAxiosInstance: jest.Mocked<AxiosInstance>;
  let sessionEndedListener: jest.Mock<void, Parameters<SessionEndedListener>>;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    role: 'user' as const,
    disabled: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks keeps queued mockImplementationOnce entries; a test that
    // stops before consuming its refresh stub would leak it into the next one,
    // and the replay test installs a persistent implementation this drops.
    (AuthenticationApi as jest.Mock).mockReset();

    mockStorage = {
      getAccessToken: jest.fn().mockReturnValue('current-token'),
      setAccessToken: jest.fn(),
      getCurrentUser: jest.fn().mockReturnValue(mockUser),
      setCurrentUser: jest.fn(),
      clearSession: jest.fn(),
    };

    // Create a callable mock axios instance
    const mockCall = jest.fn().mockResolvedValue({ status: 200, data: {} });
    mockAxiosInstance = Object.assign(mockCall, {
      interceptors: {
        response: {
          use: jest.fn(),
        },
      },
    }) as unknown as jest.Mocked<AxiosInstance>;

    (getApiBaseUrl as jest.Mock).mockReturnValue('http://api.test');
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    const sessionEnded = createSessionEndedSignal();
    sessionEndedListener = jest.fn();
    sessionEnded.subscribe(sessionEndedListener);

    adapter = createAuthSessionTransportAdapter(mockStorage, { sessionEnded });
  });

  describe('getAuthAxios', () => {
    it('creates axios instance with baseURL and withCredentials', () => {
      const instance = adapter.getAuthAxios();

      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'http://api.test',
        withCredentials: true,
      });
      expect(instance).toBe(mockAxiosInstance);
    });

    it('returns cached instance on second call', () => {
      const instance1 = adapter.getAuthAxios();
      const instance2 = adapter.getAuthAxios();

      expect(instance1).toBe(instance2);
      expect(axios.create).toHaveBeenCalledTimes(1);
    });

    it('sets up response interceptor', () => {
      adapter.getAuthAxios();

      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  describe('401 retry interceptor setup', () => {
    it('interceptor is configured on axios instance', () => {
      adapter.getAuthAxios();

      const interceptorCall = (
        mockAxiosInstance.interceptors.response.use as jest.Mock
      ).mock.calls[0];
      expect(interceptorCall.length).toBe(2);
      expect(typeof interceptorCall[0]).toBe('function'); // onFulfilled
      expect(typeof interceptorCall[1]).toBe('function'); // onRejected
    });

    it('response interceptor fulfillment returns responses unchanged', () => {
      adapter.getAuthAxios();

      const onFulfilled = (
        mockAxiosInstance.interceptors.response.use as jest.Mock
      ).mock.calls[0][0];

      const mockResponse = { status: 200, data: { message: 'ok' } };
      const result = onFulfilled(mockResponse);

      expect(result).toBe(mockResponse);
    });
  });

  describe('401 retry interceptor onRejected behavior', () => {
    let onRejected: (error: any) => Promise<any>;

    beforeEach(() => {
      adapter.getAuthAxios();
      const interceptorCall = (
        mockAxiosInstance.interceptors.response.use as jest.Mock
      ).mock.calls[0];
      onRejected = interceptorCall[1];
    });

    it('401 triggers retry with refresh on non-auth URL', async () => {
      const mockRefreshResponse = {
        data: {
          token: 'new-token',
          expires_in: 3600,
          user: mockUser,
        },
      };

      (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
        refreshToken: jest.fn().mockResolvedValue(mockRefreshResponse),
      }));

      const originalRequest = {
        url: '/todos',
        method: 'GET',
        config: {},
        _retry: false,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      const retryPromise = onRejected(error);

      expect(mockStorage.clearSession).not.toHaveBeenCalled();

      await retryPromise;

      expect(mockStorage.setAccessToken).toHaveBeenCalledWith('new-token');
      expect(mockStorage.setCurrentUser).toHaveBeenCalledWith(mockUser);
      expect(originalRequest._retry).toBe(true);
      expect(mockAxiosInstance).toHaveBeenCalledWith(originalRequest);
    });

    it('_retry flag guard rejects immediately without refresh', async () => {
      const originalRequest = {
        url: '/todos',
        method: 'GET',
        config: {},
        _retry: true,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      const promise = onRejected(error);

      await expect(promise).rejects.toBe(error);
      expect(mockStorage.setAccessToken).not.toHaveBeenCalled();
    });

    it('refreshInFlight deduplication: concurrent 401 errors call refresh once', async () => {
      const mockRefreshResponse = {
        data: {
          token: 'new-token',
          expires_in: 3600,
          user: mockUser,
        },
      };

      const refreshTokenMock = jest.fn().mockResolvedValue(mockRefreshResponse);

      (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
        refreshToken: refreshTokenMock,
      }));

      const originalRequest1 = {
        url: '/todos',
        method: 'GET',
        config: {},
        _retry: false,
      } as any;

      const originalRequest2 = {
        url: '/notes',
        method: 'GET',
        config: {},
        _retry: false,
      } as any;

      const error1 = new Error('Unauthorized') as any;
      error1.response = { status: 401 };
      error1.config = originalRequest1;

      const error2 = new Error('Unauthorized') as any;
      error2.response = { status: 401 };
      error2.config = originalRequest2;

      const promise1 = onRejected(error1);
      const promise2 = onRejected(error2);

      await Promise.all([promise1, promise2]);

      expect(refreshTokenMock).toHaveBeenCalledTimes(1);
      expect(originalRequest1._retry).toBe(true);
      expect(originalRequest2._retry).toBe(true);
    });

    it('auth URL exclusion: 401 on /auth/login rejects immediately', async () => {
      const originalRequest = {
        url: '/auth/login',
        method: 'POST',
        config: {},
        _retry: false,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      const promise = onRejected(error);

      await expect(promise).rejects.toBe(error);
      expect(mockStorage.setAccessToken).not.toHaveBeenCalled();
    });

    it('auth URL exclusion: 401 on /auth/refresh rejects immediately', async () => {
      const originalRequest = {
        url: '/auth/refresh',
        method: 'POST',
        config: {},
        _retry: false,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      const promise = onRejected(error);

      await expect(promise).rejects.toBe(error);
      expect(mockStorage.setAccessToken).not.toHaveBeenCalled();
    });

    it('session clear on refresh rejection: clearSession called before reject', async () => {
      const refreshError = Object.assign(new Error('Refresh rejected'), {
        response: { status: 401 },
      });

      (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
        refreshToken: jest.fn().mockRejectedValue(refreshError),
      }));

      const originalRequest = {
        url: '/todos',
        method: 'GET',
        config: {},
        _retry: false,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      const promise = onRejected(error);

      await expect(promise).rejects.toBe(refreshError);
      expect(mockStorage.clearSession).toHaveBeenCalled();
      expect(mockStorage.setAccessToken).not.toHaveBeenCalled();
    });

    it('non-401 error rejects immediately', async () => {
      const originalRequest = {
        url: '/todos',
        method: 'GET',
        config: {},
        _retry: false,
      } as any;

      const error = new Error('Server error') as any;
      error.response = { status: 500 };
      error.config = originalRequest;

      const promise = onRejected(error);

      await expect(promise).rejects.toBe(error);
      expect(mockStorage.setAccessToken).not.toHaveBeenCalled();
    });

    it('error with no config rejects immediately', async () => {
      const error = new Error('Network error') as any;
      error.response = { status: 401 };
      error.config = undefined;

      const promise = onRejected(error);

      await expect(promise).rejects.toBe(error);
      expect(mockStorage.setAccessToken).not.toHaveBeenCalled();
    });

    it('error with no response rejects immediately', async () => {
      const originalRequest = {
        url: '/todos',
        method: 'GET',
        config: {},
        _retry: false,
      } as any;

      const error = new Error('Network error') as any;
      error.response = undefined;
      error.config = originalRequest;

      const promise = onRejected(error);

      await expect(promise).rejects.toBe(error);
      expect(mockStorage.setAccessToken).not.toHaveBeenCalled();
    });

    it('replayed request with 304 does not clear session', async () => {
      const mockRefreshResponse = {
        data: {
          token: 'new-token',
          expires_in: 3600,
          user: mockUser,
        },
      };

      (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
        refreshToken: jest.fn().mockResolvedValue(mockRefreshResponse),
      }));

      const originalRequest = {
        url: '/vault-pull',
        method: 'GET',
        config: {},
        _retry: false,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      // Override the mock instance to reject with 304 on the replay
      const replayError = new Error('Not Modified') as any;
      replayError.response = { status: 304 };
      (mockAxiosInstance as any).mockRejectedValueOnce(replayError);

      // Rejects with the replay's own error object, not a substitute: the
      // interceptor returns the replayed promise untouched.
      await expect(onRejected(error)).rejects.toBe(replayError);
      expect(mockStorage.setAccessToken).toHaveBeenCalledWith('new-token');
      expect(mockStorage.clearSession).not.toHaveBeenCalled();
    });

    it('replayed request with 500 does not clear session', async () => {
      const mockRefreshResponse = {
        data: {
          token: 'new-token',
          expires_in: 3600,
          user: mockUser,
        },
      };

      (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
        refreshToken: jest.fn().mockResolvedValue(mockRefreshResponse),
      }));

      const originalRequest = {
        url: '/todos',
        method: 'GET',
        config: {},
        _retry: false,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      // Override the mock instance to reject with 500 on the replay
      const replayError = new Error('Internal Server Error') as any;
      replayError.response = { status: 500 };
      (mockAxiosInstance as any).mockRejectedValueOnce(replayError);

      // Rejects with the replay's own error object, not a substitute: the
      // interceptor returns the replayed promise untouched.
      await expect(onRejected(error)).rejects.toBe(replayError);
      // Refresh succeeded, so setAccessToken was called
      expect(mockStorage.setAccessToken).toHaveBeenCalledWith('new-token');
      // But session was not cleared despite replay rejection
      expect(mockStorage.clearSession).not.toHaveBeenCalled();
    });

    it('successful replay resolves with the replayed response', async () => {
      const mockRefreshResponse = {
        data: {
          token: 'new-token',
          expires_in: 3600,
          user: mockUser,
        },
      };

      (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
        refreshToken: jest.fn().mockResolvedValue(mockRefreshResponse),
      }));

      const originalRequest = {
        url: '/todos',
        method: 'GET',
        config: {},
        _retry: false,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      const replayResponse = { status: 200, data: { ok: true } };
      (mockAxiosInstance as any).mockResolvedValueOnce(replayResponse);

      const promise = onRejected(error);

      const result = await promise;

      expect(result).toBe(replayResponse);
      expect(mockStorage.setAccessToken).toHaveBeenCalledWith('new-token');
      expect(mockStorage.clearSession).not.toHaveBeenCalled();
    });

    it('setAuthorizationHeader: plain object headers updated to refreshed token', async () => {
      const mockRefreshResponse = {
        data: {
          token: 'new-token',
          expires_in: 3600,
          user: mockUser,
        },
      };

      (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
        refreshToken: jest.fn().mockResolvedValue(mockRefreshResponse),
      }));

      const originalRequest = {
        url: '/todos',
        method: 'GET',
        headers: {
          Authorization: 'Bearer expired-token',
          'Content-Type': 'application/json',
        },
        _retry: false,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      await onRejected(error);

      const replayCall = (mockAxiosInstance as any).mock.calls[0][0];
      expect(replayCall.headers.Authorization).toBe('Bearer new-token');
      expect(replayCall.headers['Content-Type']).toBe('application/json');
    });

    it('setAuthorizationHeader: AxiosHeaders with set method called with refreshed token', async () => {
      const mockRefreshResponse = {
        data: {
          token: 'new-token',
          expires_in: 3600,
          user: mockUser,
        },
      };

      (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
        refreshToken: jest.fn().mockResolvedValue(mockRefreshResponse),
      }));

      const setMock = jest.fn();
      const headersWithSet = {
        Authorization: 'Bearer expired-token',
        set: setMock,
      };

      const originalRequest = {
        url: '/todos',
        method: 'GET',
        headers: headersWithSet,
        _retry: false,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      await onRejected(error);

      expect(setMock).toHaveBeenCalledWith('Authorization', 'Bearer new-token');
      // Headers object identity should be preserved when set method exists
      const replayCall = (mockAxiosInstance as any).mock.calls[0][0];
      expect(replayCall.headers).toBe(headersWithSet);
    });

    it('setAuthorizationHeader: request with no headers creates Authorization header', async () => {
      const mockRefreshResponse = {
        data: {
          token: 'new-token',
          expires_in: 3600,
          user: mockUser,
        },
      };

      (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
        refreshToken: jest.fn().mockResolvedValue(mockRefreshResponse),
      }));

      const originalRequest = {
        url: '/todos',
        method: 'GET',
        _retry: false,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      await onRejected(error);

      const replayCall = (mockAxiosInstance as any).mock.calls[0][0];
      expect(replayCall.headers).toBeDefined();
      expect(replayCall.headers.Authorization).toBe('Bearer new-token');
    });

    it('setAuthorizationHeader: other headers survive replay with new Authorization', async () => {
      const mockRefreshResponse = {
        data: {
          token: 'new-token',
          expires_in: 3600,
          user: mockUser,
        },
      };

      (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
        refreshToken: jest.fn().mockResolvedValue(mockRefreshResponse),
      }));

      const originalRequest = {
        url: '/vault-pull',
        method: 'GET',
        headers: {
          Authorization: 'Bearer expired-token',
          'If-None-Match': '"abc123"',
          'Content-Type': 'application/json',
        },
        _retry: false,
      } as any;

      const error = new Error('Unauthorized') as any;
      error.response = { status: 401 };
      error.config = originalRequest;

      await onRejected(error);

      const replayCall = (mockAxiosInstance as any).mock.calls[0][0];
      expect(replayCall.headers.Authorization).toBe('Bearer new-token');
      expect(replayCall.headers['If-None-Match']).toBe('"abc123"');
      expect(replayCall.headers['Content-Type']).toBe('application/json');
    });

    describe('session-ended signal', () => {
      type RejectedRequest = { url: string; method: string; _retry: boolean };

      function unauthorized(url: string): Error & {
        response: { status: number };
        config: RejectedRequest;
      } {
        return Object.assign(new Error('Unauthorized'), {
          response: { status: 401 },
          config: { url, method: 'GET', _retry: false },
        });
      }

      function refreshFailsWith(failure: Error): jest.Mock {
        const refreshToken = jest.fn().mockRejectedValue(failure);
        (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
          refreshToken,
        }));
        return refreshToken;
      }

      it.each([401, 403, 404, 422])(
        'clears the session and fires when the refresh is rejected with %i',
        async (status) => {
          const refreshError = Object.assign(new Error('Refresh rejected'), {
            response: { status },
          });
          const refreshToken = refreshFailsWith(refreshError);

          await expect(onRejected(unauthorized('/todos'))).rejects.toBe(
            refreshError,
          );

          expect(refreshToken).toHaveBeenCalledTimes(1);
          expect(mockStorage.clearSession).toHaveBeenCalledTimes(1);
          expect(sessionEndedListener).toHaveBeenCalledTimes(1);
          expect(sessionEndedListener).toHaveBeenCalledWith({
            reason: 'refresh_rejected',
            owner: 'user-1',
          });
          expect(mockAxiosInstance).not.toHaveBeenCalled();
        },
      );

      it('has already cleared the session when the signal fires', async () => {
        refreshFailsWith(
          Object.assign(new Error('Refresh rejected'), {
            response: { status: 401 },
          }),
        );
        let clearedWhenSignalled: number | undefined;
        sessionEndedListener.mockImplementation(() => {
          clearedWhenSignalled = mockStorage.clearSession.mock.calls.length;
        });

        await expect(onRejected(unauthorized('/todos'))).rejects.toThrow(
          'Refresh rejected',
        );

        expect(clearedWhenSignalled).toBe(1);
      });

      it.each([
        ['a network failure with no response', new Error('Network Error')],
        [
          'a timeout with no response',
          Object.assign(new Error('timeout of 0ms exceeded'), {
            code: 'ECONNABORTED',
            isAxiosError: true,
          }),
        ],
        [
          'a server error',
          Object.assign(new Error('Internal Server Error'), {
            response: { status: 500 },
          }),
        ],
        [
          'a bad gateway',
          Object.assign(new Error('Bad gateway'), {
            response: { status: 502 },
          }),
        ],
        [
          'a service unavailable',
          Object.assign(new Error('Service unavailable'), {
            response: { status: 503 },
          }),
        ],
        [
          'a request timeout',
          Object.assign(new Error('Request timeout'), {
            response: { status: 408 },
          }),
        ],
        [
          'a rate limit',
          Object.assign(new Error('Too many requests'), {
            response: { status: 429 },
          }),
        ],
      ])(
        'keeps the session and does not fire when the refresh fails with %s',
        async (_l, failure) => {
          refreshFailsWith(failure);

          await expect(onRejected(unauthorized('/todos'))).rejects.toBe(
            failure,
          );

          // The server never refused the refresh, so the Session stays put
          // for a later attempt (#1082).
          expect(mockStorage.clearSession).not.toHaveBeenCalled();
          expect(mockStorage.setAccessToken).not.toHaveBeenCalled();
          expect(mockAxiosInstance).not.toHaveBeenCalled();
          expect(sessionEndedListener).not.toHaveBeenCalled();
        },
      );

      it('keeps the session when concurrent requests share one refresh that fails with no response', async () => {
        const failure = new Error('Network Error');
        const refreshToken = refreshFailsWith(failure);

        const results = await Promise.allSettled([
          onRejected(unauthorized('/todos')),
          onRejected(unauthorized('/notes')),
        ]);

        expect(results).toEqual([
          { status: 'rejected', reason: failure },
          { status: 'rejected', reason: failure },
        ]);
        expect(refreshToken).toHaveBeenCalledTimes(1);
        expect(mockStorage.clearSession).not.toHaveBeenCalled();
        expect(sessionEndedListener).not.toHaveBeenCalled();
      });

      it('a 401 after a refresh that could not complete tries the refresh again and replays with the new token', async () => {
        let refreshAttempts = 0;
        const refreshToken = jest.fn().mockImplementation(() => {
          refreshAttempts += 1;
          return refreshAttempts === 1
            ? Promise.reject(new Error('Network Error'))
            : Promise.resolve({
                data: { token: 'new-token', expires_in: 3600, user: mockUser },
              });
        });
        (AuthenticationApi as jest.Mock).mockImplementation(() => ({
          refreshToken,
        }));
        const replayResponse = { status: 200, data: { ok: true } };
        (mockAxiosInstance as any).mockResolvedValue(replayResponse);

        await expect(onRejected(unauthorized('/todos'))).rejects.toThrow(
          'Network Error',
        );
        expect(mockStorage.clearSession).not.toHaveBeenCalled();

        const retried = unauthorized('/todos');
        await expect(onRejected(retried)).resolves.toBe(replayResponse);

        expect(refreshToken).toHaveBeenCalledTimes(2);
        expect(mockStorage.setAccessToken).toHaveBeenCalledWith('new-token');
        expect(mockStorage.clearSession).not.toHaveBeenCalled();
        expect(sessionEndedListener).not.toHaveBeenCalled();
        expect(mockAxiosInstance).toHaveBeenCalledWith(retried.config);
        expect(retried.config).toMatchObject({
          headers: { Authorization: 'Bearer new-token' },
        });
      });

      it('fires once when concurrent requests share one rejected refresh', async () => {
        const refreshError = Object.assign(new Error('Refresh rejected'), {
          response: { status: 401 },
        });
        const refreshToken = refreshFailsWith(refreshError);

        const results = await Promise.allSettled([
          onRejected(unauthorized('/todos')),
          onRejected(unauthorized('/notes')),
        ]);

        expect(results).toEqual([
          { status: 'rejected', reason: refreshError },
          { status: 'rejected', reason: refreshError },
        ]);
        expect(refreshToken).toHaveBeenCalledTimes(1);
        expect(sessionEndedListener).toHaveBeenCalledTimes(1);
        expect(sessionEndedListener).toHaveBeenCalledWith({
          reason: 'refresh_rejected',
          owner: 'user-1',
        });
      });

      it('does not fire when the refresh succeeds', async () => {
        (AuthenticationApi as jest.Mock).mockImplementationOnce(() => ({
          refreshToken: jest.fn().mockResolvedValue({
            data: { token: 'new-token', expires_in: 3600, user: mockUser },
          }),
        }));

        await onRejected(unauthorized('/todos'));

        expect(mockStorage.clearSession).not.toHaveBeenCalled();
        expect(sessionEndedListener).not.toHaveBeenCalled();
      });

      it('carries the User signed in before the clear when the refresh is rejected', async () => {
        let currentUser: typeof mockUser | undefined = mockUser;
        mockStorage.getCurrentUser.mockImplementation(() => currentUser);
        mockStorage.clearSession.mockImplementation(() => {
          currentUser = undefined;
        });
        refreshFailsWith(
          Object.assign(new Error('Refresh rejected'), {
            response: { status: 403 },
          }),
        );

        await expect(onRejected(unauthorized('/todos'))).rejects.toThrow(
          'Refresh rejected',
        );

        expect(mockStorage.clearSession).toHaveBeenCalledTimes(1);
        expect(sessionEndedListener).toHaveBeenCalledTimes(1);
        expect(sessionEndedListener).toHaveBeenCalledWith({
          reason: 'refresh_rejected',
          owner: 'user-1',
        });
      });

      it('carries no owner when no User is stored', async () => {
        mockStorage.getCurrentUser.mockReturnValue(undefined);
        refreshFailsWith(
          Object.assign(new Error('Refresh rejected'), {
            response: { status: 401 },
          }),
        );

        await expect(onRejected(unauthorized('/todos'))).rejects.toThrow(
          'Refresh rejected',
        );

        expect(mockStorage.clearSession).toHaveBeenCalledTimes(1);
        expect(sessionEndedListener).toHaveBeenCalledTimes(1);
        expect(sessionEndedListener.mock.calls[0][0].reason).toBe(
          'refresh_rejected',
        );
        expect(sessionEndedListener.mock.calls[0][0].owner).toBeUndefined();
      });
    });
  });

  describe('getAuthApi', () => {
    it('returns AuthenticationApi instance', () => {
      const api = adapter.getAuthApi();

      expect(AuthenticationApi).toHaveBeenCalled();
      expect(api).toBeDefined();
    });

    it('passes axios instance to AuthenticationApi', () => {
      adapter.getAuthAxios();
      adapter.getAuthApi();

      const callArgs = (AuthenticationApi as jest.Mock).mock.calls[0];
      expect(callArgs[2]).toBe(mockAxiosInstance);
    });
  });
});

jest.mock('@myorganiser/app-api-client');
jest.mock('@myorganiser/core');

import type { AuthSessionModule } from './auth-session-module';
import { createAuthSessionModule } from './auth-session-module';
import type { AuthSessionStorageAdapter } from './auth-session-storage-adapter';
import type { AuthSessionTransportAdapter } from './auth-session-transport-adapter';
import type { AuthUser } from './auth-session-types';
import { createSessionEndedSignal } from './session-ended-signal';

describe('createAuthSessionModule', () => {
  let mockStorage: jest.Mocked<AuthSessionStorageAdapter>;
  let mockTransport: jest.Mocked<AuthSessionTransportAdapter>;
  let module: AuthSessionModule;

  const mockUser: AuthUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    role: 'user',
    disabled: false,
  };

  function httpError(status: number): Error & { response: { status: number } } {
    return Object.assign(new Error(`Request failed with status ${status}`), {
      response: { status },
    });
  }

  const mockSessionData = {
    token: 'access-token-123',
    expiresIn: 600000,
    user: mockUser,
  };

  beforeEach(() => {
    mockStorage = {
      getAccessToken: jest.fn(),
      setAccessToken: jest.fn(),
      getCurrentUser: jest.fn(),
      setCurrentUser: jest.fn(),
      clearSession: jest.fn(),
    };

    mockTransport = {
      getAuthAxios: jest.fn(),
      getAuthApi: jest.fn().mockReturnValue({
        login: jest.fn(),
        registerUser: jest.fn(),
        refreshToken: jest.fn(),
        logout: jest.fn(),
        resendVerificationEmail: jest.fn(),
        resetPassword: jest.fn(),
        confirmResetPassword: jest.fn(),
      }),
    };

    module = createAuthSessionModule({
      storage: mockStorage,
      transport: mockTransport,
    });
  });

  describe('getSnapshot', () => {
    it('returns authenticated when token and user both exist', () => {
      mockStorage.getAccessToken.mockReturnValue('token-123');
      mockStorage.getCurrentUser.mockReturnValue(mockUser);

      const snapshot = module.getSnapshot();

      expect(snapshot).toEqual({ status: 'authenticated' });
    });

    it('returns restorable when a token exists but the user is gone', () => {
      mockStorage.getAccessToken.mockReturnValue('token-123');
      mockStorage.getCurrentUser.mockReturnValue(undefined);

      const snapshot = module.getSnapshot();

      expect(snapshot).toEqual({ status: 'restorable' });
    });

    it('returns restorable when user exists but no token', () => {
      mockStorage.getAccessToken.mockReturnValue(undefined);
      mockStorage.getCurrentUser.mockReturnValue(mockUser);

      const snapshot = module.getSnapshot();

      expect(snapshot).toEqual({ status: 'restorable' });
    });

    it('returns guest when neither token nor user exist', () => {
      mockStorage.getAccessToken.mockReturnValue(undefined);
      mockStorage.getCurrentUser.mockReturnValue(undefined);

      const snapshot = module.getSnapshot();

      expect(snapshot).toEqual({ status: 'guest' });
    });
  });

  describe('restoreSession', () => {
    it('returns authenticated without refreshing when token and user both exist', async () => {
      mockStorage.getAccessToken.mockReturnValue('token-123');
      mockStorage.getCurrentUser.mockReturnValue(mockUser);
      const listener = jest.fn();
      module.onSessionEnded(listener);

      const result = await module.restoreSession();

      expect(result).toEqual({ kind: 'authenticated' });
      expect(mockTransport.getAuthApi().refreshToken).not.toHaveBeenCalled();
      expect(mockStorage.clearSession).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    });

    it('refreshes a token that has no user and returns authenticated with the user stored', async () => {
      mockStorage.getAccessToken.mockReturnValue('stale-tab-token');
      mockStorage.getCurrentUser.mockReturnValue(undefined);
      const refreshToken = mockTransport.getAuthApi().refreshToken as jest.Mock;
      refreshToken.mockResolvedValue({ data: mockSessionData });
      const listener = jest.fn();
      module.onSessionEnded(listener);

      const result = await module.restoreSession();

      expect(result).toEqual({ kind: 'authenticated' });
      expect(refreshToken).toHaveBeenCalledTimes(1);
      expect(refreshToken).toHaveBeenCalledWith({ refreshTokenBody: {} });
      expect(mockStorage.setAccessToken).toHaveBeenCalledWith(
        mockSessionData.token,
      );
      expect(mockStorage.setCurrentUser).toHaveBeenCalledTimes(1);
      expect(mockStorage.setCurrentUser).toHaveBeenCalledWith(mockUser);
      expect(mockStorage.clearSession).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    });

    it.each([401, 403, 422])(
      'clears a token that has no user and signals session ended when refresh is rejected with %i',
      async (status) => {
        mockStorage.getAccessToken.mockReturnValue('stale-tab-token');
        mockStorage.getCurrentUser.mockReturnValue(undefined);
        const refreshToken = mockTransport.getAuthApi()
          .refreshToken as jest.Mock;
        refreshToken.mockRejectedValue(httpError(status));
        const listener = jest.fn();
        module.onSessionEnded(listener);

        const result = await module.restoreSession();

        expect(result).toEqual({ kind: 'session_cleared' });
        expect(refreshToken).toHaveBeenCalledTimes(1);
        expect(mockStorage.clearSession).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith({ reason: 'refresh_rejected' });
      },
    );

    it('signals session ended when a user without a token is refused a refresh', async () => {
      mockStorage.getAccessToken.mockReturnValue(undefined);
      mockStorage.getCurrentUser.mockReturnValue(mockUser);
      (mockTransport.getAuthApi().refreshToken as jest.Mock).mockRejectedValue(
        httpError(401),
      );
      const listener = jest.fn();
      module.onSessionEnded(listener);

      const result = await module.restoreSession();

      expect(result).toEqual({ kind: 'session_cleared' });
      expect(mockStorage.clearSession).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ reason: 'refresh_rejected' });
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
      ['a service unavailable', httpError(503)],
      ['a rate limit', httpError(429)],
    ])(
      'keeps the stored session and returns not_restored when refresh cannot be completed (%s)',
      async (_label, failure) => {
        mockStorage.getAccessToken.mockReturnValue('stale-tab-token');
        mockStorage.getCurrentUser.mockReturnValue(undefined);
        (
          mockTransport.getAuthApi().refreshToken as jest.Mock
        ).mockRejectedValue(failure);
        const listener = jest.fn();
        module.onSessionEnded(listener);

        const result = await module.restoreSession();

        // Only a refusal by the server ends the Session (#1082). A refresh
        // that never got an answer leaves it for a later attempt.
        expect(result).toEqual({ kind: 'not_restored' });
        expect(mockStorage.clearSession).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
      },
    );

    it('returns session_cleared when no token and no user', async () => {
      mockStorage.getAccessToken.mockReturnValue(undefined);
      mockStorage.getCurrentUser.mockReturnValue(undefined);

      const result = await module.restoreSession();

      expect(result).toEqual({ kind: 'session_cleared' });
    });

    it('refreshes and returns authenticated when user exists', async () => {
      mockStorage.getAccessToken.mockReturnValue(undefined);
      mockStorage.getCurrentUser.mockReturnValue(mockUser);

      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.refreshToken as jest.Mock).mockResolvedValue({
        data: mockSessionData,
      });

      const result = await module.restoreSession();

      expect(result).toEqual({ kind: 'authenticated' });
      expect(mockStorage.setAccessToken).toHaveBeenCalledWith(
        mockSessionData.token,
      );
      expect(mockStorage.setCurrentUser).toHaveBeenCalledWith(
        mockSessionData.user,
      );
    });

    it('clears session and returns session_cleared when the refresh is rejected', async () => {
      mockStorage.getAccessToken.mockReturnValue(undefined);
      mockStorage.getCurrentUser.mockReturnValue(mockUser);

      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.refreshToken as jest.Mock).mockRejectedValue(httpError(401));

      const result = await module.restoreSession();

      expect(result).toEqual({ kind: 'session_cleared' });
      expect(mockStorage.clearSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('signIn', () => {
    it('returns ok:true with session data on successful login', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.login as jest.Mock).mockResolvedValue({
        data: mockSessionData,
      });

      const result = await module.signIn({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.token).toBe(mockSessionData.token);
        expect(result.value.user).toEqual(mockSessionData.user);
      }
      expect(mockStorage.setAccessToken).toHaveBeenCalledWith(
        mockSessionData.token,
        'session',
      );
      expect(mockStorage.setCurrentUser).toHaveBeenCalledWith(
        mockSessionData.user,
      );
    });

    it('sets token to local storage when rememberMe is true', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.login as jest.Mock).mockResolvedValue({
        data: mockSessionData,
      });

      await module.signIn({
        email: 'test@example.com',
        password: 'password123',
        rememberMe: true,
      });

      expect(mockStorage.setAccessToken).toHaveBeenCalledWith(
        mockSessionData.token,
        'local',
      );
    });

    it('sets token to session storage when rememberMe is false', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.login as jest.Mock).mockResolvedValue({
        data: mockSessionData,
      });

      await module.signIn({
        email: 'test@example.com',
        password: 'password123',
        rememberMe: false,
      });

      expect(mockStorage.setAccessToken).toHaveBeenCalledWith(
        mockSessionData.token,
        'session',
      );
    });

    it('returns ok:false with error on login failure', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.login as jest.Mock).mockRejectedValue(
        new Error('Login failed'),
      );

      const result = await module.signIn({
        email: 'test@example.com',
        password: 'wrongpassword',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeDefined();
        expect(result.error.message).toBeDefined();
      }
      expect(mockStorage.setAccessToken).not.toHaveBeenCalled();
    });

    it('does not throw on error — returns typed outcome', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.login as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      const result = await module.signIn({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('signOut', () => {
    it('calls logout API and clears session when user exists', async () => {
      mockStorage.getCurrentUser.mockReturnValue(mockUser);

      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.logout as jest.Mock).mockResolvedValue(undefined);

      const result = await module.signOut();

      expect(result).toEqual({ kind: 'signed_out' });
      expect(mockAuthApi.logout).toHaveBeenCalledWith({ userId: mockUser.id });
      expect(mockStorage.clearSession).toHaveBeenCalled();
    });

    it('clears session without API call when no user', async () => {
      mockStorage.getCurrentUser.mockReturnValue(undefined);

      const result = await module.signOut();

      expect(result).toEqual({ kind: 'signed_out' });
      const mockAuthApi = mockTransport.getAuthApi();
      expect(mockAuthApi.logout).not.toHaveBeenCalled();
      expect(mockStorage.clearSession).toHaveBeenCalled();
    });

    it('still clears session if logout API fails', async () => {
      mockStorage.getCurrentUser.mockReturnValue(mockUser);

      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.logout as jest.Mock).mockRejectedValue(
        new Error('API error'),
      );

      const result = await module.signOut();

      expect(result).toEqual({ kind: 'signed_out' });
      expect(mockStorage.clearSession).toHaveBeenCalled();
    });
  });

  describe('signUp', () => {
    it('returns ok:true with message and user on successful signup', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.registerUser as jest.Mock).mockResolvedValue({
        data: {
          message: 'Verification email sent. Please check your inbox.',
          user: mockUser,
        },
      });

      const result = await module.signUp({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.message).toContain('Verification email sent');
      }
    });

    it('includes phone in request when provided', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.registerUser as jest.Mock).mockResolvedValue({
        data: {
          message: 'Verification email sent',
          user: mockUser,
        },
      });

      await module.signUp({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        password: 'password123',
        phone: '+1234567890',
      });

      expect(mockAuthApi.registerUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userCreationBody: expect.objectContaining({
            phone: '+1234567890',
          }),
        }),
      );
    });

    it('returns ok:false with error on signup failure', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.registerUser as jest.Mock).mockRejectedValue(
        new Error('Signup failed'),
      );

      const result = await module.signUp({
        firstName: 'Test',
        lastName: 'User',
        email: 'existing@example.com',
        password: 'password123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeDefined();
        expect(result.error.message).toBeDefined();
      }
    });
  });

  describe('refreshAccessToken', () => {
    it('returns ok:true with updated session data on success', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.refreshToken as jest.Mock).mockResolvedValue({
        data: mockSessionData,
      });

      const result = await module.refreshAccessToken();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.token).toBe(mockSessionData.token);
        expect(result.value.user).toEqual(mockSessionData.user);
      }
      expect(mockStorage.setAccessToken).toHaveBeenCalledWith(
        mockSessionData.token,
      );
      expect(mockStorage.setCurrentUser).toHaveBeenCalledWith(
        mockSessionData.user,
      );
    });

    it('returns ok:false with error on refresh failure', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.refreshToken as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      const result = await module.refreshAccessToken();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeDefined();
        expect(result.error.message).toBeDefined();
      }
    });

    it('does not throw on error — returns typed outcome', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.refreshToken as jest.Mock).mockRejectedValue(
        new Error('Unexpected error'),
      );

      const result = await module.refreshAccessToken();

      expect(result.ok).toBe(false);
    });

    it('refreshAccessToken reports a refused refresh without ending the session', async () => {
      const sessionEnded = createSessionEndedSignal();
      module = createAuthSessionModule({
        storage: mockStorage,
        transport: mockTransport,
        sessionEnded,
      });
      const listener = jest.fn();
      const unsubscribe = module.onSessionEnded(listener);
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.refreshToken as jest.Mock).mockRejectedValue(httpError(401));

      const result = await module.refreshAccessToken();

      expect(result.ok).toBe(false);
      expect(mockStorage.clearSession).not.toHaveBeenCalled();
      expect(mockStorage.setAccessToken).not.toHaveBeenCalled();
      expect(mockStorage.setCurrentUser).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    });
  });

  describe('resendVerificationEmail', () => {
    it('returns ok:true with message on success', async () => {
      const mockAxios = { post: jest.fn() };
      mockTransport.getAuthAxios.mockReturnValue(
        mockAxios as unknown as ReturnType<typeof mockTransport.getAuthAxios>,
      );

      mockAxios.post.mockResolvedValue({
        data: { message: 'Verification email resent' },
      });

      const result = await module.resendVerificationEmail('test@example.com');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.message).toContain('resent');
      }
      expect(mockAxios.post).toHaveBeenCalledWith('/auth/verify/resend', {
        email: 'test@example.com',
      });
    });

    it('returns ok:false with error on failure', async () => {
      const mockAxios = { post: jest.fn() };
      mockTransport.getAuthAxios.mockReturnValue(
        mockAxios as unknown as ReturnType<typeof mockTransport.getAuthAxios>,
      );

      mockAxios.post.mockRejectedValue(new Error('Request failed'));

      const result = await module.resendVerificationEmail('test@example.com');

      expect(result.ok).toBe(false);
    });

    // #1239: the server's JSON body message must reach the user, not axios's
    // generic transport text. Real axios errors carry `isAxiosError: true`,
    // which the production `axios.isAxiosError()` check requires.
    it('surfaces the server body message on a rate-limited resend', async () => {
      const mockAxios = { post: jest.fn() };
      mockTransport.getAuthAxios.mockReturnValue(
        mockAxios as unknown as ReturnType<typeof mockTransport.getAuthAxios>,
      );

      const serverMessage =
        'A verification email was already sent recently. Please check your inbox and try again later.';
      mockAxios.post.mockRejectedValue({
        isAxiosError: true,
        message: 'Request failed with status code 429',
        response: { status: 429, data: { message: serverMessage } },
      });

      const result = await module.resendVerificationEmail('test@example.com');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe(serverMessage);
      }
    });

    it('falls back to the clear resend message, not transport text, when the response has no body message', async () => {
      const mockAxios = { post: jest.fn() };
      mockTransport.getAuthAxios.mockReturnValue(
        mockAxios as unknown as ReturnType<typeof mockTransport.getAuthAxios>,
      );

      mockAxios.post.mockRejectedValue({
        isAxiosError: true,
        message: 'Request failed with status code 500',
        response: { status: 500, data: {} },
      });

      const result = await module.resendVerificationEmail('test@example.com');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe(
          'Unable to resend the verification email. Please try again.',
        );
        expect(result.error.message).not.toContain(
          'Request failed with status code',
        );
      }
    });

    it('preserves the network error message for a request that never got a response', async () => {
      const mockAxios = { post: jest.fn() };
      mockTransport.getAuthAxios.mockReturnValue(
        mockAxios as unknown as ReturnType<typeof mockTransport.getAuthAxios>,
      );

      mockAxios.post.mockRejectedValue({
        isAxiosError: true,
        message: 'Network Error',
      });

      const result = await module.resendVerificationEmail('test@example.com');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Network Error');
        expect(result.error.code).toBe('network_error');
      }
    });
  });

  describe('requestPasswordReset', () => {
    it('returns ok:true with response data on success', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.resetPassword as jest.Mock).mockResolvedValue({
        data: { message: 'Reset email sent', status: 200 },
      });

      const result = await module.requestPasswordReset({
        email: 'test@example.com',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.message).toContain('Reset email sent');
      }
    });

    it('returns ok:false with error on failure', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.resetPassword as jest.Mock).mockRejectedValue({
        response: {
          data: { message: 'Email not found' },
        },
      });

      const result = await module.requestPasswordReset({
        email: 'nonexistent@example.com',
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('confirmPasswordReset', () => {
    it('returns ok:true on successful reset', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.confirmResetPassword as jest.Mock).mockResolvedValue({
        data: { message: 'Password reset successfully', status: 200 },
      });

      const result = await module.confirmPasswordReset({
        token: 'reset-token-123',
        password: 'newpassword',
        confirmPassword: 'newpassword',
      });

      expect(result.ok).toBe(true);
    });

    it('passes confirm_password with underscore to API', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.confirmResetPassword as jest.Mock).mockResolvedValue({
        data: { message: 'Success', status: 200 },
      });

      await module.confirmPasswordReset({
        token: 'reset-token-123',
        password: 'newpassword',
        confirmPassword: 'newpassword',
      });

      expect(mockAuthApi.confirmResetPassword).toHaveBeenCalledWith(
        expect.objectContaining({
          confirmResetPasswordBody: expect.objectContaining({
            confirm_password: 'newpassword',
          }),
        }),
      );
    });

    it('returns ok:false with error on failure', async () => {
      const mockAuthApi = mockTransport.getAuthApi();
      (mockAuthApi.confirmResetPassword as jest.Mock).mockRejectedValue({
        response: {
          data: { message: 'Invalid or expired token' },
        },
      });

      const result = await module.confirmPasswordReset({
        token: 'bad-token',
        password: 'newpassword',
        confirmPassword: 'newpassword',
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('onSessionEnded', () => {
    it('stops notifying a listener once it unsubscribes', async () => {
      mockStorage.getAccessToken.mockReturnValue('stale-tab-token');
      mockStorage.getCurrentUser.mockReturnValue(undefined);
      (mockTransport.getAuthApi().refreshToken as jest.Mock).mockRejectedValue(
        httpError(401),
      );
      const kept = jest.fn();
      const dropped = jest.fn();
      module.onSessionEnded(kept);
      const unsubscribe = module.onSessionEnded(dropped);

      unsubscribe();
      await module.restoreSession();

      expect(kept).toHaveBeenCalledTimes(1);
      expect(kept).toHaveBeenCalledWith({ reason: 'refresh_rejected' });
      expect(dropped).not.toHaveBeenCalled();
    });

    it('does not fire for an explicit signOut by this window', async () => {
      mockStorage.getCurrentUser.mockReturnValue(mockUser);
      (mockTransport.getAuthApi().logout as jest.Mock).mockResolvedValue({});
      const listener = jest.fn();
      module.onSessionEnded(listener);

      await module.signOut();

      expect(mockStorage.clearSession).toHaveBeenCalledTimes(1);
      expect(listener).not.toHaveBeenCalled();
    });

    it('notifies subscribers when the injected signal emits refresh_rejected', () => {
      const sessionEnded = createSessionEndedSignal();
      module = createAuthSessionModule({
        storage: mockStorage,
        transport: mockTransport,
        sessionEnded,
      });
      const listener = jest.fn();
      module.onSessionEnded(listener);

      sessionEnded.emit({ reason: 'refresh_rejected' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ reason: 'refresh_rejected' });
    });

    describe('when another window signs out', () => {
      let signedOutElsewhere: () => void;
      let stopWatching: jest.Mock<void, []>;
      let watch: jest.Mock<() => void, [() => void]>;

      beforeEach(() => {
        stopWatching = jest.fn();
        watch = jest.fn((listener: () => void) => {
          signedOutElsewhere = listener;
          return stopWatching;
        });
        mockStorage.onSignedOutElsewhere = watch;
      });

      it('does not watch storage until something subscribes', () => {
        expect(watch).not.toHaveBeenCalled();

        module.onSessionEnded(jest.fn());
        module.onSessionEnded(jest.fn());

        expect(watch).toHaveBeenCalledTimes(1);
        expect(watch).toHaveBeenCalledWith(expect.any(Function));
      });

      it('clears this window and signals session ended', () => {
        const listener = jest.fn();
        module.onSessionEnded(listener);

        signedOutElsewhere();

        expect(mockStorage.clearSession).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith({
          reason: 'signed_out_elsewhere',
        });
      });

      it('stops watching storage when the last listener unsubscribes', () => {
        const first = module.onSessionEnded(jest.fn());
        const second = module.onSessionEnded(jest.fn());

        first();
        expect(stopWatching).not.toHaveBeenCalled();

        second();
        second();
        expect(stopWatching).toHaveBeenCalledTimes(1);

        module.onSessionEnded(jest.fn());
        expect(watch).toHaveBeenCalledTimes(2);
      });
    });

    it('subscribes on a storage adapter that cannot watch other windows', () => {
      const listener = jest.fn();

      const unsubscribe = module.onSessionEnded(listener);

      expect(() => unsubscribe()).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('direct access methods', () => {
    it('getAccessToken returns storage value', () => {
      mockStorage.getAccessToken.mockReturnValue('token-123');

      expect(module.getAccessToken()).toBe('token-123');
    });

    it('getCurrentUser returns storage value', () => {
      mockStorage.getCurrentUser.mockReturnValue(mockUser);

      expect(module.getCurrentUser()).toEqual(mockUser);
    });

    it('getAuthAxios returns transport instance', () => {
      const mockAxios = { get: jest.fn() };
      mockTransport.getAuthAxios.mockReturnValue(
        mockAxios as unknown as ReturnType<typeof mockTransport.getAuthAxios>,
      );

      expect(module.getAuthAxios()).toBe(mockAxios);
    });

    it('getAuthApi returns transport api', () => {
      const mockAuthApi = mockTransport.getAuthApi();

      expect(module.getAuthApi()).toBe(mockAuthApi);
    });
  });
});

import type {
  AuthenticationApi,
  ConfirmResetPasswordBody,
} from '@myorganiser/app-api-client';
import axios, { type AxiosInstance } from 'axios';

import { toAuthErrorFromMessage } from './auth-error-mapping';
import type { AuthSessionStorageAdapter } from './auth-session-storage-adapter';
import { createBrowserAuthSessionStorageAdapter } from './auth-session-storage-adapter';
import type { AuthSessionTransportAdapter } from './auth-session-transport-adapter';
import { createAuthSessionTransportAdapter } from './auth-session-transport-adapter';
import type {
  AuthSessionData,
  PasswordResetConfirmOutcome,
  PasswordResetRequestOutcome,
  ResendVerificationOutcome,
  RestoreSessionOutcome,
  SessionSnapshot,
  SignInOutcome,
  SignOutOutcome,
  SignUpOutcome,
  AuthOperationResult,
} from './auth-session-types';
import {
  buildLoginUserBody,
  buildRefreshTokenRequest,
} from './refresh-client-contract';
import { isRefreshRejectedByServer } from './refresh-rejection';
import {
  createSessionEndedSignal,
  type SessionEndedListener,
  type SessionEndedSignal,
} from './session-ended-signal';

function toSessionData(
  response: import('@myorganiser/app-api-client').Login200Response,
): AuthSessionData {
  return {
    token: response.token,
    expiresIn: response.expires_in,
    user: response.user,
  };
}

// The server's own body message, when the error is an axios error carrying one.
function extractBodyMessage(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  const data = err.response?.data as { message?: string } | undefined;
  return data?.message && typeof data.message === 'string'
    ? data.message
    : undefined;
}

function extractMessage(err: unknown): string {
  if (!axios.isAxiosError(err)) return 'Unexpected error.';
  return extractBodyMessage(err) ?? (err.message || 'Request failed.');
}

const RESEND_VERIFICATION_FALLBACK_MESSAGE =
  'Unable to resend the verification email. Please try again.';

// Reads the server's body message first, like `extractMessage`. Differs only
// in its fallback: a response with no body message falls back to this clear
// message rather than axios's own "Request failed with status code …", which
// is what #1239 showed the user. A request that never got a response (a
// network error) still surfaces `err.message` so it keeps classifying as
// `network_error`.
function extractResendErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err)) return RESEND_VERIFICATION_FALLBACK_MESSAGE;
  const bodyMessage = extractBodyMessage(err);
  if (bodyMessage) return bodyMessage;
  if (!err.response) {
    return err.message || RESEND_VERIFICATION_FALLBACK_MESSAGE;
  }
  return RESEND_VERIFICATION_FALLBACK_MESSAGE;
}

export interface AuthSessionModule {
  getSnapshot(): SessionSnapshot;
  restoreSession(): Promise<RestoreSessionOutcome>;
  signOut(): Promise<SignOutOutcome>;
  signIn(args: {
    email: string;
    password: string;
    rememberMe?: boolean;
  }): Promise<SignInOutcome>;
  signUp(args: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    phone?: string;
  }): Promise<SignUpOutcome>;
  resendVerificationEmail(email: string): Promise<ResendVerificationOutcome>;
  requestPasswordReset(args: {
    email: string;
  }): Promise<PasswordResetRequestOutcome>;
  confirmPasswordReset(args: {
    token: string;
    password: string;
    confirmPassword: string;
  }): Promise<PasswordResetConfirmOutcome>;
  refreshAccessToken(): Promise<AuthOperationResult<AuthSessionData>>;
  getAccessToken(): string | undefined;
  getCurrentUser(): ReturnType<AuthSessionStorageAdapter['getCurrentUser']>;
  getAuthAxios(): AxiosInstance;
  getAuthApi(): AuthenticationApi;
  /**
   * Subscribe to the Session ending without this window asking for it: the
   * server refused a token refresh (a 4xx other than 408 or 429), or another window of
   * this browser signed out. The Session is already cleared when the listener
   * runs. Returns the function that unsubscribes.
   *
   * Does not fire for this window's own `signOut()`, nor for a refresh that
   * failed without an answer from the server.
   */
  onSessionEnded(listener: SessionEndedListener): () => void;
}

export function createAuthSessionModule(deps: {
  storage: AuthSessionStorageAdapter;
  transport: AuthSessionTransportAdapter;
  /**
   * The signal the transport reports a refused refresh on. Pass the one the
   * transport was built with so `onSessionEnded` hears the interceptor too.
   */
  sessionEnded?: SessionEndedSignal;
}): AuthSessionModule {
  const { storage, transport } = deps;
  const sessionEnded = deps.sessionEnded ?? createSessionEndedSignal();
  let subscriberCount = 0;
  let stopWatchingOtherWindows: (() => void) | null = null;

  function handleSignedOutElsewhere(): void {
    // The other window removed the shared user; what is left here is at most
    // this window's own access token, which is no longer a Session.
    storage.clearSession();
    sessionEnded.emit({ reason: 'signed_out_elsewhere' });
  }

  async function refreshSessionViaTransport(): Promise<AuthSessionData> {
    const res = await transport.getAuthApi().refreshToken({
      refreshTokenBody: buildRefreshTokenRequest('web'),
    });
    const session = toSessionData(res.data);
    storage.setAccessToken(session.token);
    storage.setCurrentUser(session.user);
    return session;
  }

  return {
    // A Session is an access token *and* its user. The two live in different
    // stores — the token can be per-window (`sessionStorage`), the user is
    // shared (`localStorage`) — so a sign-out in another window leaves this
    // one holding a token with no user. Either half alone is only
    // `restorable`: the server decides, through a refresh, whether it is one.
    getSnapshot(): SessionSnapshot {
      const hasToken = Boolean(storage.getAccessToken());
      const hasUser = Boolean(storage.getCurrentUser());

      if (hasToken && hasUser) {
        return { status: 'authenticated' };
      }
      if (hasToken || hasUser) {
        return { status: 'restorable' };
      }
      return { status: 'guest' };
    },

    async restoreSession(): Promise<RestoreSessionOutcome> {
      const hasToken = Boolean(storage.getAccessToken());
      const hasUser = Boolean(storage.getCurrentUser());

      if (hasToken && hasUser) {
        return { kind: 'authenticated' };
      }

      if (!hasToken && !hasUser) {
        return { kind: 'session_cleared' };
      }

      try {
        await refreshSessionViaTransport();
        return { kind: 'authenticated' };
      } catch (err) {
        // A refresh that could not be completed is no evidence the Session
        // ended; leave what is stored for the next attempt (#1082).
        if (!isRefreshRejectedByServer(err)) {
          return { kind: 'not_restored' };
        }
        storage.clearSession();
        sessionEnded.emit({ reason: 'refresh_rejected' });
        return { kind: 'session_cleared' };
      }
    },

    async signOut(): Promise<SignOutOutcome> {
      const user = storage.getCurrentUser();
      if (!user?.id) {
        storage.clearSession();
        return { kind: 'signed_out' };
      }

      try {
        await transport.getAuthApi().logout({ userId: user.id });
      } catch {
        // API call may fail — still clear local session
      } finally {
        storage.clearSession();
      }

      return { kind: 'signed_out' };
    },

    async signIn(args): Promise<SignInOutcome> {
      try {
        const res = await transport.getAuthApi().login({
          userLoginBody: buildLoginUserBody(
            {
              email: args.email,
              password: args.password,
            },
            'web',
          ),
        });

        const session = toSessionData(res.data);
        storage.setAccessToken(
          session.token,
          args.rememberMe ? 'local' : 'session',
        );
        storage.setCurrentUser(session.user);
        return { ok: true, value: session };
      } catch (err) {
        return {
          ok: false,
          error: toAuthErrorFromMessage(extractMessage(err)),
        };
      }
    },

    async signUp(args): Promise<SignUpOutcome> {
      try {
        const res = await transport.getAuthApi().registerUser({
          userCreationBody: {
            firstName: args.firstName,
            lastName: args.lastName,
            email: args.email,
            password: args.password,
            ...(args.phone ? { phone: args.phone } : {}),
          },
        });

        const data = res.data as
          | { message: string; user?: AuthSessionData['user'] }
          | AuthSessionData['user'];

        if (data && typeof data === 'object' && 'message' in data) {
          return {
            ok: true,
            value: {
              message: data.message,
              user: data.user,
            },
          };
        }

        return {
          ok: true,
          value: {
            message: 'Verification email sent. Please check your inbox.',
            user: data as AuthSessionData['user'],
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: toAuthErrorFromMessage(extractMessage(err)),
        };
      }
    },

    async resendVerificationEmail(
      email: string,
    ): Promise<ResendVerificationOutcome> {
      try {
        const res = await transport.getAuthAxios().post('/auth/verify/resend', {
          email,
        });
        return { ok: true, value: res.data as { message: string } };
      } catch (err) {
        return {
          ok: false,
          error: toAuthErrorFromMessage(extractResendErrorMessage(err)),
        };
      }
    },

    async requestPasswordReset(args): Promise<PasswordResetRequestOutcome> {
      try {
        const res = await transport.getAuthApi().resetPassword({
          resetPasswordByEmailBody: {
            email: args.email,
          },
        });
        return { ok: true, value: res.data };
      } catch (err) {
        return {
          ok: false,
          error: toAuthErrorFromMessage(extractMessage(err)),
        };
      }
    },

    async confirmPasswordReset(args): Promise<PasswordResetConfirmOutcome> {
      try {
        const body: ConfirmResetPasswordBody = {
          token: args.token,
          password: args.password,
          confirm_password: args.confirmPassword,
        };

        const res = await transport.getAuthApi().confirmResetPassword({
          confirmResetPasswordBody: body,
        });

        return { ok: true, value: res.data };
      } catch (err) {
        return {
          ok: false,
          error: toAuthErrorFromMessage(extractMessage(err)),
        };
      }
    },

    async refreshAccessToken(): Promise<AuthOperationResult<AuthSessionData>> {
      try {
        const session = await refreshSessionViaTransport();
        return { ok: true, value: session };
      } catch (err) {
        return {
          ok: false,
          error: toAuthErrorFromMessage(extractMessage(err)),
        };
      }
    },

    getAccessToken: () => storage.getAccessToken(),
    getCurrentUser: () => storage.getCurrentUser(),
    getAuthAxios: () => transport.getAuthAxios(),
    getAuthApi: () => transport.getAuthApi(),

    onSessionEnded(listener: SessionEndedListener): () => void {
      const unsubscribe = sessionEnded.subscribe(listener);
      subscriberCount += 1;
      // Watch other windows only while something is listening, so creating a
      // module — which happens at import — registers nothing on its own.
      if (subscriberCount === 1) {
        stopWatchingOtherWindows =
          storage.onSignedOutElsewhere?.(handleSignedOutElsewhere) ?? null;
      }

      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        unsubscribe();
        subscriberCount -= 1;
        if (subscriberCount === 0) {
          stopWatchingOtherWindows?.();
          stopWatchingOtherWindows = null;
        }
      };
    },
  };
}

export function createDefaultAuthSessionModule(): AuthSessionModule {
  const storage = createBrowserAuthSessionStorageAdapter();
  const sessionEnded = createSessionEndedSignal();
  const transport = createAuthSessionTransportAdapter(storage, {
    sessionEnded,
  });
  return createAuthSessionModule({ storage, transport, sessionEnded });
}

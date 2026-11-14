import { AuthenticationApi, Configuration } from '@myorganiser/app-api-client';
import { getApiBaseUrl } from '@myorganiser/core';
import axios, { type AxiosError, type AxiosInstance } from 'axios';

import type { AuthSessionStorageAdapter } from './auth-session-storage-adapter';
import type { AuthSessionData } from './auth-session-types';
import {
  buildRefreshTokenRequest,
  shouldSendCredentials,
} from './refresh-client-contract';
import { isRefreshRejectedByServer } from './refresh-rejection';
import type { SessionEndedSignal } from './session-ended-signal';

export interface AuthSessionTransportAdapter {
  getAuthAxios(): AxiosInstance;
  getAuthApi(): AuthenticationApi;
}

function toSessionData(
  response: import('@myorganiser/app-api-client').Login200Response,
): AuthSessionData {
  return {
    token: response.token,
    expiresIn: response.expires_in,
    user: response.user,
  };
}

/**
 * Put `token` on a request config that is about to be replayed.
 *
 * Written for both header shapes rather than one: axios hands an
 * `AxiosHeaders` instance to a real interceptor, while a plain object is what
 * a config built by hand carries. Assigning through `set` where it exists
 * keeps the normalized casing AxiosHeaders maintains.
 */
function setAuthorizationHeader(
  request: { headers?: unknown },
  token: string,
): void {
  const value = `Bearer ${token}`;
  const headers = request.headers as
    | { set?: (name: string, value: string) => void }
    | undefined;

  if (typeof headers?.set === 'function') {
    headers.set('Authorization', value);
    return;
  }

  request.headers = { ...(headers ?? {}), Authorization: value };
}

export function createAuthSessionTransportAdapter(
  storage: AuthSessionStorageAdapter,
  options: { sessionEnded?: SessionEndedSignal } = {},
): AuthSessionTransportAdapter {
  const { sessionEnded } = options;
  let sharedAxios: AxiosInstance | null = null;
  let refreshInFlight: Promise<AuthSessionData> | null = null;

  function isAuthUrl(url: string | undefined): boolean {
    if (!url) return false;
    return (
      url.includes('/auth/login') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/register') ||
      url.includes('/auth/verify/resend')
    );
  }

  async function refreshSession(): Promise<AuthSessionData> {
    const api = getAuthApi();
    const res = await api.refreshToken({
      refreshTokenBody: buildRefreshTokenRequest('web'),
    });
    const session = toSessionData(res.data);
    storage.setAccessToken(session.token);
    storage.setCurrentUser(session.user);
    return session;
  }

  function getAuthAxios(): AxiosInstance {
    if (sharedAxios) return sharedAxios;

    const baseURL = getApiBaseUrl();
    const instance = axios.create({
      baseURL,
      withCredentials: shouldSendCredentials('web'),
    });

    instance.interceptors.response.use(
      (res) => res,
      async (error: AxiosError) => {
        const status = error.response?.status;
        const originalRequest = error.config as
          | (typeof error.config & { _retry?: boolean })
          | null;

        if (!originalRequest || status !== 401) {
          return Promise.reject(error);
        }

        if (originalRequest._retry) {
          return Promise.reject(error);
        }

        if (isAuthUrl(originalRequest.url)) {
          return Promise.reject(error);
        }

        originalRequest._retry = true;

        // The replay sits outside the try so that only a rejected *refresh*
        // can clear the Session. It already behaved that way — `return promise`
        // inside a try is not awaited there, so the replay's rejection never
        // reached the catch — but that is a subtlety one `await` would undo.
        // Writing `return await instance(...)` here would start signing Users
        // out for any replayed request that did not return 2xx, and axios
        // counts an ordinary 304 among those. The tests pin this.
        let refreshed: AuthSessionData;
        try {
          if (!refreshInFlight) {
            refreshInFlight = refreshSession();
          }
          refreshed = await refreshInFlight;
          refreshInFlight = null;
        } catch (refreshErr) {
          // Every request that waited on one refresh lands here with the same
          // error; only the one that still finds it in flight reports it, so
          // a burst of 401s ends the Session once.
          const firstToSeeFailure = refreshInFlight !== null;
          refreshInFlight = null;
          // Only a refusal by the server ends the Session. A refresh that got
          // no answer, a 5xx, 408 or 429 keeps it (#1082): the request rejects
          // with the refresh's own error and the next 401 asks again.
          if (isRefreshRejectedByServer(refreshErr)) {
            const owner = storage.getCurrentUser()?.id;
            storage.clearSession();
            if (firstToSeeFailure) {
              sessionEnded?.emit({ reason: 'refresh_rejected', owner });
            }
          }
          return Promise.reject(refreshErr);
        }

        // The replayed config still carries the Authorization header the
        // generated client baked in when it built the request, and that is
        // the token that just expired — `setBearerAuthToObject` resolves
        // `accessToken()` once, at build time, not per attempt. Replaying it
        // unchanged sends the expired token again, earns a second 401, and
        // `_retry` then makes that one final.
        //
        // A caller that latches on a 401 never recovers from it. That is what
        // the Vault Sync Queue does — a 401 sets `sessionEnded`, which only a
        // User-initiated retry lifts — so a device coming back online after
        // more than one access-token lifetime would report the Session as
        // ended and stop syncing, with the refresh having quietly succeeded.
        setAuthorizationHeader(originalRequest, refreshed.token);

        return instance(originalRequest);
      },
    );

    sharedAxios = instance;
    return instance;
  }

  function getAuthApi(): AuthenticationApi {
    const configuration = new Configuration({
      basePath: getApiBaseUrl(),
      accessToken: () => storage.getAccessToken() ?? '',
    });

    return new AuthenticationApi(configuration, undefined, getAuthAxios());
  }

  return {
    getAuthAxios,
    getAuthApi,
  };
}

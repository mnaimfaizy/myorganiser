import {
  Configuration,
  YouTubeApi,
  type YouTubeAccessState,
} from '@myorganiser/app-api-client';
import { getAccessToken, getAuthAxios } from '@myorganiser/auth';
import { getApiBaseUrl } from '@myorganiser/core';

export type { YouTubeAccessState } from '@myorganiser/app-api-client';

/** The signed-in User's own YouTube Access, from `GET /youtube/access`. */
export interface YouTubeAccess {
  state: YouTubeAccessState;
  /** ISO time a Platform Admin withdrew access; set only for `withdrawn`, and only when the date was recorded. */
  withdrawnAt: string | null;
}

/**
 * One availability answer. `available` is true only when the global switch is
 * on AND the User holds YouTube Access. `access` is null when the switch is
 * off, because the access signal is not asked then.
 */
export interface YouTubeAvailability {
  available: boolean;
  access: YouTubeAccess | null;
}

/**
 * Whether YouTube exists for the signed-in User (ADR 0129): the global
 * availability report says the feature is on AND the User holds YouTube
 * Access. The access check runs only when the switch is on, because the
 * access signal itself 404s while the switch is off.
 */
export async function getYouTubeAvailability(): Promise<YouTubeAvailability> {
  const api = new YouTubeApi(new Configuration({ basePath: getApiBaseUrl() }));
  const response = await api.getAvailability();

  if (response.data.available !== true) {
    return { available: false, access: null };
  }

  const access = await getYouTubeAccess();
  return { available: access.state === 'granted', access };
}

/** The signed-in User's own YouTube Access, from `GET /youtube/access`. */
export async function getYouTubeAccess(): Promise<YouTubeAccess> {
  const api = new YouTubeApi(
    new Configuration({
      basePath: getApiBaseUrl(),
      accessToken: () => getAccessToken() ?? '',
    }),
    undefined,
    getAuthAxios(),
  );
  const { data } = await api.getAccess();

  if (data.granted === true) {
    return { state: 'granted', withdrawnAt: null };
  }
  if (data.state === 'withdrawn') {
    return { state: 'withdrawn', withdrawnAt: data.withdrawnAt ?? null };
  }
  return { state: 'not_granted', withdrawnAt: null };
}

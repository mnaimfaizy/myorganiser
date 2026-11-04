import { Configuration, YouTubeApi } from '@myorganiser/app-api-client';
import { getAccessToken, getAuthAxios } from '@myorganiser/auth';
import { getApiBaseUrl } from '@myorganiser/core';

/**
 * The generated `YouTubeApi`, signed with the Session's access token. The
 * shared auth axios instance refreshes the token and replays a 401 once.
 */
export function createYouTubeApi(): YouTubeApi {
  return new YouTubeApi(
    new Configuration({
      basePath: getApiBaseUrl(),
      accessToken: () => getAccessToken() ?? '',
    }),
    undefined,
    getAuthAxios(),
  );
}

/** The generated `YouTubeApi` for endpoints that carry no Session (an emailed link). */
export function createAnonymousYouTubeApi(): YouTubeApi {
  return new YouTubeApi(new Configuration({ basePath: getApiBaseUrl() }));
}

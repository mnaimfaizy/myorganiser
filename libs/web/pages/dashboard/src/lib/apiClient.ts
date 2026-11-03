import {
  Configuration,
  FeedbackApi,
  YouTubeApi,
  type ConfigurationParameters,
} from '@myorganiser/app-api-client';
import { getAccessToken, getAuthAxios } from '@myorganiser/auth';
import { getApiBaseUrl } from '@myorganiser/core';

export function createApiConfiguration(
  overrides: Partial<ConfigurationParameters> = {},
): Configuration {
  return new Configuration({
    basePath: getApiBaseUrl(),
    accessToken: () => getAccessToken() ?? '',
    ...overrides,
  });
}

export function createFeedbackApi(): FeedbackApi {
  return new FeedbackApi(createApiConfiguration(), undefined, getAuthAxios());
}

export function createYouTubeApi(): YouTubeApi {
  return new YouTubeApi(createApiConfiguration(), undefined, getAuthAxios());
}

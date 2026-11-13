import {
  Configuration,
  VaultApi,
  VaultBackupsApi,
  type ConfigurationParameters,
} from '@myorganiser/app-api-client';
import { getAccessToken, getAuthAxios } from '@myorganiser/auth';
import { getApiBaseUrl } from '@myorganiser/core';

import { shareInFlightVaultReads } from './vault/serverVaultSync';

export function createApiConfiguration(
  overrides: Partial<ConfigurationParameters> = {},
): Configuration {
  // Pass `accessToken` as a function so the latest value is read on each
  // request (covers token refresh and the localStorage/sessionStorage split
  // between "remember me" and "session-only" modes).
  return new Configuration({
    basePath: getApiBaseUrl(),
    accessToken: () => getAccessToken() ?? '',
    ...overrides,
  });
}

export function createVaultApi(): VaultApi {
  // Use getAuthAxios() so the 401→refresh interceptor handles expired tokens.
  return new VaultApi(createApiConfiguration(), undefined, getAuthAxios());
}

/**
 * A Vault API for `owner` whose unconditional reads of Vault Meta and of the
 * Vault Blob Inventory share one wire request with an identical read already
 * in flight for the same owner (#1489). See `shareInFlightVaultReads`.
 *
 * The dashboard's mount-time runners (Vault Reconcile, Vault Meta convergence
 * and the Vault Pull trigger) each build their api here, so the rule is held
 * in one place.
 */
export function createSharedVaultApi(owner: string) {
  return shareInFlightVaultReads(createVaultApi(), owner);
}

/** Query parameters of `getLatestBackup`, as the generated client types them. */
export type GetLatestBackupParams = NonNullable<
  Parameters<VaultBackupsApi['getLatestBackup']>[0]
>;

export function createVaultBackupsApi(): VaultBackupsApi {
  return new VaultBackupsApi(
    createApiConfiguration(),
    undefined,
    getAuthAxios(),
  );
}

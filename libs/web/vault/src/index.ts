export * from './lib/apiClient';
export * from './lib/cloud';
export * from './lib/http/getHttpStatus';
export * from './lib/vault/auditReporter';
export * from './lib/vault/contactRecordNormalization';
export * from './lib/vault/crypto';
export * from './lib/vault/groceriesNormalization';
export * from './lib/vault/replayTracker';
export * from './lib/vault/serverVaultSync';
export * from './lib/vault/subscriptionRecordNormalization';
export * from './lib/vault/taskNormalization';
// The Vault Handle, and the errors it throws, are the whole public surface of
// per-User Local Vault storage. Storage keys and record shapes stay internal:
// publishing them would hand a consumer a way to read a Vault without naming
// an owner, which is the property ADR 0047 exists to keep.
export {
  VaultLockedError,
  VaultSecretMismatchError,
  VaultWriteContendedError,
  createVaultHandle,
} from './lib/vault/vaultHandle';
export type {
  LocalVaultStatus,
  VaultHandle,
  VaultSyncSink,
} from './lib/vault/vaultHandle';
export * from './lib/vault/localVaultRevision';
export * from './lib/vault/passphrasePolicy';
// The Passkey Unlock policy and its browser Platform Adapter. The wrapping
// record's storage stays internal: every function here names an owner first,
// for the same reason the Vault Handle does (ADR 0047, ADR 0136).
export {
  PASSKEY_PRF_OUTPUT_LENGTH,
  PASSKEY_USER_VERIFICATION,
  canOfferPasskeyUnlock,
  disablePasskeyUnlock,
  enrolPasskeyUnlock,
  isPasskeyUnlockEnrolled,
  PasskeyCredentialGoneError,
  recordPasskeyUnlockOffered,
  unlockWithPasskey,
} from './lib/vault/passkeyUnlock';
export { masterKeyOpensLocalVault } from './lib/vault/masterKeyOpensLocalVault';
export {
  checkMasterKeyAgainstServerVault,
  masterKeyOpensVault,
  SERVER_CHECK_TIMEOUT_MS,
  type ServerMasterKeyCheck,
} from './lib/vault/masterKeyOpensVault';
export type {
  PasskeyAssertionRequest,
  PasskeyAssertionResult,
  PasskeyCreationRequest,
  PasskeyCreationResult,
  PasskeyEnrolmentOutcome,
  PasskeyPlatform,
  PasskeyUnlockOutcome,
} from './lib/vault/passkeyUnlock';
export { createBrowserPasskeyPlatform } from './lib/vault/passkeyPlatform';
// The mint only. `rotateRecoveryKeyWithPassphrase` is exported with the other
// wrapping changes from `vaultMetaPush`, and the Local Vault write it reaches
// stays behind the Vault Handle (ADR 0047).
export * from './lib/vault/recoveryKeyMint';
export * from './lib/vault/vaultAbsentEvidence';
export * from './lib/vault/vaultClaimEvidence';
export * from './lib/vault/vaultConverge';
export * from './lib/vault/vaultImportDisclosure';
export * from './lib/vault/vaultMetaConverge';
export * from './lib/vault/vaultMetaPush';
// The question and the lifetime only. Vault Meta Refusal storage keys and
// record shapes stay internal for the same reason Local Vault ones do: what a
// caller needs is the Vault Handle's `isVaultMetaRefused` /
// `recordVaultMetaRefusal`, and these two are what it cannot ask for without a
// word for them.
export type {
  VaultMetaQuestion,
  VaultMetaRefusalLifetime,
} from './lib/vault/vaultMetaRefusal';
export * from './lib/vault/vaultSyncFailure';
export * from './lib/vault/vaultSyncQueue';
export * from './lib/vault/vaultSyncStatus';
export * from './lib/vault/vaultPullCheck';
export * from './lib/vault/vaultPullTrigger';
export * from './lib/vault/vaultExportImport';
export * from './lib/vault/vaultReconcile';
export * from './lib/vault/vaultRecordWrite';
export * from './lib/vault/vaultBlobFields';
export * from './lib/vault/vaultShapes';

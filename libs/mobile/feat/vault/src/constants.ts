// The mobile half of the shared crypto suite (ADR 0039).
//
// PBKDF2_ITERATIONS is the only constant here with a TypeScript consumer:
// context/VaultSessionContext.tsx falls back to it when the server's vault meta
// omits an iteration count. Nothing gates it — cryptoCompatibility.test.ts
// re-declares its own literals rather than importing these.
export const PBKDF2_ITERATIONS = 310_000;

// The four below have no TypeScript consumer and are still not dead.
// tools/scripts/check-vault-pages.ts pins these four names to this exact path and
// asserts the KDF and cipher figures on the docs/vault/*.html pages against them,
// so deleting one fails `yarn vault:pages:check`. Issue #485 removed this file's
// one genuinely dead constant and deliberately kept these.
export const PBKDF2_HASH = 'SHA-256';
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;
export const MASTER_KEY_LENGTH = 32;

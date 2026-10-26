/**
 * Produces a fresh Escape Copy with the real exporter, for the gate to open
 * with the real reader.
 *
 * [ADR 0064](../../../../docs/adr/0064-an-escape-copy-is-opened-by-a-tool-that-needs-nothing-of-ours.md)'s
 * second decision is that a gate asserts the reader still opens a *freshly
 * produced* envelope — "a reader pinned to a schema version the exporter has
 * moved past is worse than no reader: it fails at the only moment anyone runs
 * it, and it fails silently until then". A fixture envelope checked into the
 * repository would not assert that, because a fixture moves when somebody
 * remembers to move it. So this calls `exportVault` — the function the Export
 * button and the Drive backup both call — and hands the gate whatever it
 * produces today.
 *
 * It is not application code and ships in nothing: `tools/scripts/check-escape-copy-reader.ts`
 * bundles this file for Node, runs it, and throws the result away.
 */
import {
  aesGcmEncrypt,
  bytesToBase64,
  deriveKeyFromPassphrase,
  importAesGcmKey,
  randomBytes,
  utf8ToBytes,
} from '@myorganiser/vault-core';
import { VAULT_BLOB_FIELDS, exportVault } from '@myorganiser/web-vault';

/**
 * The KDF iteration count this harness wraps its throwaway Master Key at.
 *
 * Pinned here rather than read from the app, and deliberately not a claim
 * about the app's number. The gate asserts a round-trip — what the exporter
 * put in is what the reader gets back — and the reader takes the iteration
 * count off the envelope it is handed rather than from a constant of its own
 * ([ADR 0051](../../../../docs/adr/0051-a-pinned-value-does-not-notice-that-its-meaning-moved.md)),
 * so this number moving or not moving cannot make that round-trip pass
 * falsely. The app's real parameters are held by
 * `libs/vault-core/src/lib/cryptoCompatibility.test.ts`, which is where
 * [ADR 0039](../../../../docs/adr/0039-web-and-mobile-vaults-share-one-crypto-suite.md)
 * pins them for web and mobile alike.
 *
 * Kept low-drama on purpose: raising it slows every gate run by the same
 * factor and asserts nothing extra.
 */
const ITERATIONS = 310_000;

async function encrypt(key: CryptoKey, value: unknown) {
  const iv = randomBytes(12);
  const ciphertext = await aesGcmEncrypt({
    key,
    plaintext: utf8ToBytes(JSON.stringify(value)),
    iv,
  });
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) };
}

/**
 * A Local Vault carrying every Vault Blob Type, built with the real crypto.
 *
 * The fan-out reaches `VAULT_BLOB_FIELDS` rather than naming the five members,
 * so a sixth Vault Blob Type is carried into the gate's envelope the moment it
 * exists ([ADR 0053](../../../../docs/adr/0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md)).
 * That is what makes the gate catch a reader that silently skips one: the
 * envelope it is handed always contains all of them.
 */
async function mintLocalVault(options: { passphrase: string; marker: string }) {
  const salt = randomBytes(16);
  const masterKeyBytes = randomBytes(32);
  const masterKey = await importAesGcmKey(masterKeyBytes);
  const recoveryKeyBytes = randomBytes(32);

  const passphraseKey = await deriveKeyFromPassphrase({
    passphrase: options.passphrase,
    salt,
    iterations: ITERATIONS,
  });

  const data: Record<string, unknown> = {};
  const expected: Record<string, unknown> = {};
  for (const field of Object.values(VAULT_BLOB_FIELDS)) {
    const payload = {
      records: [{ id: `${field}-1`, marker: `${options.marker}:${field}` }],
    };
    expected[field] = payload;
    data[field] = await encrypt(masterKey, payload);
  }

  const wrapIv = randomBytes(12);
  const recoveryIv = randomBytes(12);

  const localVault = {
    version: 1 as const,
    kdf: {
      name: 'PBKDF2' as const,
      hash: 'SHA-256' as const,
      iterations: ITERATIONS,
      salt: bytesToBase64(salt),
    },
    masterKeyWrappedWithPassphrase: {
      iv: bytesToBase64(wrapIv),
      ciphertext: bytesToBase64(
        await aesGcmEncrypt({
          key: passphraseKey,
          plaintext: masterKeyBytes,
          iv: wrapIv,
        }),
      ),
    },
    masterKeyWrappedWithRecoveryKey: {
      iv: bytesToBase64(recoveryIv),
      ciphertext: bytesToBase64(
        await aesGcmEncrypt({
          key: await importAesGcmKey(recoveryKeyBytes),
          plaintext: masterKeyBytes,
          iv: recoveryIv,
        }),
      ),
    },
    data,
  };

  return {
    localVault,
    expected,
    recoveryKey: bytesToBase64(recoveryKeyBytes),
  };
}

export interface FreshEscapeCopy {
  /** The envelope text, exactly as the Export button would download it. */
  text: string;
  passphrase: string;
  recoveryKey: string;
  /** The plaintext the reader must yield, keyed by Vault Blob Type. */
  expected: Record<string, unknown>;
  schemaVersion: number;
}

/**
 * Mint a vault and export it through `exportVault`, the one function both the
 * local-file Export and the Drive backup run. The two produce the identical
 * envelope, so opening this one is opening both.
 */
export async function mintFreshEscapeCopy(): Promise<FreshEscapeCopy> {
  const passphrase = ['gate', 'fresh', 'envelope', String(Date.now())].join(
    '-',
  );
  const marker = `gate-${Date.now()}`;
  const minted = await mintLocalVault({ passphrase, marker });

  const { text, envelope } = await exportVault({
    localVault: minted.localVault as Parameters<
      typeof exportVault
    >[0]['localVault'],
    source: 'local-file',
  });

  return {
    text,
    passphrase,
    recoveryKey: minted.recoveryKey,
    expected: minted.expected,
    schemaVersion: envelope.schemaVersion,
  };
}

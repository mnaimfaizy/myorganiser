import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  deriveQaKeyMaterial,
  deriveQaSecrets,
  localDatabaseRefusal,
  parseQaAccountsArgs,
  qaAccountsProblem,
  qaUserDrift,
  readQaAccounts,
  vaultMetaMatches,
  type QaAccountRecord,
} from './qa-accounts.ts';
import { loadQaVaultMint } from './qa-vault-mint.ts';

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

const ANY_PHRASE = 'any phrase 1';

interface QaVaultMetaWrap {
  version: number;
  iv: string;
  ciphertext: string;
}

interface QaVaultMeta {
  version: number;
  wrapped_mk_passphrase: QaVaultMetaWrap;
  wrapped_mk_recovery: QaVaultMetaWrap;
  [key: string]: unknown;
}

interface QaVaultMint {
  mintQaVaultMeta(input: {
    passphrase: string;
    keys: ReturnType<typeof deriveQaKeyMaterial>;
  }): Promise<QaVaultMeta>;
  openQaVaultMeta(input: {
    meta: QaVaultMeta;
    recoveryKey: string;
    passphrase: string;
    keys: ReturnType<typeof deriveQaKeyMaterial>;
  }): Promise<{ byPassphrase: string; byRecoveryKey: string }>;
  qaVaultBlobOpens(input: {
    masterKey: string;
    blob: QaVaultMetaWrap | null;
  }): Promise<boolean>;
}

const account = (
  overrides: Partial<QaAccountRecord> = {},
): QaAccountRecord => ({
  id: 'primary',
  email: 'qa-primary@myorganizer.test',
  firstName: 'QA',
  lastName: 'Primary',
  ...overrides,
});

describe('localDatabaseRefusal', () => {
  const local = 'postgresql://localhost:5453/myorganiser';

  it('allows a database on this machine', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      assert.equal(
        localDatabaseRefusal({
          databaseUrl: `postgresql://${host}:5453/db`,
          nodeEnv: 'development',
        }),
        null,
      );
    }
    assert.equal(
      localDatabaseRefusal({ databaseUrl: local, nodeEnv: undefined }),
      null,
    );
  });

  it('refuses a remote host', () => {
    assert.match(
      localDatabaseRefusal({
        databaseUrl: 'postgresql://db.example.com:5432/app',
        nodeEnv: 'development',
      })!,
      /not this machine/,
    );
  });

  it('refuses a host that only starts like a local one', () => {
    assert.match(
      localDatabaseRefusal({
        databaseUrl: 'postgresql://localhost.example.com/app',
        nodeEnv: 'development',
      })!,
      /"localhost\.example\.com" is not this machine/,
    );
  });

  it('refuses a local URL whose host parameter points elsewhere', () => {
    assert.match(
      localDatabaseRefusal({
        databaseUrl: `${local}?host=db.example.com`,
        nodeEnv: 'development',
      })!,
      /host parameter/,
    );
  });

  it('refuses production even on a local host', () => {
    assert.match(
      localDatabaseRefusal({ databaseUrl: local, nodeEnv: 'production' })!,
      /production/,
    );
  });

  it('refuses a missing, unparseable, or non-postgres URL', () => {
    for (const databaseUrl of [
      undefined,
      '',
      'not a url',
      'mysql://localhost/db',
    ]) {
      assert.notEqual(
        localDatabaseRefusal({ databaseUrl, nodeEnv: 'development' }),
        null,
      );
    }
  });
});

describe('qaAccountsProblem', () => {
  it('accepts the tracked table and gives each account its derived secrets', () => {
    const accounts = readQaAccounts(workspaceRoot);
    assert.ok(accounts.length >= 2);
    for (const { id, password, vaultPassphrase } of accounts) {
      assert.deepEqual({ password, vaultPassphrase }, deriveQaSecrets(id));
    }
  });

  it('refuses an address off the reserved test domain', () => {
    assert.match(
      qaAccountsProblem([account({ email: 'qa@example.com' })])!,
      /@myorganizer\.test/,
    );
  });

  it('refuses a duplicate id or email, a missing field, and an empty table', () => {
    assert.match(qaAccountsProblem([account(), account()])!, /two accounts/);
    assert.match(
      qaAccountsProblem([account(), account({ id: 'other' })])!,
      /two accounts/,
    );
    assert.match(qaAccountsProblem([account({ lastName: '' })])!, /lastName/);
    assert.notEqual(qaAccountsProblem([]), null);
  });
});

describe('deriveQaSecrets', () => {
  it('is fixed for an id, differs between ids, and never reuses a value', () => {
    const primary = deriveQaSecrets('primary');
    const secondary = deriveQaSecrets('secondary');
    assert.deepEqual(primary, deriveQaSecrets('primary'));
    assert.equal(
      new Set([
        primary.password,
        primary.vaultPassphrase,
        secondary.password,
        secondary.vaultPassphrase,
      ]).size,
      4,
    );
  });

  it('gives values the web client accepts and the secret scan lets through', () => {
    for (const value of Object.values(deriveQaSecrets('primary'))) {
      // At least the web client's passphrase minimum, and under the sixteen
      // characters at which the secret-scan hook refuses a quoted literal.
      assert.match(value, /^[a-z]{2}-[0-9a-f]{12}$/);
      assert.ok(value.length >= 10 && value.length <= 15);
    }
  });
});

describe('deriveQaKeyMaterial', () => {
  it('is fixed for an id and differs between ids', () => {
    assert.deepEqual(
      deriveQaKeyMaterial('primary'),
      deriveQaKeyMaterial('primary'),
    );
    assert.notEqual(
      deriveQaKeyMaterial('primary').masterKey,
      deriveQaKeyMaterial('secondary').masterKey,
    );
  });

  it('gives a 44-character Recovery Key and keys of the lengths the vault uses', () => {
    const keys = deriveQaKeyMaterial('primary');
    const bytes = (value: string): number =>
      Buffer.from(value, 'base64').length;
    assert.equal(keys.recoveryKey.length, 44);
    assert.equal(bytes(keys.recoveryKey), 32);
    assert.equal(bytes(keys.masterKey), 32);
    assert.equal(bytes(keys.salt), 16);
    assert.equal(bytes(keys.passphraseIv), 12);
    assert.equal(bytes(keys.recoveryIv), 12);
    assert.notEqual(keys.masterKey, keys.recoveryKey);
    assert.notEqual(keys.passphraseIv, keys.recoveryIv);
  });
});

describe('vaultMetaMatches', () => {
  const meta = {
    version: 1,
    kdf_name: 'PBKDF2',
    kdf_salt: 'c2FsdA==',
    kdf_params: { hash: 'SHA-256', iterations: 310000 },
    wrapped_mk_passphrase: { version: 1, iv: 'aQ==', ciphertext: 'Yw==' },
    wrapped_mk_recovery: { version: 1, iv: 'ag==', ciphertext: 'ZA==' },
  };

  it('matches a stored row whatever its key order or extra columns', () => {
    assert.equal(
      vaultMetaMatches(
        {
          id: 'row',
          userId: 'user',
          updatedAt: new Date(),
          ...meta,
          kdf_params: { iterations: 310000, hash: 'SHA-256' },
        },
        meta,
      ),
      true,
    );
  });

  it('does not match a missing row or a changed wrap', () => {
    assert.equal(vaultMetaMatches(null, meta), false);
    assert.equal(
      vaultMetaMatches(
        {
          ...meta,
          wrapped_mk_passphrase: { version: 1, iv: 'aQ==', ciphertext: 'WA==' },
        },
        meta,
      ),
      false,
    );
  });
});

describe('qaUserDrift', () => {
  const seeded = {
    email_verification_timestamp: new Date(),
    email_verification_token: null,
    disabled: false,
    youtube_access: true,
    youtube_access_first_granted_at: new Date(),
  };

  it('finds nothing to write on a User still on the fixture', () => {
    assert.deepEqual(qaUserDrift({ user: seeded, passwordMatches: true }), []);
  });

  it('names youtube_access when a User lacks access or a first-granted date', () => {
    assert.deepEqual(
      qaUserDrift({
        user: { ...seeded, youtube_access: false },
        passwordMatches: true,
      }),
      ['youtube_access'],
    );
    assert.deepEqual(
      qaUserDrift({
        user: { ...seeded, youtube_access_first_granted_at: null },
        passwordMatches: true,
      }),
      ['youtube_access'],
    );
  });

  it('names each thing that moved', () => {
    assert.deepEqual(qaUserDrift({ user: seeded, passwordMatches: false }), [
      'password',
    ]);
    assert.deepEqual(
      qaUserDrift({
        user: { ...seeded, email_verification_timestamp: null },
        passwordMatches: true,
      }),
      ['verification'],
    );
    assert.deepEqual(
      qaUserDrift({
        user: { ...seeded, email_verification_token: 'pending' },
        passwordMatches: true,
      }),
      ['verification'],
    );
    assert.deepEqual(
      qaUserDrift({
        user: { ...seeded, disabled: true },
        passwordMatches: false,
      }),
      ['password', 'disabled'],
    );
  });
});

describe('parseQaAccountsArgs', () => {
  it('prints by default and reads seed flags', () => {
    assert.equal(parseQaAccountsArgs([]).command, 'print');
    assert.deepEqual(
      parseQaAccountsArgs(['seed', '--restore', '--account', 'primary']),
      { command: 'seed', restore: true, account: 'primary', error: null },
    );
  });

  it('names what it does not know', () => {
    assert.match(parseQaAccountsArgs(['wipe']).error!, /unknown command/);
    assert.match(parseQaAccountsArgs(['seed', '--force']).error!, /--force/);
    assert.match(
      parseQaAccountsArgs(['print', '--restore']).error!,
      /--restore/,
    );
  });
});

describe('the minted vault', () => {
  it('opens by passphrase and by Recovery Key, and mints the same twice', async () => {
    const mint = (await loadQaVaultMint(workspaceRoot)) as QaVaultMint;
    for (const { id, vaultPassphrase } of readQaAccounts(workspaceRoot)) {
      const keys = deriveQaKeyMaterial(id);
      const minted = { passphrase: vaultPassphrase, keys };
      const mistyped = { passphrase: vaultPassphrase + 'x', keys };
      const meta = await mint.mintQaVaultMeta(minted);

      assert.deepEqual(
        await mint.openQaVaultMeta({
          meta,
          recoveryKey: keys.recoveryKey,
          ...minted,
        }),
        { byPassphrase: keys.masterKey, byRecoveryKey: keys.masterKey },
      );
      assert.deepEqual(await mint.mintQaVaultMeta(minted), meta);
      assert.equal(meta.version, 1);
      assert.equal(meta.wrapped_mk_passphrase.version, 1);
      assert.equal(meta.wrapped_mk_recovery.version, 1);
      await assert.rejects(
        mint.openQaVaultMeta({
          meta,
          recoveryKey: keys.recoveryKey,
          ...mistyped,
        }),
      );
    }
  });

  it('tells a Vault Blob its Master Key opens from one it does not', async () => {
    const mint = (await loadQaVaultMint(workspaceRoot)) as QaVaultMint;
    const keys = deriveQaKeyMaterial('primary');
    const meta = await mint.mintQaVaultMeta({
      passphrase: ANY_PHRASE,
      keys,
    });

    // The recovery wrap is ciphertext under the Recovery Key, not the Master Key.
    assert.equal(
      await mint.qaVaultBlobOpens({
        masterKey: keys.recoveryKey,
        blob: meta.wrapped_mk_recovery,
      }),
      true,
    );
    assert.equal(
      await mint.qaVaultBlobOpens({
        masterKey: keys.masterKey,
        blob: meta.wrapped_mk_recovery,
      }),
      false,
    );
    assert.equal(
      await mint.qaVaultBlobOpens({ masterKey: keys.masterKey, blob: null }),
      false,
    );
  });
});

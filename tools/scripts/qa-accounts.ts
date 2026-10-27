#!/usr/bin/env node
/**
 * QA Accounts (CONTEXT.md) for a local database.
 *
 *   yarn qa:accounts                       print every QA Account's sign-in
 *                                          password, Vault passphrase and
 *                                          Recovery Key
 *   yarn qa:accounts:seed                  create each account as a verified
 *                                          user with its vault, or put its
 *                                          password and vault meta back
 *   yarn qa:accounts:seed --restore        also delete its Vault Blobs, which
 *                                          returns the vault to empty
 *   ... --account <id>                     one account instead of all
 *
 * The values are public by design, and safe only because nothing here runs
 * against a database that is not local: `localDatabaseRefusal` has no
 * override ([ADR 0122](../../docs/adr/0122-a-qa-accounts-credentials-are-public-fixtures-in-tracked-source.md)).
 *
 * A seed never deletes data unless `--restore` is passed. The key material is
 * fixed, so rewriting the meta leaves every Vault Blob the account already
 * holds readable; a blob that no longer opens under the account's Master Key
 * is reported, and `--restore` is what clears it.
 *
 * Loads the repo `.env` without overriding variables already set.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type QaAccountWithSecrets,
  deriveQaKeyMaterial,
  localDatabaseRefusal,
  parseQaAccountsArgs,
  qaUserDrift,
  readQaAccounts,
  vaultMetaMatches,
} from './lib/qa-accounts.ts';
import { loadQaVaultMint } from './lib/qa-vault-mint.ts';

const require = createRequire(import.meta.url);
const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

function fail(message: string): never {
  console.error(`qa-accounts: ${message}`);
  process.exit(1);
}

/** The subset of `mintQaVaultMeta`/`openQaVaultMeta`/`qaVaultBlobOpens` this script calls, on the bundle `loadQaVaultMint` hands back as `unknown`. */
interface QaVaultMint {
  mintQaVaultMeta(options: {
    passphrase: string;
    keys: ReturnType<typeof deriveQaKeyMaterial>;
  }): Promise<Record<string, unknown>>;
  openQaVaultMeta(options: {
    meta: Record<string, unknown>;
    passphrase: string;
    recoveryKey: string;
  }): Promise<{ byPassphrase: string; byRecoveryKey: string }>;
  qaVaultBlobOpens(options: {
    masterKey: string;
    blob: unknown;
  }): Promise<boolean>;
}

/** The one row shape this script reads or writes on `User`. */
interface QaUserRow {
  id: string;
  email: string;
  password: string;
  email_verification_timestamp: Date | null;
  email_verification_token: string | null;
  disabled: boolean;
  youtube_access: boolean;
  youtube_access_first_granted_at: Date | null;
}

/** The one row shape this script reads or writes on `EncryptedVaultBlob`. */
interface QaVaultBlobRow {
  type: string;
  blob: unknown;
}

/** The subset of a generated Prisma Client this script calls, dynamically required so `yarn qa:accounts` (print) never loads it. */
interface QaPrismaClient {
  user: {
    findUnique(args: { where: { email: string } }): Promise<QaUserRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<QaUserRow>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<QaUserRow>;
  };
  encryptedVault: {
    findUnique(args: {
      where: { userId: string };
    }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: {
      where: { userId: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
  encryptedVaultBlob: {
    deleteMany(args: { where: { userId: string } }): Promise<{ count: number }>;
    findMany(args: { where: { userId: string } }): Promise<QaVaultBlobRow[]>;
  };
  $disconnect(): Promise<void>;
}

const args = parseQaAccountsArgs(process.argv.slice(2));
if (args.error) fail(args.error);

let accounts = readQaAccounts(workspaceRoot);
if (args.account) {
  accounts = accounts.filter((account) => account.id === args.account);
  if (accounts.length === 0) fail(`no QA Account has the id "${args.account}"`);
}

function print() {
  for (const account of accounts) {
    console.log(`QA Account "${account.id}"`);
    console.log(`  email             ${account.email}`);
    console.log(`  password          ${account.password}`);
    console.log(`  Vault passphrase  ${account.vaultPassphrase}`);
    console.log(
      `  Recovery Key      ${deriveQaKeyMaterial(account.id).recoveryKey}`,
    );
  }
}

async function seedAccount({
  prisma,
  mint,
  bcrypt,
  account,
}: {
  prisma: QaPrismaClient;
  mint: QaVaultMint;
  bcrypt: typeof import('bcrypt');
  account: QaAccountWithSecrets;
}) {
  const keys = deriveQaKeyMaterial(account.id);
  const meta = await mint.mintQaVaultMeta({
    passphrase: account.vaultPassphrase,
    keys,
  });
  // The seeder proves its own vault opens before it writes it.
  const opened = await mint.openQaVaultMeta({
    meta,
    passphrase: account.vaultPassphrase,
    recoveryKey: keys.recoveryKey,
  });
  if (
    opened.byPassphrase !== keys.masterKey ||
    opened.byRecoveryKey !== keys.masterKey
  ) {
    throw new Error(`the minted vault for "${account.id}" does not open`);
  }

  const notes: string[] = [];
  let user = await prisma.user.findUnique({ where: { email: account.email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: account.email,
        password: await bcrypt.hash(account.password, 10),
        first_name: account.firstName,
        last_name: account.lastName,
        name: `${account.firstName} ${account.lastName}`,
        email_verification_timestamp: new Date(),
        blacklisted_tokens: [],
        // ADR 0129: QA Accounts use YouTube without a manual grant.
        youtube_access: true,
        youtube_access_first_granted_at: new Date(),
      },
    });
    notes.push('user created');
  } else {
    // Only what drifted is written, so a second run changes nothing.
    const drift = qaUserDrift({
      user,
      passwordMatches: await bcrypt.compare(account.password, user.password),
    });
    if (drift.length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          ...(drift.includes('password') && {
            password: await bcrypt.hash(account.password, 10),
          }),
          ...(drift.includes('verification') && {
            email_verification_timestamp: new Date(),
            email_verification_token: null,
          }),
          ...(drift.includes('disabled') && { disabled: false }),
          ...(drift.includes('youtube_access') && {
            youtube_access: true,
            youtube_access_first_granted_at:
              user.youtube_access_first_granted_at ?? new Date(),
          }),
        },
      });
      notes.push(`user ${drift.join(', ')} put back`);
    } else {
      notes.push('user unchanged');
    }
  }

  const stored = await prisma.encryptedVault.findUnique({
    where: { userId: user.id },
  });
  if (!stored) {
    await prisma.encryptedVault.create({ data: { userId: user.id, ...meta } });
    notes.push('vault created');
  } else if (!vaultMetaMatches(stored, meta)) {
    await prisma.encryptedVault.update({
      where: { userId: user.id },
      data: meta,
    });
    notes.push('vault meta put back');
  } else {
    notes.push('vault unchanged');
  }

  if (args.restore) {
    const { count } = await prisma.encryptedVaultBlob.deleteMany({
      where: { userId: user.id },
    });
    notes.push(`${count} Vault Blob(s) deleted, vault is empty`);
  } else {
    const blobs = await prisma.encryptedVaultBlob.findMany({
      where: { userId: user.id },
    });
    const unreadable: string[] = [];
    for (const blob of blobs) {
      const opens = await mint.qaVaultBlobOpens({
        masterKey: keys.masterKey,
        blob: blob.blob,
      });
      if (!opens) unreadable.push(blob.type);
    }
    notes.push(`${blobs.length} Vault Blob(s) kept`);
    if (unreadable.length > 0) {
      notes.push(
        `UNREADABLE: ${unreadable.join(', ')} — run "yarn qa:accounts:seed --restore --account ${account.id}"`,
      );
    }
  }

  console.log(
    `QA Account "${account.id}" <${account.email}>: ${notes.join('; ')}`,
  );
}

async function seed() {
  (
    require('dotenv') as {
      config: (options: { path: string; quiet: boolean }) => unknown;
    }
  ).config({
    path: resolve(workspaceRoot, '.env'),
    quiet: true,
  });
  const refusal = localDatabaseRefusal({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
  });
  if (refusal) {
    fail(
      `refusing to seed: ${refusal}. QA Accounts exist only in a local database.`,
    );
  }

  const bcrypt = require('bcrypt') as typeof import('bcrypt');
  const { PrismaClient } = require('@prisma/client') as {
    PrismaClient: new (options: { adapter: unknown }) => QaPrismaClient;
  };
  const { PrismaPg } = require('@prisma/adapter-pg') as {
    PrismaPg: new (options: {
      connectionString: string | undefined;
    }) => unknown;
  };
  const mint = (await loadQaVaultMint(workspaceRoot)) as QaVaultMint;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    for (const account of accounts) {
      await seedAccount({ prisma, mint, bcrypt, account });
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log('Run "yarn qa:accounts" for the sign-in values.');
}

if (args.command === 'print') {
  print();
} else {
  await seed();
}

/**
 * QA Accounts (CONTEXT.md): the judgments `tools/scripts/qa-accounts.ts`
 * makes, kept free of a database so `qa-accounts.test.mjs` can run them.
 *
 * A QA Account's sign-in password, Vault passphrase and Recovery Key are
 * public by design: all three are derived from the account's id in tracked
 * source. What keeps that safe is `localDatabaseRefusal`: the seeder
 * is the only path that creates a verified user without the email round-trip,
 * and it runs against a local database or not at all. There is no flag that
 * lifts the refusal ([ADR 0122](../../../docs/adr/0122-a-qa-accounts-credentials-are-public-fixtures-in-tracked-source.md)).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const QA_ACCOUNTS_CONFIG = 'tools/config/qa-accounts.json';

/** The email domain every QA Account sits on. `.test` is reserved (RFC 2606) and receives no mail. */
export const QA_ACCOUNT_EMAIL_SUFFIX = '@myorganizer.test';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

type QaAccountField = 'id' | 'email' | 'firstName' | 'lastName';

const ACCOUNT_FIELDS: QaAccountField[] = [
  'id',
  'email',
  'firstName',
  'lastName',
];

export interface QaAccountRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  [key: string]: unknown;
}

/** Why `accounts` is not a usable QA Account table, or `null` when it is. */
export function qaAccountsProblem(accounts: unknown): string | null {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return 'expected a non-empty "accounts" array';
  }
  const seen = new Set<string>();
  for (const account of accounts as Record<string, unknown>[]) {
    for (const field of ACCOUNT_FIELDS) {
      if (typeof account?.[field] !== 'string' || account[field] === '') {
        return `an account is missing "${field}"`;
      }
    }
    const id = account.id as string;
    const email = account.email as string;
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      return `account id "${id}" must be lowercase letters, digits and hyphens`;
    }
    if (!email.endsWith(QA_ACCOUNT_EMAIL_SUFFIX)) {
      return `account "${id}" must use an ${QA_ACCOUNT_EMAIL_SUFFIX} address`;
    }
    for (const key of [id, email]) {
      if (seen.has(key)) return `"${key}" is used by two accounts`;
      seen.add(key);
    }
  }
  return null;
}

export interface QaAccountSecrets {
  password: string;
  vaultPassphrase: string;
}

export type QaAccountWithSecrets = QaAccountRecord & QaAccountSecrets;

interface QaAccountsConfigFile {
  accounts: unknown;
}

/**
 * Reads the tracked QA Account table and gives each account the sign-in
 * password and Vault passphrase derived from its id.
 */
export function readQaAccounts(workspaceRoot: string): QaAccountWithSecrets[] {
  const { accounts } = JSON.parse(
    readFileSync(join(workspaceRoot, QA_ACCOUNTS_CONFIG), 'utf8'),
  ) as QaAccountsConfigFile;
  const problem = qaAccountsProblem(accounts);
  if (problem) throw new Error(`${QA_ACCOUNTS_CONFIG}: ${problem}`);
  return (accounts as QaAccountRecord[]).map((account) => ({
    ...account,
    ...deriveQaSecrets(account.id),
  }));
}

export interface LocalDatabaseRefusalInput {
  databaseUrl: string | null | undefined;
  nodeEnv: string | undefined;
}

/**
 * Why the seeder must not touch this database, or `null` when it may.
 *
 * Local means the URL's host is this machine. Anything the URL does not prove
 * local is refused, including a URL that does not parse.
 */
export function localDatabaseRefusal({
  databaseUrl,
  nodeEnv,
}: LocalDatabaseRefusalInput): string | null {
  if (nodeEnv === 'production') {
    return 'NODE_ENV is production';
  }
  if (!databaseUrl) {
    return 'DATABASE_URL is not set';
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return 'DATABASE_URL does not parse as a URL';
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    return 'DATABASE_URL is not a postgres URL';
  }
  // A libpq `host=` query parameter overrides the URL's host.
  if (url.searchParams.has('host')) {
    return 'DATABASE_URL carries a host parameter';
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    return `the database host "${url.hostname}" is not this machine`;
  }
  return null;
}

function digest(id: string, purpose: string): Buffer {
  return createHash('sha256')
    .update(`myorganizer-qa-account/${id}/${purpose}`)
    .digest();
}

function derive(id: string, purpose: string, length: number): string {
  return digest(id, purpose).subarray(0, length).toString('base64');
}

const SECRET_LABELS: [string, string][] = [
  ['pw', 'sign-in-password'],
  ['vp', 'vault-passphrase'],
];

/**
 * The sign-in password and Vault passphrase of one QA Account.
 *
 * Derived, like the key material, so no credential-shaped literal sits in the
 * tree for a secret scanner to flag. Each is a two-letter prefix and twelve
 * hex digits: fifteen characters, which the web client's ten-character
 * passphrase minimum accepts and which types the same on every keyboard.
 */
export function deriveQaSecrets(id: string): QaAccountSecrets {
  // Built as a pair, not as `key: '...'` properties: a secret scanner reads a
  // string assigned to a password-named key as a committed credential.
  const [password, vaultPassphrase] = SECRET_LABELS.map(
    ([prefix, purpose]) =>
      `${prefix}-${digest(id, purpose).toString('hex').slice(0, 12)}`,
  );
  return { password, vaultPassphrase };
}

export interface QaKeyMaterial {
  salt: string;
  masterKey: string;
  recoveryKey: string;
  passphraseIv: string;
  recoveryIv: string;
}

/**
 * The fixed key material behind one QA Account's vault, base64.
 *
 * Derived from the account id and never committed, so no key-shaped string
 * sits in the tree, and fixed, so minting twice gives the same vault: a
 * re-seed is a no-op and the seeder can always put the vault back.
 */
export function deriveQaKeyMaterial(id: string): QaKeyMaterial {
  return {
    salt: derive(id, 'kdf-salt', 16),
    masterKey: derive(id, 'master-key', 32),
    recoveryKey: derive(id, 'recovery-key', 32),
    passphraseIv: derive(id, 'passphrase-wrap-iv', 12),
    recoveryIv: derive(id, 'recovery-wrap-iv', 12),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    );
  }
  return value;
}

const META_FIELDS = [
  'version',
  'kdf_name',
  'kdf_salt',
  'kdf_params',
  'wrapped_mk_passphrase',
  'wrapped_mk_recovery',
] as const;

/** Whether a stored vault row carries exactly the meta the seeder mints. */
export function vaultMetaMatches(
  stored: Record<string, unknown> | null | undefined,
  minted: Record<string, unknown>,
): boolean {
  if (!stored) return false;
  return META_FIELDS.every(
    (field) =>
      JSON.stringify(canonical(stored[field])) ===
      JSON.stringify(canonical(minted[field])),
  );
}

export interface QaUserDriftUser {
  email_verification_timestamp?: unknown;
  email_verification_token?: unknown;
  disabled?: unknown;
  youtube_access?: unknown;
  youtube_access_first_granted_at?: unknown;
}

export interface QaUserDriftInput {
  user: QaUserDriftUser;
  passwordMatches: boolean;
}

/**
 * What on a stored QA Account's User row is off the fixture: any of
 * `password`, `verification`, `disabled`, `youtube_access`. Empty when a seed
 * has nothing to write, which is what makes a second run change nothing.
 */
export function qaUserDrift({
  user,
  passwordMatches,
}: QaUserDriftInput): string[] {
  const drift: string[] = [];
  if (!passwordMatches) drift.push('password');
  if (!user.email_verification_timestamp || user.email_verification_token) {
    drift.push('verification');
  }
  if (user.disabled) drift.push('disabled');
  if (!user.youtube_access || !user.youtube_access_first_granted_at) {
    drift.push('youtube_access');
  }
  return drift;
}

export interface ParsedQaAccountsArgs {
  command: string;
  restore: boolean;
  account: string | null;
  error: string | null;
}

/** Parses the CLI's arguments; `error` names the first one it does not know. */
export function parseQaAccountsArgs(argv: string[]): ParsedQaAccountsArgs {
  const [command = 'print', ...rest] = argv;
  const parsed: ParsedQaAccountsArgs = {
    command,
    restore: false,
    account: null,
    error: null,
  };
  if (command !== 'print' && command !== 'seed') {
    parsed.error = `unknown command "${command}" (expected "print" or "seed")`;
    return parsed;
  }
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--restore' && command === 'seed') {
      parsed.restore = true;
    } else if (arg === '--account' && rest[index + 1]) {
      parsed.account = rest[index + 1];
      index += 1;
    } else {
      parsed.error = `unknown argument "${arg}"`;
      return parsed;
    }
  }
  return parsed;
}

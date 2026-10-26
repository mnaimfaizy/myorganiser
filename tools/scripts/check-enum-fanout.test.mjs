import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isolateGitEnvironment } from './lib/git-environment.ts';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.ts.
isolateGitEnvironment();

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-enum-fanout.mjs');

/**
 * The checker reads tracked TypeScript, so a fixture needs a real repository.
 * `git ls-files` returns nothing otherwise and the checker would pass by
 * seeing no corpus at all — the failure mode a gate must never have.
 */
function createRepo(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'enum-fanout-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], {
    cwd: workspace,
    stdio: 'ignore',
  });
  return workspace;
}

function write(workspace, relative, contents) {
  const path = join(workspace, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function commitAll(workspace) {
  execFileSync('git', ['add', '-A'], {
    cwd: workspace,
    stdio: 'ignore',
  });
}

const run = (workspace, ...args) =>
  spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: workspace,
    encoding: 'utf8',
  });

const ENUM_SOURCE = `export const VaultBlobType = {
    Addresses: 'addresses',
    Groceries: 'groceries',
    MobileNumbers: 'mobileNumbers',
    Subscriptions: 'subscriptions',
    Tasks: 'tasks',
    Notes: 'notes'
} as const;
`;

const PIN_SOURCE = `export const VAULT_BLOB_FIELDS = {
  [VaultBlobType.Addresses]: 'addresses',
  [VaultBlobType.Groceries]: 'groceries',
  [VaultBlobType.MobileNumbers]: 'mobileNumbers',
  [VaultBlobType.Subscriptions]: 'subscriptions',
  [VaultBlobType.Tasks]: 'tasks',
  [VaultBlobType.Notes]: 'notes',
} as const satisfies Record<VaultBlobType, VaultRecordType>;

export const VAULT_BLOB_TYPES = Object.keys(VAULT_BLOB_FIELDS) as VaultBlobType[];

export function isVaultBlobType(key: string): key is VaultBlobType {
  return Object.prototype.hasOwnProperty.call(VAULT_BLOB_FIELDS, key);
}
`;

/**
 * The declaration sites the checker asserts exist. They are exempt from the
 * rule and must be present, so every fixture carries them as empty modules.
 */
const DECLARATION_SITES = [
  'libs/web/vault/src/lib/vault/localVaultStorage.ts',
  'libs/vault-core/src/lib/types.ts',
  'libs/vault-core/src/lib/vaultExportEnvelope.ts',
  'libs/vault-core/src/lib/records/vaultBlobConverge.ts',
];

/** A workspace carrying the guarded enum and its pinned table, plus `extra` files. */
function scaffold(t, extra = {}) {
  const workspace = createRepo(t);
  write(workspace, 'libs/app-api-client/src/api.ts', ENUM_SOURCE);
  write(
    workspace,
    'libs/web/vault/src/lib/vault/vaultBlobFields.ts',
    PIN_SOURCE,
  );
  for (const path of DECLARATION_SITES) write(workspace, path, 'export {};\n');
  for (const [path, contents] of Object.entries(extra)) {
    write(workspace, path, contents);
  }
  commitAll(workspace);
  return workspace;
}

test('passes when every fan-out reaches the pinned table', (t) => {
  const workspace = scaffold(t, {
    'libs/web/vault/src/lib/vault/reconcile.ts': `import { VAULT_BLOB_TYPES } from './vaultBlobFields';
for (const type of VAULT_BLOB_TYPES) upload(type);
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('fails a hand-enumerated fan-out that never reaches the table', (t) => {
  const workspace = scaffold(t, {
    'libs/web/vault/src/lib/vault/export.ts': `const blobs = {
  [VaultBlobType.Addresses]: a,
  [VaultBlobType.Groceries]: g,
  [VaultBlobType.MobileNumbers]: m,
  [VaultBlobType.Subscriptions]: s,
  [VaultBlobType.Notes]: t,
};
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /export\.ts:\d+ \(.+\): names 5 of 6 VaultBlobType members/,
  );
  assert.match(result.stderr, /Addresses, Groceries, MobileNumbers/);
});

test('leaves a single-member point use alone', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/screens/src/TasksScreen.tsx': `sync({ type: VaultBlobType.Tasks });
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('accepts a call site that pins itself with its own satisfies clause', (t) => {
  const workspace = scaffold(t, {
    'libs/web/vault/src/lib/vault/labels.ts': `const LABELS = {
  [VaultBlobType.Addresses]: 'Addresses',
  [VaultBlobType.Groceries]: 'Groceries',
  [VaultBlobType.MobileNumbers]: 'Mobile numbers',
  [VaultBlobType.Subscriptions]: 'Subscriptions',
  [VaultBlobType.Tasks]: 'Tasks',
  [VaultBlobType.Notes]: 'Notes',
} as const satisfies Record<VaultBlobType, string>;
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('ignores test files, which enumerate members as fixtures', (t) => {
  const workspace = scaffold(t, {
    'libs/web/vault/src/lib/vault/export.test.ts': `expect(VaultBlobType.Tasks).toBe('tasks');
expect(VaultBlobType.Notes).toBe('notes');
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('ignores the generated API client, which declares the enum itself', (t) => {
  const workspace = scaffold(t, {
    'libs/app-api-client/src/other.ts': `const x = [VaultBlobType.Tasks, VaultBlobType.Notes];
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// `envelopeFromLocalVault` dropped the Tasks blob from every hardened export
// without writing `VaultBlobType` once — the whole fan-out was property names.
// A rule keyed only on the enum identifier would not have seen it (#537).
test('fails a fan-out written in property names that never says the enum', (t) => {
  const workspace = scaffold(t, {
    'libs/web/vault/src/lib/vault/envelope.ts': `const blobs = {};
if (localVault.data.addresses) blobs.addresses = wrap(localVault.data.addresses);
if (localVault.data.groceries) blobs.groceries = wrap(localVault.data.groceries);
if (localVault.data.mobileNumbers) blobs.mobileNumbers = wrap(localVault.data.mobileNumbers);
if (localVault.data.subscriptions) blobs.subscriptions = wrap(localVault.data.subscriptions);
if (localVault.data.notes) blobs.notes = wrap(localVault.data.notes);
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /envelope\.ts:\d+ \(.+\): names 5 of 6 VaultBlobType members/,
  );
  assert.doesNotMatch(result.stderr, /Tasks/);
});

test('does not read member values as a fan-out outside the value roots', (t) => {
  const workspace = scaffold(t, {
    'libs/web/pages/src/dashboard.ts': `const counts = { tasks: list.tasks.length, notes: list.notes.length };
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// A text scan asked only whether the table was named anywhere in the file, so
// a comment mentioning it exempted every fan-out below — and `vaultExportImport.ts`,
// the file the Tasks omission lived in, imports the table at the top.
test('a comment naming the table does not exempt a fan-out', (t) => {
  const workspace = scaffold(t, {
    'libs/web/vault/src/lib/vault/shapes.ts': `export function toLocal(blobs) {
  // NOTE: this used to iterate VAULT_BLOB_TYPES.
  if (blobs.addresses) next.data.addresses = x(blobs.addresses);
  if (blobs.groceries) next.data.groceries = x(blobs.groceries);
  if (blobs.mobileNumbers) next.data.mobileNumbers = x(blobs.mobileNumbers);
  if (blobs.subscriptions) next.data.subscriptions = x(blobs.subscriptions);
  if (blobs.notes) next.data.notes = x(blobs.notes);
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\(toLocal\): names 5 of 6/);
});

test('judges each function separately, not the file as a whole', (t) => {
  const workspace = scaffold(t, {
    'libs/web/vault/src/lib/vault/mixed.ts': `import { VAULT_BLOB_TYPES } from './vaultBlobFields';

export function good(v) {
  for (const type of VAULT_BLOB_TYPES) send(type);
}

export function bad(v) {
  if (v.data.addresses) out.addresses = v.data.addresses;
  if (v.data.groceries) out.groceries = v.data.groceries;
  if (v.data.mobileNumbers) out.mobileNumbers = v.data.mobileNumbers;
  if (v.data.subscriptions) out.subscriptions = v.data.subscriptions;
  if (v.data.notes) out.notes = v.data.notes;
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\(bad\): names 5 of 6/);
  assert.doesNotMatch(result.stderr, /\(good\)/);
});

test('fails a hand-written union of the member values', (t) => {
  const workspace = scaffold(t, {
    'libs/web/vault/src/lib/vault/audit.ts': `export type Reported =
  | 'addresses'
  | 'groceries'
  | 'mobileNumbers'
  | 'subscriptions'
  | 'tasks';
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /names 5 of 6/);
});

test('exempts a declaration site, which is the list rather than a use of it', (t) => {
  const workspace = createRepo(t);
  write(workspace, 'libs/app-api-client/src/api.ts', ENUM_SOURCE);
  write(
    workspace,
    'libs/web/vault/src/lib/vault/vaultBlobFields.ts',
    PIN_SOURCE,
  );
  write(
    workspace,
    'libs/web/vault/src/lib/vault/localVaultStorage.ts',
    `export type VaultRecordType =
  | 'addresses'
  | 'groceries'
  | 'mobileNumbers'
  | 'subscriptions'
  | 'tasks'
  | 'notes';
`,
  );
  write(workspace, 'libs/vault-core/src/lib/types.ts', 'export {};\n');
  write(
    workspace,
    'libs/vault-core/src/lib/vaultExportEnvelope.ts',
    'export {};\n',
  );
  write(
    workspace,
    'libs/vault-core/src/lib/records/vaultBlobConverge.ts',
    'export {};\n',
  );
  commitAll(workspace);
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('cannot run when a declaration-site exemption names a file that is gone', (t) => {
  const workspace = createRepo(t);
  write(workspace, 'libs/app-api-client/src/api.ts', ENUM_SOURCE);
  write(
    workspace,
    'libs/web/vault/src/lib/vault/vaultBlobFields.ts',
    PIN_SOURCE,
  );
  write(workspace, 'libs/vault-core/src/lib/types.ts', 'export {};\n');
  write(
    workspace,
    'libs/vault-core/src/lib/vaultExportEnvelope.ts',
    'export {};\n',
  );
  commitAll(workspace);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /does not exist/);
});

test('fails when the pinned table loses its satisfies clause', (t) => {
  const workspace = createRepo(t);
  write(workspace, 'libs/app-api-client/src/api.ts', ENUM_SOURCE);
  write(
    workspace,
    'libs/web/vault/src/lib/vault/vaultBlobFields.ts',
    PIN_SOURCE.replace(
      '} as const satisfies Record<VaultBlobType, VaultRecordType>;',
      '} as const;',
    ),
  );
  for (const path of DECLARATION_SITES) write(workspace, path, 'export {};\n');
  commitAll(workspace);
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /no `satisfies Record<VaultBlobType, \.\.\.>` clause/,
  );
});

test('cannot run when the guarded enum has moved out of its declared home', (t) => {
  const workspace = createRepo(t);
  write(
    workspace,
    'libs/app-api-client/src/api.ts',
    'export type Other = 1;\n',
  );
  write(
    workspace,
    'libs/web/vault/src/lib/vault/vaultBlobFields.ts',
    PIN_SOURCE,
  );
  for (const path of DECLARATION_SITES) write(workspace, path, 'export {};\n');
  commitAll(workspace);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no longer declared as a const object/);
});

test('--print reports the members and the pin it resolved', (t) => {
  const workspace = scaffold(t);
  const result = run(workspace, '--print');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /VaultBlobType: 6 members/);
  assert.match(result.stdout, /pinned by libs\/web\/vault/);
});

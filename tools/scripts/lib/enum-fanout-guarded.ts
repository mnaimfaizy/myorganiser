// The guarded enums enum:fanout:check reads (ADR 0053). The review obligation
// enum-fanout-omits-a-member (docs/review/REVIEW_CHECKLIST.md) reads them too:
// its catalogue entry says "guardedEnums" and loadObligationCatalogue expands
// that from this list, so the obligation fires on exactly this set. Its test
// asserts both directions.

export interface GuardedEnumDeclarationSite {
  path: string;
  reason: string;
}

export interface GuardedEnum {
  enum: string;
  definedIn: string;
  pin: string;
  reach: readonly string[];
  valueRoots: readonly string[];
  declarationSites: readonly GuardedEnumDeclarationSite[];
  why: string;
}

/**
 * The guarded enums.
 *
 * `enum` is the identifier a call site writes (`VaultBlobType.Groceries`).
 * `definedIn` is where its members live, so the check fails loudly rather than
 * silently passing if the enum is renamed or moved. `pin` is the module whose
 * `satisfies Record<enum, ...>` clause is the exhaustiveness guard, and `reach`
 * is what a scope must name to count as pinned.
 *
 * The list is deliberately short. A guarded enum earns its place by the cost of
 * an omission: for `VaultBlobType`, an omitted member destroys User-owned
 * ciphertext with no error and no recovery (ADR 0033).
 */
export const GUARDED_ENUMS = [
  {
    enum: 'VaultBlobType',
    definedIn: 'libs/app-api-client/src/api.ts',
    pin: 'libs/web/vault/src/lib/vault/vaultBlobFields.ts',
    reach: ['VAULT_BLOB_FIELDS', 'VAULT_BLOB_TYPES', 'isVaultBlobType'],
    // Inside these roots the member *values* are the blob types wherever they
    // appear as property names or string literals, so a fan-out written as
    // `data.addresses`, `data.groceries`, ... counts even though it never says
    // `VaultBlobType`. That is the shape of the omission in
    // `envelopeFromLocalVault`, which dropped Tasks without naming the enum
    // once (#537). Scoped to the vault libraries because `.tasks` and `.groceries`
    // mean something else elsewhere in the repo.
    valueRoots: ['libs/web/vault/src/', 'libs/vault-core/src/'],
    // The modules that *declare* the member names, as against the ones that
    // consume them. A declaration may enumerate — it is the list — but only
    // because the pinned table's `satisfies` clause ties it back: the table is
    // `Record<VaultBlobType, VaultRecordType> & Record<VaultExportBlobType, …>`,
    // so a seventh enum member with no field in `VaultRecordType` and no key in
    // the envelope schema fails to compile at the pin. Each entry carries the
    // reason it is safe; an entry without one is not an exemption, it is a hole.
    declarationSites: [
      {
        path: 'libs/web/vault/src/lib/vault/localVaultStorage.ts',
        reason:
          'Declares `VaultRecordType` and the `VaultStorageV1.data` shape — the Local Vault field names the pinned table maps onto. The pin satisfies `Record<VaultBlobType, VaultRecordType>`, so a seventh blob type with no field here fails to compile there.',
      },
      {
        path: 'libs/vault-core/src/lib/types.ts',
        reason:
          "Declares `vault-core`'s own copy of the field-name union, which cannot import the pinned table (wrong dependency direction). Tied back instead: the pin satisfies `Record<VaultBlobType, CoreVaultRecordType>`, so a member missing from this union is not assignable there. It listed five and omitted a member until #537.",
      },
      {
        path: 'libs/vault-core/src/lib/vaultExportEnvelope.ts',
        reason:
          'Declares `VAULT_EXPORT_BLOB_TYPES` and the envelope `BlobsSchema` — the export contract itself. The pin satisfies `Record<VaultExportBlobType, VaultRecordType>`, so a seventh blob type missing from this schema fails to compile there.',
      },
      {
        path: 'libs/vault-core/src/lib/records/vaultBlobConverge.ts',
        reason:
          'Declares `VAULT_BLOB_CONVERGE_STRATEGIES`, the one convergence pin web and mobile share (ADR 0107). It cannot import `VaultBlobType` (wrong dependency direction), so it satisfies `Record<CoreVaultRecordType, …>` itself, and the pin re-asserts the same table against `Record<VaultBlobType, VaultBlobConvergeStrategy>` — a seventh blob type with no strategy here fails to compile at both.',
      },
    ],
    why: 'an omitted Vault Blob Type destroys User-owned ciphertext (ADR 0033, issues #512 and #537)',
  },
] as const satisfies readonly GuardedEnum[];

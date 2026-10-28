# A fan-out over a domain enum is pinned at its call site

## Status

accepted

## Context

A keep-server reconcile destroyed a User's grocery ciphertext
([#512](https://github.com/mnaimfaizy/myorganiser/issues/512)). The cause was not a wrong value.
`vaultMigration.ts` handled five of the six `VaultBlobType` members by hand, in four separate
branches, and Groceries was in none of them. Every gate passed. Every type checked.

`yarn vault:pages:check` could not have seen it. It asserts constants — the six members exist, and
they did. [ADR 0051](0051-a-pinned-value-does-not-notice-that-its-meaning-moved.md) records that a
value-pinning gate cannot notice a value's meaning moving; this is the neighbouring blindness. A
gate that reads the enum's declaration learns what the members are, and learns nothing about which
call sites cover them.

TypeScript can see it, but only where somebody asked. `Record<VaultBlobType, T>` fails to compile
when a member is missing. `Partial<Record<VaultBlobType, T>>` does not, and neither does an
if-chain over `key === VaultBlobType.X`, nor a list assembled from six `if` statements. All three
shapes were live in the vault when this was written, and one of them —
`envelopeFromLocalVault` — had been silently dropping the Tasks blob from every hardened export
since the day it was written ([#537](https://github.com/mnaimfaizy/myorganiser/issues/537)). The
export succeeded. The file downloaded. The Tasks came back empty on restore.

Three tightenings were considered and two rejected:

- **`@typescript-eslint/switch-exhaustiveness-check`.** Rejected. It needs type-aware linting,
  which `eslint.config.js` does not configure, and there is no `switch` on `VaultBlobType`
  anywhere. The hazard's actual shapes — object literals and if-chains — are outside the rule.
- **Extending `yarn vault:pages:check` with per-call-site coverage.** Rejected. That check asserts
  a documentation page against source constants; call-site coverage is a different subject with a
  different corpus, and folding it in would make one failure mean two unrelated things.
- **A house convention alone, documented and unenforced.** Rejected as insufficient. The
  convention is the fix, but #512 and the Tasks omission were both written by people who knew the
  domain. A convention nobody checks is the state that produced both.

## Decision

**Code that fans out over a domain enum reaches one pinned table; it does not re-enumerate the
members.**

The pin is `as const satisfies Record<EnumType, …>`. Its `satisfies` clause is the guard: a new
member fails to compile until it is given a home there, and every branch that iterates the table
gets the new member without being edited. For `VaultBlobType` that table is
`VAULT_BLOB_FIELDS` in `libs/web/vault/src/lib/vault/vaultBlobFields.ts`, and the reconcile,
the legacy bundle path, the hardened envelope path, and the Local Vault write-back all iterate it.

Where two hand-maintained lists describe the same domain set — `VaultBlobType` from the API
contract and `VaultExportBlobType` from `@myorganiser/vault-core` — the table satisfies both, so
nothing can be added to one and forgotten in the other.

`yarn enum:fanout:check` (`tools/scripts/check-enum-fanout.ts`) enforces it. It parses the
corpus with the TypeScript parser — syntax only, no program and no type-checker — and judges
**each scope**: every function, plus each file's module-level statements taken together. A scope
naming two or more members of a Guarded Enum by name, or three or more by bare value, must reach
that enum's Pinned Table or carry a `satisfies Record<EnumType, …>` clause of its own. One member
is a point use (`sync({ type: VaultBlobType.Tasks })`) and is left alone.

The parser is not decoration; a regex version of this check was written first and two holes in it
decided the design:

- **Scope, not file.** Asking whether the table is named _somewhere_ in a file exempts precisely
  the files most likely to be wrong. `vaultExportImport.ts` imports the table at the top and still
  omitted Tasks two hundred lines below. Per-scope judgement catches a module that iterates the
  table in one function and hand-enumerates in the next.
- **Comments are not code.** Under a text scan, one comment mentioning `VAULT_BLOB_TYPES`, or a
  JSDoc block quoting this rule, laundered a whole file.

The bare-value path exists because a fan-out can cover every member without ever naming the enum:
`envelopeFromLocalVault` did exactly that, in property names, and dropped Tasks. Inside declared
value roots (`libs/web/vault/src/`, `libs/vault-core/src/`) the member values therefore count as
references. Its threshold is three rather than two because `.tasks` and `.subscriptions` are also
ordinary English property names and a pair can co-occur innocently — no coverage is lost, since a
real fan-out covers the whole set.

Test files are out of scope: a fixture legitimately enumerates the members it cares about, and
routing them through the table would make the test assert the table instead of the behaviour.

A module that **declares** the member names is exempt, because it is the list rather than a use of
it — but only where the Pinned Table ties it back. The table satisfies `Record<VaultBlobType,
VaultRecordType>`, `Record<VaultExportBlobType, VaultRecordType>`, and `Record<VaultBlobType,
CoreVaultRecordType>` at once, so a sixth blob type missing from the Local Vault's field union,
from the envelope schema, or from `vault-core`'s separate copy of the field names fails to compile
at the pin. Each exemption carries a written reason in the checker, and one naming a file that no
longer exists is a hard error — the same contract `tools/config/gate-coverage-optout.json` uses.
That tie is not hypothetical: `vault-core`'s `VaultRecordType` listed five of the six and omitted
`todos` until this check found it.

An enum earns a guard by the cost of an omission, not by being an enum. `VaultBlobType` qualifies
because an omitted member destroys User-owned ciphertext with no error and no recovery
([ADR 0033](0033-local-vaults-are-user-owned-and-never-silently-destroyed.md)). The guarded list is a literal in the checker,
short on purpose.

## Consequences

- The gap ADR 0051 named for values is now closed for sets: a gate cannot pin which call sites
  cover an enum, so it pins the shape a covering call site has.
- The checker is wired into `yarn gates:run` and CI, so
  [ADR 0043](0043-gates-assert-facts.md)'s Meta-Gate accepts it.
- A legitimate hand-enumeration must say so in code, by carrying its own `satisfies` clause. There
  is no comment-based suppression, deliberately: a fan-out that cannot state its exhaustiveness in
  the type system is the case this ADR exists to stop.
- Adding a sixth Vault Blob Type now fails to compile in one place, with the table naming every
  path that needs it, rather than passing everywhere and losing data in four.

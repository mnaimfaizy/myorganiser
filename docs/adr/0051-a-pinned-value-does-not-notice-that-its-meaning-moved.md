# A pinned value does not notice that its meaning moved

## Status

accepted

## Context

`docs/vault/trust-boundary.html` told readers that a Vault lives on the device under
`myorganiser_vault_v1`. [ADR 0047](0047-vault-access-is-obtained-through-an-owner-bound-handle.md)
made Local Vaults owner-bound: a signed-in User's Vault now lives at
`myorganiser_vault_v1:<owner>`, and the unsuffixed key means something else entirely — an
**Unclaimed Local Vault**, written before Vaults were owner-bound, adopted only on a successful
Master Key unwrap and never deleted by that adoption.

The page was wrong in the way that costs the most: it named a real key that really exists, so a
developer following it found an answer rather than an error. An empty unsuffixed slot reads as
"this User has no Vault", and a populated one reads as "here is my Vault" when it may be somebody
else's ciphertext ([#511](https://github.com/mnaimfaizy/myorganiser/issues/511)).

`yarn vault:pages:check` passed the entire time. It asserted `page.storageKey ===
VAULT_STORAGE_KEY`, and `VAULT_STORAGE_KEY` is still `'myorganiser_vault_v1'` — because that
constant became the _prefix_ per-User keys are composed from
(`libs/web/vault/src/lib/vault/localVaultStorage.ts:61`). The string was byte-identical before and
after. Only its meaning changed, and no equality check can see that.

This is a general property of value-pinning gates, not a defect in this one.
[ADR 0043](0043-gates-assert-facts.md) already concedes that prose drift is unassertable and that
review is the only defence. This case is narrower and worse: the drift was not in prose, it was in
a manifest field the gate reads on every commit.

The obvious tightening — "require a page claiming `storageKey` to also declare the owner-scoped
composition" — could not have been written while the ADR 0047 work was in flight, because it would
have failed on `main`, correctly, for as long as the page was stale. That sequencing constraint is
now discharged: [#507](https://github.com/mnaimfaizy/myorganiser/pull/507) merged on 2026-08-26.

## Decision

**A gate cannot pin the meaning of a value, so it pins the structure the meaning lives in.**

Where a value has acquired a second thing next to it, the gate asserts the pair rather than the
value. `check-vault-pages.ts` now:

1. Asserts `localVaultKeys.unclaimed` against `VAULT_STORAGE_KEY`, as before.
2. Asserts `localVaultKeys.ownerScoped` against the composition **read out of
   `localVaultStorageKey()`'s template literal** — not against a pinned assembled string. A page
   claiming a shape that function no longer produces fails, even when every literal involved is
   unchanged.
3. Fails a manifest that declares one half of the pair without the other. A page naming where a
   Vault lives must name whose, and must say what the unsuffixed slot is instead.
4. Fails a manifest still declaring the bare `storageKey`, by name. The retired key is not
   silently ignored; a page carrying it is told what to declare instead.

Point 3 is the load-bearing one and generalises past the vault: **when a name splits into two
things, the gate requires both, so a page cannot describe half a world.** Declaring only the key
that used to be the whole answer is exactly the failure this ADR is about, and it is now a failure
the checker can see.

Point 4 is why the tightening is safe to land as a rule rather than as a one-off correction. A gate
that quietly skips an undeclared field would have let the assertion disappear along with the stale
claim, trading a wrong assertion for no assertion.

## Considered Options

- **Correct the page and leave the checker alone** — rejected, and it is the option the issue was
  filed against. It fixes the instance and preserves the mechanism that hid it. The next constant
  to be reinterpreted rather than renamed goes the same way, and the gate goes on printing OK.
- **Rename `VAULT_STORAGE_KEY` to `VAULT_STORAGE_KEY_PREFIX` and let the pin catch the rename** —
  rejected as the primary fix, though the name is genuinely poorer than it was. It works only when
  the author remembers to rename, which is the same discipline that failed here; and it forces a
  rename on every consumer to buy a doc assertion. The constant's doc comment already states that
  it is both the unsuffixed slot and the prefix, so the ambiguity is recorded where it matters.
- **Assert the manifest against a literal `'myorganiser_vault_v1:<owner>'` in the checker** —
  rejected. It is the same pin one layer along: a checker literal and a page literal agreeing
  proves the two files were edited together, not that either matches the code. Reading the template
  out of `localVaultStorageKey` means moving the composition breaks the gate.
- **Couple the gate to the diff — "`localVaultStorage.ts` changed, so the vault page must change"**
  — rejected under ADR 0043. It is satisfied by adding a comma, and it proves that a file moved,
  never that the right sentence did.
- **Apply the pair rule repo-wide now, to every value-pinning gate** — rejected as speculative.
  `storageKey` is the only field known to have been reinterpreted rather than changed. The rule
  above is stated generally so the next case is recognised; retrofitting it to fields that have not
  split would invent pairs nobody needs.

## Consequences

- `yarn vault:pages:check` covers 31 assertions rather than 30. `docs/vault/README.md` states the
  count and moves with it.
- The manifest key `storageKey` is retired. Any page reintroducing it fails with the name of what
  to declare instead, so the retirement does not depend on anyone remembering it.
- `libs/mobile/feat/vault/src/constants.ts:1` declares its own `VAULT_STORAGE_KEY` at the same
  value. It has no consumers — mobile never persists a Local Vault (ADR 0047, Consequences;
  [#485](https://github.com/mnaimfaizy/myorganiser/issues/485)) — and the vault pages describe the
  web constant only. Naming mobile on those pages would imply a mobile Local Vault exists.
- This does not make semantic drift generally detectable, and the rule should not be read as
  claiming so. It converts one class of it — a name that splits in two — from invisible into a
  failing check. The rest stays with review, as ADR 0043 says.

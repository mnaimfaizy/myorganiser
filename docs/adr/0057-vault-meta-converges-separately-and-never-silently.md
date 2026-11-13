# Vault Meta converges separately and never silently

## Status

accepted

Amended by [#1499](https://github.com/mnaimfaizy/myorganiser/issues/1499): decision 3 no longer returns adoption as a next Local Vault. The write is made from a fresh read and changes only the wrapping ([ADR 0143](0143-a-local-vault-write-is-conditional-on-the-ciphertext-it-read-and-a-contended-save-merges.md)).

## Context

Multi-device vault sync converges a User's Vault against the server's copy. A Vault has two
parts that arrive together and have nothing else in common: the **Vault Blobs**, which are the
Ciphertext, and the **Vault Meta**, which is what the Vault needs to be _opened_ — the KDF
parameters and the Master Key as wrapped by the passphrase and by the recovery key.

An earlier version of the design converged them as one thing. `reconcileVaultWithServer` built a
single comparable value, `{ meta, blobs }`, hashed both sides, and raised one whole-Vault prompt
when they differed. Grilling the design found that this is wrong, and wrong in a way that turns
the product's most routine security action into data loss.

**Changing a passphrase rewraps the same Master Key.** It does not re-encrypt anything. Every
Vault Blob stays byte-identical and fully readable on every device. So a User who changes their
passphrase on their phone produces exactly the state the combined comparison reads as whole-Vault
divergence: meta differs, data is identical. The old code then:

1. raised "We found encrypted vault data both locally and on the server, and they differ",
   which is false — the data was the same;
2. offered "Keep this device's data" and "Keep the server's data", neither of which is an answer
   to a question about a passphrase; and
3. on "Keep this device's data", called `putServerVaultMetaEtagAware` with the local wrapping,
   **silently reverting the passphrase change** the User had just made on their other device.

Two Vault Metas differing says nothing about whether their Vault Blobs can be merged. Whether two
sides may be merged is answered by decrypting the server's copy — which
[ADR 0054](0054-a-vault-blob-converges-by-record-and-absence-is-recorded.md) already established
and `convergeVaultBlob` already does. Meta equality answers a different question and was standing
in for that one.

The reverse direction is worse. **Adopting a remote wrapping is the one move that can brick a
Local Vault.** If the remote wrapping holds a _different_ Master Key — the Vault was
re-initialized elsewhere, not merely rewrapped — then every Vault Blob on this device is left
encrypted under a key nothing here can unwrap. And a wrapping cannot be verified without the
passphrase it was derived from, so there is no check to run before adopting it. The old
`keep-server` branch adopted the server's wrapping as a side effect of a User answering a question
about their _data_.

## Decision

**Vault Meta converges on its own terms, separately from the Vault Blobs, and is never replaced
without the User saying so.**

1. **Two convergences, not one.** `convergeVaultMeta`
   (`libs/web/vault/src/lib/vault/vaultMetaConverge.ts`) decides the wrapping.
   `convergeVaultBlob` decides the Ciphertext. Neither is an input to the other. A Vault Meta that
   diverges — or a meta check that fails outright — leaves every Vault Blob exactly as mergeable
   as it was.

2. **Vault Reconcile decides Vault Blobs only.** Meta is gone from both sides of its divergence
   comparison and from both answers to its prompt. `keep-local` no longer pushes a wrapping;
   `keep-server` keeps this device's wrapping and takes only the server's Ciphertext
   (`takeServerBlobsUnderLocalWrapping`). The single remaining meta write in reconcile is the
   first sync against a server holding no Vault Meta at all, where there is nothing to override
   and no other device whose change could be reverted.

3. **The convergence module structurally cannot write.** `convergeVaultMeta` takes
   `Pick<VaultApi, 'getVaultMeta'>` and nothing else, so no answer given to it can push a local
   wrapping over the server's. `getServerVaultMeta` was narrowed to the same one method for the
   same reason. Adoption is _returned_ for the caller to write, as the wrapping to adopt and the
   local wrapping it was decided against. Since [#1499](https://github.com/mnaimfaizy/myorganiser/issues/1499)
   that write is made from a fresh Local Vault read and changes only the wrapping
   ([ADR 0143](0143-a-local-vault-write-is-conditional-on-the-ciphertext-it-read-and-a-contended-save-merges.md)).

4. **The prompt is about the passphrase, not about the Vault.** "Your passphrase was changed on
   another device — start using it here?" It never presents the whole Vault as a single choice
   and never offers a data choice. This is also the security-relevant thing to tell a User:
   someone whose passphrase changed elsewhere and who did not change it should stop unlocking
   with the one they meant to retire.

5. **Which wrapping moved is named, and the naming is pinned.** `VAULT_META_CHANGES` is
   `['passphrase', 'recovery-key']`, in that order, and the facets read for each are a
   `satisfies Record<VaultMetaChange, VaultMetaFacet>` table
   ([ADR 0053](0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md)). The KDF
   parameters belong to the passphrase facet and nowhere else, because the recovery key wraps the
   Master Key directly without deriving anything. `version` is there for the conservative reason:
   it decides how a wrapping is read at all, and naming the passphrase is the safer answer when
   it moves. Passphrase is checked first because it is the wrapping that can lock a User out of
   their own device.

6. **Dismissal is `defer`, and defer writes nothing.** The same semantics
   [ADR 0033](0033-local-vaults-are-user-owned-and-never-silently-destroyed.md) established for
   the reconcile prompt: closing the dialog leaves both sides exactly as they were, sets no flag,
   and the question returns. `keep-local` is a given answer that also writes nothing — this device
   carries on unlocking the way it does, and the server keeps the wrapping the other device put
   there.

## Considered Options

**Gating blob merging on Vault Meta equality** is the design this ADR replaces. It is recorded
here rather than dropped because it is the intuitive reading — "different keys, different Vault,
don't merge" — and a future reader will propose it again. It is wrong because the premise is
false: different _wrappings_ are not different keys, and the wrapping moves for reasons the
contents never see.

**Verifying the remote wrapping before adopting it** was rejected as impossible rather than
undesirable. Verification means unwrapping, unwrapping means the passphrase it was derived from,
and that passphrase is on the other device. There is no check to run, which is exactly why the
answer must come from the User.

**Locking the Vault after adopting a remote wrapping** was considered and rejected as
speculative friction. The in-memory Master Key is unaffected by a rewrap of the same key, and if
the wrapping does hold a different key the User discovers it at the next unlock either way. The
runner saves and does not lock, matching what `kept-server-overwrote-local` already does.

**One prompt with three or more buttons**, covering data and passphrase together, was rejected as
the original bug in a new shape. Two unrelated questions sharing one answer is what made "keep
this device" revert a passphrase change.

## Consequences

- A passphrase change on another device is now an ordinary event: blobs merge normally, and the
  User gets one prompt naming the passphrase.
- Two prompts can be raised in one sign-in — the whole-Vault reconcile and the passphrase change.
  They are deliberately distinguishable in wording and in what each button does, and each is
  answerable without answering the other.
- A device can sit indefinitely on an old wrapping while merging data normally, if the User keeps
  declining. That is the intended shape: the alternative to a stale wrapping is a bricked Local
  Vault.
- `stableStringify` moved out of `vaultReconcile.ts` into its own module, shared by both
  convergences. Two comparison functions that disagreed about key order would report divergence
  that is not there.
- **`keep-server` changed meaning, deliberately.** It used to adopt the server's Vault Meta along
  with the server's Ciphertext; it now takes the Ciphertext under this device's wrapping. Where
  the server's blobs sit under a genuinely different Master Key, the old behaviour left the device
  readable and the new one does not. That trade is taken knowingly: the old behaviour bought
  readability by adopting a wrapping the User was never asked about, which is the brick this ADR
  exists to prevent, and the readable-looking outcome it produced was a different Vault wearing
  this User's device. The case is not silent — `convergeVaultBlob` already asks on
  `undecryptable-remote` before it gets here.
- **Server Vault Meta is now write-once from this codebase.** Deleting reconcile's `keep-local`
  push leaves `putServerVaultMetaEtagAware` with exactly one non-test caller: the first sync
  against a server that holds none. Nothing else writes it, and there is no change-passphrase
  sync flow yet, so the divergence this ADR prompts about cannot currently be produced in-app —
  it is reachable only by a second device that predates this change, or by a future
  change-passphrase flow. That flow is the follow-up this ADR implies and does not itself deliver;
  it is the piece that makes the prompt reachable, and it must write meta without reusing any of
  the paths removed here.

## Amendment: what "the question returns" means once the pass repeats

Decision point 6 says dismissal "sets no flag, and the question returns." That was written when
`VaultMetaConvergeRunner` ran its pass once per tab session, so "returns" meant _at the next tab
session_ — the only next pass there was. Setting no flag and returning were the same act, because
the flag was the only thing standing between a dismissal and the next opportunity to ask.

[ADR 0066](0066-a-convergence-pass-runs-freely-and-only-the-question-is-suppressed.md) separates the
pass from the question and puts the pass on window focus, which is what lets a passphrase changed
elsewhere reach an open tab at all ([#596](https://github.com/mnaimfaizy/myorganiser/issues/596)).
Under that trigger the two acts come apart: a dismissal that sets nothing returns at the next focus
event, which can be seconds later. That is nagging, and it is not what this ADR meant.

The intent stands and the mechanics move. Dismissal still writes nothing to the Vault, still adopts
nothing, and still leaves both sides exactly as they were — the guarantee this point exists to make.
What it now also does is record a session-scoped Vault Meta Refusal, so the question returns at the
next tab session rather than at the next focus. A refusal is not a Vault write and lives outside it;
"sets no flag" should be read as the promise it was making — that nothing about the Vault is
changed by declining to answer — rather than as a claim about the runner's own bookkeeping.

`keep-local` is unchanged in what it writes to the Vault, which is still nothing, but it now records
a durable Vault Meta Refusal rather than relying on a boolean that could not tell one wrapping from
another. This ADR's consequence that "a device can sit indefinitely on an old wrapping while merging
data normally, if the User keeps declining" survives intact, and gains the property it was assumed
to have: a _second_, genuinely different wrapping change still asks.

## Amendment: Vault Identity, and a guarantee this ADR claimed but did not have

Three corrections, all in the same place: what a Vault Blob decision may read from a Vault Meta.

**The enum has a third member.** Point 5 pins `VAULT_META_CHANGES` as `['passphrase', 'recovery-key']`.
It has been `['different-vault', 'passphrase', 'recovery-key']` since a User signing in with one Vault
on one device and another on a second was told "your passphrase was changed on another device" and
offered the button that adopts the server's wrapping over this device's Ciphertext. That fix landed in
code and tests without amending this ADR, which is how the pin and its record came apart. The salt is
what settles it — `changePassphrase` re-derives from the salt the Vault already has, `initialize` mints
a fresh one — so a moved salt is never a rotated passphrase. It is two Vaults. The third member reads
the salt alone, is ordered first so it wins the first-match scan, and is pinned non-adoptable.

**This ADR claimed a guarantee `convergeVaultBlob` did not make.** The Consequences say, justifying the
`keep-server` trade, that "the case is not silent — `convergeVaultBlob` already asks on
`undecryptable-remote` before it gets here". That is true only where this device has unsent changes.
On the clean path — nothing unsent locally, the server's Ciphertext differs — convergence takes the
remote copy without decrypting anything and without asking, which is
[#571](https://github.com/mnaimfaizy/myorganiser/issues/571). A trade this ADR accepted knowingly was
accepted partly on the strength of a check that does not run in the ordinary background case. The
sentence should be read as describing the dirty path only, and
[ADR 0067](0067-a-vault-blob-is-never-taken-across-a-vault-identity.md) closes the gap it names.

**Point 1's "neither is an input to the other" is narrowed, deliberately.** ADR 0067 has
`convergeVaultBlob` refuse to take a Vault Blob across a differing Vault Identity, which makes one fact
about a Vault Meta an input to a Vault Blob decision. What this ADR forbids is intact: gating
mergeability on Vault Meta **equality**, which is false-positive by construction because a rewrap moves
the meta without moving the key. Vault Identity is not equality. It is the single field that cannot
move without the Master Key moving, it fires on nothing this ADR protects, and it triggers a refusal
rather than an adoption — so no wrapping is ever taken on the strength of it. The separation this ADR
exists to defend is between the two convergences' _answers_, not a ban on the cheapest available proof
that two sides are not the same Vault at all.

# A Local Vault write is conditional on the Ciphertext it read, and every page save merges

## Status

accepted

Builds on [ADR 0054](0054-a-vault-blob-converges-by-record-and-absence-is-recorded.md) (merge by record) and [ADR 0114](0114-a-mobile-release-ships-in-1-0-what-it-cannot-learn-later.md) decision 3 (a client preserves what it does not understand). Settles [#1405](https://github.com/mnaimfaizy/myorganiser/issues/1405).

Amended by [#1501](https://github.com/mnaimfaizy/myorganiser/issues/1501): decision 3 used to merge only a contended save. It now merges every page save, including the first attempt. The filename keeps the old wording so that links keep working.

## Context

Every web Local Vault write had the same shape. It read the whole Local Vault, awaited key import and encryption, and wrote the whole object back. Anything another writer put there during those awaits was reverted, and that included other Vault Blob Types.

A page save fixed the records it would write when it was entered, so a Vault Pull that converged the same type during the save was overwritten with older records. Convergence's `takeRemote` had the same flaw in the other direction. It wrote back a Local Vault captured before its network awaits, so it could discard a local edit the server had never seen. That breaks the promise of Vault Pull that "a pull cannot discard a local edit". The Local Vault lives in `localStorage`, so another tab is a third writer.

The Local Vault Revision could not guard any of this. By definition an edit does not move it, and the convergence merge write does not move it either.

## Decision

1. **A write replaces one type.** Every Local Vault write replaces only its own Vault Blob Type's Ciphertext, on a Local Vault read synchronously just before the write. No await falls between that read and the write.
2. **"Moved" means the Ciphertext changed.** A save keeps the Ciphertext it read for its type, and the write goes ahead only if that type's Ciphertext is still identical. Every encryption has a fresh IV, so any write to the type, from any writer in any tab, changes it. There is no counter, and so no rule that every writer must remember to bump one.
3. **Every page save merges, and a contended one retries.** A page save never replaces the stored records. On every attempt, the first included, it merges its own envelope into what is stored with that type's pinned `mergeById` strategy. If the Ciphertext moved, it re-reads, merges again, re-encrypts, and checks again.
   - The stored blob is `local` and the save is `remote`. The User's edit wins on its newer timestamp. A record the page's list leaves out is kept: the page may be a stale tab that never saw it. A deletion takes effect only through the Deletion Log ([ADR 0054](0054-a-vault-blob-converges-by-record-and-absence-is-recorded.md)). Envelope Unknown Fields that a newer client wrote meanwhile are not put back to the save's stale copy.
   - The stored side is put through the type's normalizer before the merge, the same normalizer a page runs on load. A page's normalization write-back repairs fields without moving `updatedAt`, and a tie keeps `local`, so merging it into raw stored records would keep the raw copies.
   - Groceries is the exception for now. Its first attempt still writes the save as composed, and it merges only on contention. Its nested merge was outside #1501.
4. **Three attempts, then a typed error that writes nothing.** Callers already treat a failed save as failed. The stored state stays the converged one.
5. **The write funnel returns what it wrote.** Callers render the records or payload actually written, which after a merge includes what the pull brought. A merged save does not move the Local Vault Revision, because it is not a replacement.
6. **`takeRemote` stands down instead of retrying.** It writes the server's Ciphertext for its type only if that type's local Ciphertext is still the one convergence decided on. Otherwise a local edit landed, and convergence returns "superseded" and records no Sync Bookmark. The edit has already told the Vault Sync Sink, so the queue re-converges the type through the dirty path.

Reconcile's download of the server wrapping (made only when no Local Vault exists) and Import (a replacement the User asked for, ordered by [ADR 0063](0063-a-restore-discards-the-evidence-it-holds-about-the-server.md)) stay whole-Local-Vault writes.

## Considered Options

- **Merge only a contended save (this ADR as first written).** A stale tab's read is fresh, so the condition holds and its whole list replaces records another tab already wrote, silently ([#1501](https://github.com/mnaimfaizy/myorganiser/issues/1501)).

- **Reject a stale save and let the caller retry.** This is simpler inside the write path, but each of the five page hooks would have to re-read and re-apply the User's change. A hook that got it wrong would lose the edit.
- **A per-type write counter.** It would be blind to other tabs if kept in memory. If persisted, it would still depend on every writer bumping it, and the convergence merge write already shows that discipline fails.
- **The save as `local`.** It gives the User every tie, but can restore stale envelope Unknown Fields over a newer client's.

## Consequences

- Correctness rests on every edit path stamping `updatedAt` with the current time. All five types do today, and Subscriptions have no `createdAt` fallback. A new edit path that skips the stamp would lose to a stale save.
- Line edits do not advance a Grocery List's own `updatedAt`. That is harmless, because lines merge on their own stamps.
- Clock skew between devices decides merges here exactly as it already does in convergence.
- Leaving a record out of a page save no longer deletes it in any path. Every page delete passes the deleted id, which writes the Deletion Log.
- A record a stale tab adds lands after the stored records, not where that tab placed it. Pages that sort are unaffected.
- A stored entry with no usable `id`, such as a legacy string address or mobile number, is dropped from the stored side before it is normalized, as the merge already drops an entry it cannot match by `id`. Normalizing it would mint a fresh id, and the page's write-back mints another, so keeping it would store two copies. An entry the page loaded persists through the page's normalized write-back, which carries it with an id. An id-less entry the page never loaded is dropped, as convergence already drops it; only a pre-id client writing after the page loaded could leave one.
- A stale Groceries tab can still replace what another tab stored, when its first attempt meets no contention.

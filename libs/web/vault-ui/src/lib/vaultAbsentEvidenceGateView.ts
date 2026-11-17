/**
 * What the Vault Gate shows once Vault Absent Evidence has settled.
 *
 * Mirrors `vaultClaimEvidenceGateView.ts` for the `absent` branch
 * ([ADR 0066](../../../../docs/adr/0066-a-convergence-pass-runs-freely-and-only-the-question-is-suppressed.md),
 * decision point 4): one outcome carries on to the ordinary create offer,
 * because creating is safe exactly when the server holds nothing either. The
 * other three withhold it. `server-holds-vault` is the one with no ordinary
 * status to fall back to and no `cannot-check` copy either — the server did
 * answer, and what it said was "not this control": Vault Reconcile is
 * already bringing the real Vault onto this device, and minting a fresh
 * Master Key over it is the single most destructive control in the product,
 * offered at the moment a User is most likely to reach for it.
 *
 * Pinned rather than switched on, so a new Vault Absent Evidence outcome
 * fails to compile until somebody says what the User sees for it
 * ([ADR 0053](../../../../docs/adr/0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md)).
 */
import type { VaultAbsentEvidence } from '@myorganiser/web-vault';

export type VaultAbsentEvidenceGateView =
  /** Carry on as an ordinary absent device — the create offer is safe. */
  | { kind: 'vault-status'; status: 'absent' }
  /**
   * The server holds this User's Vault. Nothing here downloads it or offers
   * to create a new one over it — that is Vault Reconcile's write, already
   * running on its own trigger.
   */
  | { kind: 'awaiting-download'; title: string; description: string }
  /**
   * No answer about whether the server holds this User's Vault. Nothing is
   * offered and nothing is written.
   */
  | { kind: 'cannot-check'; title: string; description: string };

export const VAULT_ABSENT_EVIDENCE_GATE_VIEWS = {
  /**
   * The server holds nothing for this User either, so minting a fresh Master
   * Key destroys nothing that exists. The ordinary create offer.
   */
  'no-server-vault': { kind: 'vault-status', status: 'absent' },
  /**
   * The server already holds this User's Vault. The create offer would mint
   * a fresh Master Key and salt over it — a different Vault
   * (`VAULT_META_CHANGE_SAME_VAULT['different-vault']`, pinned `false` in
   * `vaultClaimEvidence.ts`) that a later convergence could never adopt back
   * over what the User meant to keep. Withheld while Vault Reconcile
   * downloads the real one instead.
   */
  'server-holds-vault': {
    kind: 'awaiting-download',
    title: 'Getting your vault back',
    description:
      'The server already holds a vault for your account. This device is bringing it back — this is not the moment to create a new one.',
  },
  postponed: {
    kind: 'cannot-check',
    title: 'We could not reach the server',
    description:
      'Checking for your vault needs the server, and we could not reach it. Nothing here was changed, and we will keep trying.',
  },
  'session-lost': {
    kind: 'cannot-check',
    title: 'Please sign in again',
    description:
      'Your session ended before we could check for your vault. Nothing here was changed.',
  },
} as const satisfies Record<
  VaultAbsentEvidence['kind'],
  VaultAbsentEvidenceGateView
>;

/**
 * What a reader shows while Vault Absent Evidence is still `checking`. One
 * sentence shared by the gate's checking screen and Dashboard Home, so the two
 * cannot drift apart. The gate keeps its own frame title; Home uses this one.
 */
export const VAULT_ABSENT_EVIDENCE_CHECKING_VIEW = {
  title: 'Checking for your vault',
  description: 'Checking whether your vault is already on the server…',
} as const;

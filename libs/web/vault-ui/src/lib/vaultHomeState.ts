/**
 * What Dashboard Home may say about the Vault, derived from the same two
 * answers `VaultGate` reads: the device's own Local Vault status, and Vault
 * Absent Evidence for a device holding none.
 *
 * Home is not a second gate and never creates anything: every state here only
 * decides which words and which link Home shows. It lives beside
 * `VAULT_ABSENT_EVIDENCE_GATE_VIEWS` so the one rule that matters — a create
 * call to action only once the server has proved it holds no Vault — is owned
 * here rather than re-derived on the Home page, and so Home and the gate
 * cannot drift apart ([ADR 0066](../../../../docs/adr/0066-a-convergence-pass-runs-freely-and-only-the-question-is-suppressed.md),
 * decision point 4).
 */
import type {
  LocalVaultStatus,
  VaultAbsentEvidence,
} from '@myorganiser/web-vault';

import type { VaultAbsentEvidenceState } from './useVaultAbsentEvidence';
import { VAULT_ABSENT_EVIDENCE_GATE_VIEWS } from './vaultAbsentEvidenceGateView';

/**
 * The states Home renders. `create` is reachable only from an absent device
 * with a settled `no-server-vault` answer; the four withheld states offer the
 * vault page and nothing that leads to creation from Home itself.
 */
export type VaultHomeState =
  /** The Vault is open on this device. */
  | 'unlocked'
  /** This device holds a Vault (or an Unclaimed Local Vault) that is shut. */
  | 'locked'
  /** No Vault here and the server holds none either: setting one up is safe. */
  | 'create'
  /** No Vault here, and the server question is still out (or no session yet). */
  | 'checking'
  /** No Vault here, but the server holds one Vault Reconcile is bringing back. */
  | 'server-holds-vault'
  /** No Vault here, and the server could not be reached to ask. */
  | 'postponed'
  /** No Vault here, and the Session ended before the server could answer. */
  | 'session-lost';

/** The Home states that withhold any create offer and show only copy. */
export type VaultHomeWithheldState = Exclude<
  VaultHomeState,
  'unlocked' | 'locked' | 'create'
>;

/**
 * Pinned per Vault Absent Evidence outcome, so a new outcome fails to compile
 * until somebody says what Home shows for it
 * ([ADR 0053](../../../../docs/adr/0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md)).
 */
const ABSENT_EVIDENCE_HOME_STATES = {
  'no-server-vault': 'create',
  'server-holds-vault': 'server-holds-vault',
  postponed: 'postponed',
  'session-lost': 'session-lost',
} as const satisfies Record<VaultAbsentEvidence['kind'], VaultHomeState>;

/**
 * Pinned per Local Vault status. Every status but `absent` keeps today's
 * locked treatment; `absent` defers to Vault Absent Evidence, which is the
 * only route to `create`.
 */
const LOCAL_STATUS_HOME_STATES = {
  owned: 'locked',
  unclaimed: 'locked',
  'owner-mismatch': 'locked',
  absent: null,
} as const satisfies Record<LocalVaultStatus, 'locked' | null>;

export interface VaultHomeStateInput {
  /** `handle.vaultStatus()`, or null when there is no Vault Session yet. */
  status: LocalVaultStatus | null;
  /** `handle.isUnlocked`. */
  unlocked: boolean;
  /** The session's `absentEvidence`. */
  absentEvidence: VaultAbsentEvidenceState;
}

/** Derives the one Home vault state every Home surface reads. */
export function deriveVaultHomeState({
  status,
  unlocked,
  absentEvidence,
}: VaultHomeStateInput): VaultHomeState {
  if (status === null) return 'checking';
  if (unlocked) return 'unlocked';
  const local = LOCAL_STATUS_HOME_STATES[status];
  if (local !== null) return local;
  if (absentEvidence.status === 'checking') return 'checking';
  return ABSENT_EVIDENCE_HOME_STATES[absentEvidence.result.kind];
}

/** A withheld state's title and sentence. */
export interface VaultHomeWithheldCopy {
  title: string;
  description: string;
}

/**
 * The words for each withheld state. The three settled ones are the vault
 * page's own titles and descriptions, read rather than copied; `checking`
 * matches the sentence `VaultGate` shows while the question is out.
 */
export const VAULT_HOME_WITHHELD_COPY = {
  checking: {
    title: 'Checking for your vault',
    description: 'Checking whether your vault is already on the server…',
  },
  'server-holds-vault': {
    title: VAULT_ABSENT_EVIDENCE_GATE_VIEWS['server-holds-vault'].title,
    description:
      VAULT_ABSENT_EVIDENCE_GATE_VIEWS['server-holds-vault'].description,
  },
  postponed: {
    title: VAULT_ABSENT_EVIDENCE_GATE_VIEWS.postponed.title,
    description: VAULT_ABSENT_EVIDENCE_GATE_VIEWS.postponed.description,
  },
  'session-lost': {
    title: VAULT_ABSENT_EVIDENCE_GATE_VIEWS['session-lost'].title,
    description: VAULT_ABSENT_EVIDENCE_GATE_VIEWS['session-lost'].description,
  },
} as const satisfies Record<VaultHomeWithheldState, VaultHomeWithheldCopy>;

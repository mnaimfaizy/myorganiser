/**
 * Which Vault states permit which Vault page operations (ADR 0068).
 *
 * The locked answer is **derived, not chosen per card**: a locked Vault blocks
 * exactly the operations that need the Master Key. Passphrase change and
 * Recovery Key rotation must unwrap or rewrap it and genuinely cannot run while
 * locked. Import, export, removal, and cloud backup touch only Ciphertext, and
 * unlock is a plaintext-access boundary rather than a network one (CONTEXT.md),
 * so a locked Vault never blocked them.
 *
 * `signed-out` and `no-local-vault` block everything, uniformly. That is
 * correctness rather than security: in those states there is no Local Vault for
 * any operation to act on.
 *
 * This table implements ADR 0068 §3 as written; whether uniform `no-local-vault`
 * blocking is right for import is deferred to PRD #658.
 *
 * Every answer lives in `VAULT_OPERATION_POLICY`, one `satisfies
 * Record<VaultOperation, …>` table (ADR 0053), so a seventh card cannot be added
 * without stating what it does while locked.
 */

/**
 * The operations the Vault page offers. Unlocking is not one of them: it is
 * the affordance that leaves the locked state rather than an operation gated by
 * it, and `VaultUnlockCard` renders only while locked.
 */
export const VAULT_OPERATIONS = {
  PassphraseChange: 'change-passphrase',
  RecoveryKeyRotation: 'rotate-recovery-key',
  PasskeyUnlock: 'passkey-unlock',
  CloudBackup: 'cloud-backup',
  Export: 'export',
  Removal: 'remove',
  Import: 'import',
} as const;

export type VaultOperation =
  (typeof VAULT_OPERATIONS)[keyof typeof VAULT_OPERATIONS];

/** The Vault states a card on this page can find itself in. */
export type VaultDisabledState =
  | 'signed-out'
  | 'no-local-vault'
  | 'locked'
  | 'enabled';

/**
 * One operation's entry in the policy.
 *
 * The union ties the locked copy to `needsMasterKey`: an operation that does not
 * need the Master Key has no locked sentence to write, because the policy does
 * not block it while locked. There is no way to state a locked reason for an
 * operation the policy permits, or to omit one for an operation it refuses.
 */
export type VaultOperationRule =
  | {
      /** Must unwrap or rewrap the Master Key, so it cannot run while locked. */
      readonly needsMasterKey: true;
      /** Why the operation is unavailable while the Vault is locked. */
      readonly whenLocked: string;
      /** Why the operation is unavailable with no Local Vault on this device. */
      readonly whenNoLocalVault: string;
    }
  | {
      /** Touches Ciphertext only, so a locked Vault does not block it. */
      readonly needsMasterKey: false;
      /** Why the operation is unavailable with no Local Vault on this device. */
      readonly whenNoLocalVault: string;
    };

/**
 * Being signed out reads the same for every operation, so it is one constant
 * rather than one copy per operation.
 */
export const VAULT_SIGNED_OUT_COPY =
  'Your vault is not available on this device right now.';

/** The one statement of the rule, pinned so no operation can omit an answer. */
export const VAULT_OPERATION_POLICY = {
  [VAULT_OPERATIONS.PassphraseChange]: {
    needsMasterKey: true,
    whenLocked: 'Unlock your vault to change its passphrase.',
    whenNoLocalVault:
      'Set up a local vault on this device to change its passphrase.',
  },
  [VAULT_OPERATIONS.RecoveryKeyRotation]: {
    needsMasterKey: true,
    whenLocked: 'Unlock your vault to rotate its recovery key.',
    whenNoLocalVault:
      'Set up a local vault on this device to rotate its recovery key.',
  },
  [VAULT_OPERATIONS.PasskeyUnlock]: {
    // Turning it on re-derives the Master Key from the passphrase; turning it off
    // is held to the same answer because the policy states one answer per operation.
    needsMasterKey: true,
    whenLocked: 'Unlock your vault to change Passkey Unlock on this device.',
    whenNoLocalVault:
      'Set up a local vault on this device to use Passkey Unlock.',
  },
  [VAULT_OPERATIONS.CloudBackup]: {
    needsMasterKey: false,
    whenNoLocalVault: 'There is no vault on this device to back up.',
  },
  [VAULT_OPERATIONS.Export]: {
    needsMasterKey: false,
    whenNoLocalVault: 'There is no vault on this device to export.',
  },
  [VAULT_OPERATIONS.Removal]: {
    needsMasterKey: false,
    whenNoLocalVault: 'There is no vault on this device to remove.',
  },
  [VAULT_OPERATIONS.Import]: {
    needsMasterKey: false,
    // States the reason rather than prescribing a remedy. It must not tell the
    // User to create a Local Vault first: that mints a Vault the import then
    // has to replace, and under ADR 0067 leaves this device holding a
    // different Vault Identity from the server in between.
    whenNoLocalVault: 'There is no vault on this device to import into.',
  },
} as const satisfies Record<VaultOperation, VaultOperationRule>;

/** What a card should do about one operation in one Vault state. */
export interface VaultOperationAvailability {
  /** Whether the card's controls are usable. */
  readonly allowed: boolean;
  /**
   * One sentence saying why the operation is unavailable, or `null` when it is
   * allowed. Cards render this instead of writing their own explanation.
   */
  readonly unavailableReason: string | null;
}

const ALLOWED: VaultOperationAvailability = {
  allowed: true,
  unavailableReason: null,
};

/**
 * Resolve the policy for one operation in one Vault state.
 *
 * Every card on the Vault page calls this rather than deciding for itself, so
 * the rule has exactly one statement.
 */
export function vaultOperationAvailability(
  operation: VaultOperation,
  state: VaultDisabledState,
): VaultOperationAvailability {
  const rule: VaultOperationRule = VAULT_OPERATION_POLICY[operation];

  switch (state) {
    case 'signed-out':
      return { allowed: false, unavailableReason: VAULT_SIGNED_OUT_COPY };
    case 'no-local-vault':
      return { allowed: false, unavailableReason: rule.whenNoLocalVault };
    case 'locked':
      return rule.needsMasterKey
        ? { allowed: false, unavailableReason: rule.whenLocked }
        : ALLOWED;
    case 'enabled':
      return ALLOWED;
    default: {
      const exhaustive: never = state;
      throw new Error(`Unhandled vault state: ${String(exhaustive)}`);
    }
  }
}

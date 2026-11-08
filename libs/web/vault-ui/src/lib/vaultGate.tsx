'use client';

import { Button, Input, Label, useToast } from '@myorganiser/web-ui';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type VaultHandle,
  MIN_PASSPHRASE_LENGTH,
  VaultSecretMismatchError,
  claimUnclaimedLocalVaultWithRecoveryKey,
  createDefaultAuditReporter,
  exportVault,
  newPassphraseSchema,
  replaceOwnedLocalVaultOnEvidence,
  replaceOwnedLocalVaultWithRecoveryKey,
} from '@myorganiser/web-vault';

import { downloadJsonFile } from './downloadFile';
import {
  RecoveryKeyClaimOffer,
  type RecoveryKeyClaimAnswer,
} from './RecoveryKeyClaimOffer';
import { PassphraseUnlockForm } from './PassphraseUnlockForm';
import { PasskeyUnlockOption } from './PasskeyUnlockOption';
import { usePasskeyUnlock } from './usePasskeyUnlock';
import { RecoveryKeyAcknowledgment } from './RecoveryKeyAcknowledgment';
import { UnacknowledgedRecoveryKeyBanner } from './UnacknowledgedRecoveryKeyBanner';
import { VaultGateFrame } from './VaultGateFrame';
import { useOptionalVaultSession } from './session';
import { useLocalVaultRevision } from './useLocalVaultRevision';
import { ABSENT_EVIDENCE_WITHOUT_OWNER } from './useVaultAbsentEvidence';
import { CLAIM_EVIDENCE_WITHOUT_OWNER } from './useVaultClaimEvidence';
import { VAULT_ABSENT_EVIDENCE_GATE_VIEWS } from './vaultAbsentEvidenceGateView';
import { VAULT_CLAIM_EVIDENCE_GATE_VIEWS } from './vaultClaimEvidenceGateView';
import { VaultReplaceOffer } from './VaultReplaceOffer';

/**
 * Shown under the unlock field when the passphrase does not open this vault.
 * The toast says the same thing and stays; this is the field-level answer.
 */
const PASSPHRASE_MISMATCH_MESSAGE =
  "That passphrase didn't unlock your vault. Nothing was changed.";

type VaultGateProps = {
  title: string;
  /**
   * The plural, lower-case name of what the gate withholds ("tasks"). Used in
   * the unlock screen's explanatory line. Omit it and the line is generic.
   */
  encryptedItems?: string;
  children: (ctx: { handle: VaultHandle | null }) => React.ReactNode;
};

export function VaultGate(props: VaultGateProps) {
  const { toast } = useToast();

  const vaultSession = useOptionalVaultSession();
  const handle = vaultSession?.handle ?? null;

  const {
    available: passkeyAvailable,
    unlocking: passkeyUnlocking,
    unlock: unlockWithPasskey,
  } = usePasskeyUnlock();
  const handlePasskeyUnlock = useCallback(() => {
    void unlockWithPasskey();
  }, [unlockWithPasskey]);

  // Both read from the Vault Session rather than asked here. The session asks
  // once per owner and `VaultReconcileRunner` waits on the same claim answer,
  // which a check run inside each gate could never have told it (#673). A gate
  // rendered without a session has no owner and gets the answers the hooks
  // give for none: nothing to claim, and a create offer withheld.
  const claimEvidence =
    vaultSession?.claimEvidence ?? CLAIM_EVIDENCE_WITHOUT_OWNER;
  const absentEvidence =
    vaultSession?.absentEvidence ?? ABSENT_EVIDENCE_WITHOUT_OWNER;

  // Vault Reconcile downloads the server's wrapping onto an absent device by
  // writing through `saveVault`, which bumps the Local Vault Revision. Without
  // subscribing to it below, a status change that replaces storage would be
  // invisible. The revision number is also read so a rotation bump re-checks
  // whether Recovery Key Acknowledgment is still owed (ADR 0069).
  const localVaultRevision = useLocalVaultRevision();

  // Live read of vault status from storage. No seeded state, no render-phase
  // reset — status is authoritative at every render because it is read from
  // the handle when the gate is invoked, and the handle is stable across
  // the read. Vault Reconcile replaces storage and bumps the Local Vault
  // Revision, which re-renders this component; a status change from another
  // tab stays invisible (not subscribed, and not in scope for this issue).
  const currentVaultStatus = handle?.vaultStatus() ?? 'absent';

  const [localMasterKeyBytes, setLocalMasterKeyBytes] =
    useState<Uint8Array | null>(null);

  type PendingReplace =
    | { source: 'server-meta' }
    | { source: 'recovery-key'; recoveryKey: string };

  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(
    null,
  );
  const [dismissedServerMetaOffer, setDismissedServerMetaOffer] =
    useState(false);

  const masterKeyBytes = vaultSession?.masterKeyBytes ?? localMasterKeyBytes;
  const setMasterKeyBytes =
    vaultSession?.setMasterKeyBytes ?? setLocalMasterKeyBytes;

  const [setupPassphrase, setSetupPassphrase] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [unacknowledgedRecoveryKey, setUnacknowledgedRecoveryKey] = useState<
    string | null
  >(null);
  const [recoveryKeyUnacknowledged, setRecoveryKeyUnacknowledged] =
    useState(false);

  const [passphrase, setPassphrase] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  // The state drives the busy render; the ref stops a second submit that lands
  // before the render that disables the button has happened.
  const unlockInFlight = useRef(false);

  const isUnlocked = masterKeyBytes !== null;

  useEffect(() => {
    if (!handle) {
      return;
    }

    let cancelled = false;

    handle
      .isRecoveryKeyUnacknowledged()
      .then((unacknowledged) => {
        if (!cancelled) {
          setRecoveryKeyUnacknowledged(unacknowledged);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecoveryKeyUnacknowledged(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [handle, localVaultRevision, currentVaultStatus]);

  // The remount banner is a second question (ADR 0069). The Passphrase
  // Reset Prompt is asked first, and the banner waits until that prompt
  // is set or skipped (ADR 0095). Creation's same-session hard gate above
  // is a different acknowledgment and is not delayed by this.
  const passphraseResetPromptOwed =
    vaultSession?.passphraseResetPromptOwed ?? false;
  const showRemountRecoveryKeyBanner =
    unacknowledgedRecoveryKey === null &&
    Boolean(handle) &&
    recoveryKeyUnacknowledged &&
    !passphraseResetPromptOwed;

  const handleAlreadyHaveRecoveryKey = useCallback((): void => {
    handle?.acknowledgeRecoveryKey();
    setRecoveryKeyUnacknowledged(false);
  }, [handle]);

  // The automatic (server-meta) replace offer has no explicit `pendingReplace`
  // of its own — `useVaultClaimEvidence` settling to `replace-offer` *is* the
  // offer, with nothing for the User to have supplied first. `pendingReplace`
  // only ever holds the recovery-key source, whose secret has to be carried
  // from the moment it was typed through to the confirm step. Deriving the
  // automatic source here, rather than writing it into `pendingReplace` via an
  // effect, keeps a `replace-offer` answer that arrives mid-render authoritative
  // without a render where the callbacks and the screen briefly disagree about
  // what is on offer.
  const autoOfferActive =
    currentVaultStatus === 'owned' &&
    !pendingReplace &&
    claimEvidence.status === 'settled' &&
    claimEvidence.result.kind === 'replace-offer' &&
    !dismissedServerMetaOffer;

  const effectivePendingReplace: PendingReplace | null = useMemo(
    () =>
      pendingReplace ?? (autoOfferActive ? { source: 'server-meta' } : null),
    [pendingReplace, autoOfferActive],
  );

  /**
   * The deliberate half of Vault Claim Evidence: the User says they hold a
   * recovery key for a Vault here, and supplies one.
   *
   * Every answer other than a claim is folded into one, including there being
   * no signed-in User to claim for. The offer is rendered whether or not this
   * device holds an Unclaimed Local Vault, so an answer a User could tell
   * apart from "nothing here" would disclose the one bit the offer exists to
   * withhold (CONTEXT.md, "Claim Offer").
   */
  const claimWithRecoveryKey = useCallback(
    async (key: string): Promise<RecoveryKeyClaimAnswer> => {
      // Answered without the library, and so without the decoy unwrap it would
      // have paid for. That asymmetry is timeable and deliberately left: the
      // only thing it tells whoever measured it is that they are not signed in,
      // which they knew before they typed. It says nothing about this device.
      if (!handle) return 'no-match';

      const result = await claimUnclaimedLocalVaultWithRecoveryKey({
        handle,
        recoveryKey: key,
      });

      if (result.kind === 'replace-offer') {
        // Evidence proved this Unclaimed Local Vault is also the signed-in User's,
        // but they already hold a Vault of their own here. Offer the explicit replace.
        setPendingReplace({ source: 'recovery-key', recoveryKey: key });
        return 'replace-offer';
      }

      if (result.kind !== 'claimed') return 'no-match';

      // Claimed and unlocked in one step: the evidence was the key, so there is
      // nothing further to ask for. The vault status is already 'owned' and will
      // be read live on the next render.
      setMasterKeyBytes(result.masterKeyBytes, 'recovery-key');
      toast({
        title: 'Vault claimed',
        description: 'This vault is yours and is unlocked on this device.',
      });
      return 'claimed';
    },
    [handle, setMasterKeyBytes, toast],
  );

  const exportVaultAboutToBeReplaced = useCallback(async (): Promise<void> => {
    if (!handle) return;
    const localVault = handle.loadVault();
    if (!localVault) return;
    const { text } = await exportVault({
      localVault,
      source: 'local-file',
      auditReporter: createDefaultAuditReporter(undefined, { strict: true }),
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJsonFile(
      `myorganiser-vault-about-to-be-replaced-${stamp}.json`,
      text,
    );
  }, [handle]);

  const confirmReplace = useCallback(async (): Promise<void> => {
    if (!handle || !effectivePendingReplace) return;

    const isRecoveryKeySource =
      effectivePendingReplace.source === 'recovery-key';

    if (isRecoveryKeySource) {
      const result = await replaceOwnedLocalVaultWithRecoveryKey({
        handle,
        recoveryKey: effectivePendingReplace.recoveryKey,
      });
      if (result.kind !== 'replaced') {
        toast({
          title: 'Replace failed',
          description:
            'That recovery key no longer matches. Nothing was changed.',
          variant: 'destructive',
        });
        setPendingReplace(null);
        return;
      }
      setMasterKeyBytes(result.masterKeyBytes, 'recovery-key');
    } else {
      const result = replaceOwnedLocalVaultOnEvidence({ handle });
      if (result.kind !== 'replaced') {
        toast({
          title: 'Replace failed',
          description: 'Nothing was changed.',
          variant: 'destructive',
        });
        setPendingReplace(null);
        return;
      }
    }

    setPendingReplace(null);

    // Only mark the server-meta offer as dismissed if it was actually used
    if (!isRecoveryKeySource) {
      setDismissedServerMetaOffer(true);
    }

    toast({
      title: 'Vault replaced',
      description: 'This device now uses the other vault that was also yours.',
    });
  }, [handle, effectivePendingReplace, setMasterKeyBytes, toast]);

  const declineReplace = useCallback((): void => {
    if (pendingReplace) {
      // Decline the recovery-key offer; don't touch the server-meta dismissal state
      setPendingReplace(null);
    } else {
      // Decline the server-meta offer
      setDismissedServerMetaOffer(true);
    }
  }, [pendingReplace]);

  const handleAcknowledgeRecoveryKey = useCallback((): void => {
    handle?.acknowledgeRecoveryKey();
    setUnacknowledgedRecoveryKey(null);
    setRecoveryKeyUnacknowledged(false);
  }, [handle]);

  const handleCreateVault = useCallback(async () => {
    if (!handle) {
      toast({
        title: 'Failed to create vault',
        description: 'Sign in to create a vault.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const result = await handle.initialize({
        passphrase: setupPassphrase,
      });
      setUnacknowledgedRecoveryKey(result.recoveryKey);
      toast({
        title: 'Vault created',
        description: 'Save your recovery key now.',
      });
    } catch (e: unknown) {
      toast({
        title: 'Failed to create vault',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  }, [handle, setupPassphrase, toast]);

  const handleUnlockWithRecoveryKey = useCallback(async () => {
    if (!handle) {
      toast({
        title: 'Recovery failed',
        description: 'Sign in to recover a vault.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const result = await handle.unlockWithRecoveryKey({
        recoveryKey: recoveryInput.trim(),
      });

      setMasterKeyBytes(result.masterKeyBytes, 'recovery-key');
      toast({
        title: 'Recovered',
        description: 'Vault unlocked with your recovery key.',
      });
    } catch (e: unknown) {
      if (e instanceof VaultSecretMismatchError) {
        toast({
          title: "That recovery key didn't unlock this vault",
          description:
            'The recovery key does not match this vault. Nothing was changed.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Recovery failed',
          description:
            'Something went wrong. Nothing on this device was changed.',
          variant: 'destructive',
        });
      }
    }
  }, [handle, recoveryInput, setMasterKeyBytes, toast]);

  const handleUnlockWithPassphrase = useCallback(async () => {
    if (!handle) {
      toast({
        title: 'Unlock failed',
        description: 'Sign in to unlock a vault.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const result = await handle.unlockWithPassphrase({
        passphrase,
      });
      setMasterKeyBytes(result.masterKeyBytes, 'passphrase');
      toast({
        title: 'Unlocked',
        description: 'Vault unlocked for this session.',
      });
    } catch (e: unknown) {
      if (e instanceof VaultSecretMismatchError) {
        setPassphraseError(PASSPHRASE_MISMATCH_MESSAGE);
        toast({
          title: "That passphrase didn't unlock this vault",
          description:
            'The passphrase does not match this vault. Nothing was changed.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Unlock failed',
          description:
            'Something went wrong. Nothing on this device was changed.',
          variant: 'destructive',
        });
      }
    }
  }, [handle, passphrase, setMasterKeyBytes, toast]);

  const handlePassphraseChange = useCallback((value: string): void => {
    setPassphrase(value);
    setPassphraseError(null);
  }, []);

  const handleUnlockSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (unlockInFlight.current) return;
      unlockInFlight.current = true;
      setPassphraseError(null);
      setUnlocking(true);
      try {
        await handleUnlockWithPassphrase();
      } finally {
        unlockInFlight.current = false;
        setUnlocking(false);
      }
    },
    [handleUnlockWithPassphrase],
  );

  const handleRecoverSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (recoveryInput.trim().length === 0) return;
      void handleUnlockWithRecoveryKey();
    },
    [recoveryInput, handleUnlockWithRecoveryKey],
  );

  const title = useMemo(() => props.title, [props.title]);

  const unlockDescription = props.encryptedItems
    ? `Your ${props.encryptedItems} are encrypted. Enter your passphrase to open them on this device.`
    : 'Your data is encrypted. Enter your passphrase to open it on this device.';

  // Recovery Key Acknowledgment: the User just created a Vault and needs to
  // record their key. This branch sits above the children branch so it is shown
  // before they have unlocked — they are still locked (masterKeyBytes is null
  // from create, never set). It must be above children and above any already-
  // unlocked branches so an already-unlocked session cannot sidestep the Acknowledgment.
  if (unacknowledgedRecoveryKey !== null) {
    return (
      <VaultGateFrame title={`${title}: Save your recovery key`}>
        <RecoveryKeyAcknowledgment
          recoveryKey={unacknowledgedRecoveryKey}
          onAcknowledge={handleAcknowledgeRecoveryKey}
        />
      </VaultGateFrame>
    );
  }

  if (isUnlocked && masterKeyBytes) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        {showRemountRecoveryKeyBanner && (
          <UnacknowledgedRecoveryKeyBanner
            surface="unlocked"
            onAlreadyHaveIt={handleAlreadyHaveRecoveryKey}
          />
        )}
        {props.children({
          handle: vaultSession?.handle ?? null,
        })}
      </div>
    );
  }

  if (currentVaultStatus === 'owned' && effectivePendingReplace) {
    return (
      <VaultGateFrame title={`${title}: Replace this device's vault?`}>
        <VaultReplaceOffer
          onExport={exportVaultAboutToBeReplaced}
          onConfirm={confirmReplace}
          onDecline={declineReplace}
        />
      </VaultGateFrame>
    );
  }

  // An Unclaimed Local Vault is never offered without proof it is the
  // signed-in User's (ADR 0061). Nothing about it is rendered until Vault
  // Claim Evidence has answered, and what the answer resolves to is pinned
  // rather than decided here.
  let effectiveVaultStatus = currentVaultStatus;
  if (currentVaultStatus === 'unclaimed') {
    if (claimEvidence.status === 'checking') {
      return (
        <VaultGateFrame
          title={title}
          footer={
            /* The check that is still out is the server one, and a recovery
               key needs no server — so the offer is available here for the
               same reason it is on every other screen, and withholding it
               until the check settles would time the offer's appearance to
               whether this device holds a Vault. */
            <RecoveryKeyClaimOffer onClaim={claimWithRecoveryKey} />
          }
        >
          {/* Says nothing about what this device holds — see the copy
              note in `vaultClaimEvidenceGateView.ts`. */}
          <p className="text-sm text-muted-foreground">
            Setting up your vault on this device…
          </p>
        </VaultGateFrame>
      );
    }

    const view = VAULT_CLAIM_EVIDENCE_GATE_VIEWS[claimEvidence.result.kind];

    if (view.kind === 'cannot-check') {
      return (
        <VaultGateFrame
          title={view.title}
          footer={
            /* A recovery key claim needs nothing from the server, so it stays
               available on the one screen a User reaches because the server
               could not be reached. Leaving it off here would make the
               action's own availability a presence tell. */
            <RecoveryKeyClaimOffer onClaim={claimWithRecoveryKey} />
          }
        >
          <p className="text-sm text-muted-foreground">{view.description}</p>
        </VaultGateFrame>
      );
    }

    if (view.kind === 'vault-status') {
      effectiveVaultStatus = view.status;
    }
  }

  // An absent device is never offered the create control without proof the
  // server holds nothing for this User, exactly as an Unclaimed Local Vault
  // is never offered without proof it is theirs (ADR 0066, decision point 4).
  if (currentVaultStatus === 'absent') {
    if (absentEvidence.status === 'checking') {
      return (
        <VaultGateFrame
          title={title}
          footer={
            /* The check that is still out is the server one, and a
               recovery key needs no server — available here for the same
               reason it is on every other withheld screen. */
            <RecoveryKeyClaimOffer onClaim={claimWithRecoveryKey} />
          }
        >
          <p className="text-sm text-muted-foreground">
            Checking whether your vault is already on the server…
          </p>
        </VaultGateFrame>
      );
    }

    const absentView =
      VAULT_ABSENT_EVIDENCE_GATE_VIEWS[absentEvidence.result.kind];

    if (
      absentView.kind === 'cannot-check' ||
      absentView.kind === 'awaiting-download'
    ) {
      return (
        <VaultGateFrame
          title={absentView.title}
          footer={<RecoveryKeyClaimOffer onClaim={claimWithRecoveryKey} />}
        >
          <p className="text-sm text-muted-foreground">
            {absentView.description}
          </p>
        </VaultGateFrame>
      );
    }

    // absentView.kind === 'vault-status': the server holds nothing either,
    // so `effectiveVaultStatus` stays 'absent' and the ordinary create offer
    // below is reached — no assignment needed.
  }

  if (effectiveVaultStatus !== 'owned') {
    const canCreate = newPassphraseSchema.safeParse({
      newPassphrase: setupPassphrase,
      newPassphraseConfirm: setupConfirm,
    }).success;

    return (
      <VaultGateFrame
        title={`${title}: Set encryption passphrase`}
        footer={
          /* This screen is what a User sees both when this device holds
             nothing and when it holds an Unclaimed Local Vault nothing has
             proved theirs, so the offer sits here precisely because the two
             are the same screen. */
          <RecoveryKeyClaimOffer onClaim={claimWithRecoveryKey} />
        }
      >
        <div className="space-y-2">
          <Label htmlFor="setup-passphrase">Encryption passphrase</Label>
          <Input
            id="setup-passphrase"
            type="password"
            value={setupPassphrase}
            onChange={(e) => setSetupPassphrase(e.target.value)}
            placeholder="Choose a strong passphrase"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="setup-confirm">Confirm passphrase</Label>
          <Input
            id="setup-confirm"
            type="password"
            value={setupConfirm}
            onChange={(e) => setSetupConfirm(e.target.value)}
            placeholder="Re-enter passphrase"
          />
          <p className="text-sm text-muted-foreground">
            Minimum {MIN_PASSPHRASE_LENGTH} characters. This passphrase never
            leaves your device.
          </p>
        </div>

        <Button
          className="w-full"
          disabled={!canCreate}
          onClick={handleCreateVault}
        >
          Create encrypted vault
        </Button>
      </VaultGateFrame>
    );
  }

  if (useRecovery) {
    const canRecover = recoveryInput.trim().length > 0;

    return (
      <VaultGateFrame
        title={`${title}: Recover`}
        footer={
          /* A User who is already `owned` here may also hold a recovery key
             for a second, unclaimed Vault on this device, and this is where
             they say so. */
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="link"
              className="h-auto min-h-8 self-start whitespace-normal text-left text-body-sm md:h-auto"
              onClick={() => setUseRecovery(false)}
            >
              Use passphrase
            </Button>
            <RecoveryKeyClaimOffer
              triggerStyle="link"
              onClaim={claimWithRecoveryKey}
            />
          </div>
        }
      >
        {showRemountRecoveryKeyBanner && (
          <UnacknowledgedRecoveryKeyBanner surface="locked" />
        )}
        <form onSubmit={handleRecoverSubmit} className="flex flex-col gap-4.5">
          <div className="space-y-2">
            <Label htmlFor="recovery-key">Recovery key</Label>
            <Input
              id="recovery-key"
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
              placeholder="Paste your recovery key"
            />
          </div>

          <Button
            type="submit"
            variant="brand"
            className="w-full"
            disabled={!canRecover}
          >
            Unlock with recovery key
          </Button>
        </form>
      </VaultGateFrame>
    );
  }

  return (
    <VaultGateFrame
      title="Unlock your vault"
      description={unlockDescription}
      footer={
        /* A User who is already `owned` here may also hold a recovery key
           for a second, unclaimed Vault on this device, and this is where
           they say so. */
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="link"
            className="h-auto min-h-8 self-start whitespace-normal text-left text-body-sm md:h-auto"
            onClick={() => setUseRecovery(true)}
          >
            Forgot it? Use your Recovery Key
          </Button>
          <RecoveryKeyClaimOffer
            triggerStyle="link"
            onClaim={claimWithRecoveryKey}
          />
        </div>
      }
    >
      {showRemountRecoveryKeyBanner && (
        <UnacknowledgedRecoveryKeyBanner surface="locked" />
      )}
      {passkeyAvailable && (
        <PasskeyUnlockOption
          unlocking={passkeyUnlocking}
          onUnlock={handlePasskeyUnlock}
        />
      )}
      <PassphraseUnlockForm
        value={passphrase}
        onChange={handlePassphraseChange}
        onSubmit={handleUnlockSubmit}
        error={passphraseError}
        unlocking={unlocking}
      />
    </VaultGateFrame>
  );
}

'use client';

import { Button, Input, Label } from '@myorganiser/web-ui';
import { useCallback, useState } from 'react';

/**
 * The single failure message, used identically whether the key was wrong or
 * nothing was found. This is the one enforcement point for the
 * indistinguishability that ADR 0061 requires.
 */
const RECOVERY_KEY_NO_MATCH_MESSAGE =
  'That recovery key did not unlock a vault on this device. Nothing on this device was changed.';

/**
 * What supplying a recovery key established. Three answers: a `claimed` means
 * the recovery key unlocked an Unclaimed Local Vault on this device; a
 * `replace-offer` means the recovery key also unlocks an Unclaimed Local Vault
 * but this User already holds an owned Vault here (so the gate offers the
 * choice to replace it); and `no-match` covers both an empty device and a
 * wrong key (a User can tell them apart from the key is a "a Vault is here"
 * disclosure with extra steps, so both are hidden under one answer).
 *
 * The `replace-offer` branch discloses nothing new: it reaches only when the
 * caller already knows this User holds a Local Vault here (status `owned`), so
 * confirming the recovery key's discovery of a second Vault can only mean the
 * User already knew about the Vault they own. The third answer, like the first,
 * means the parent takes over from here.
 */
export type RecoveryKeyClaimAnswer = 'claimed' | 'no-match' | 'replace-offer';

export type RecoveryKeyClaimOfferProps = {
  /** Attempt the claim with the recovery key the User supplied, trimmed. */
  onClaim: (recoveryKey: string) => Promise<RecoveryKeyClaimAnswer>;
};

/**
 * The recovery-key half of the Claim Offer: the interface through which a User
 * asserts "I have a recovery key for a Vault on this device" and supplies one.
 *
 * The component must never be able to tell, and must never be able to show,
 * whether an Unclaimed Local Vault is present on this device. It is rendered
 * unconditionally on screens a User who does not hold their own Vault sees, and
 * also on screens where a User already holds a Vault of their own (so a matched
 * recovery key may offer to replace it). Its only failure answer is a single
 * fixed message, identical whether the key was wrong or the device holds
 * nothing — same words, same resulting state, no extra hint. Making the
 * component blind to the difference (it only ever receives 'no-match') is how
 * that is guaranteed structurally rather than by discipline (ADR 0061).
 *
 * Collapsed by default because supplying a recovery key is a deliberate User
 * action; an open form beneath something that reads as an offered Vault would
 * itself become a hint that there is something here to fill in for.
 */
export function RecoveryKeyClaimOffer(
  props: RecoveryKeyClaimOfferProps,
): React.ReactNode {
  const [isExpanded, setIsExpanded] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedInput = recoveryKeyInput.trim();
  const isSubmitDisabled = trimmedInput.length === 0 || isSubmitting;

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      // Clear any previous message: a new submit starts fresh.
      setErrorMessage(null);
      setIsSubmitting(true);

      // A rejection is not a third answer. Whatever the claim threw, the User
      // is told the one thing this component is allowed to tell them, so the
      // failure is turned into that answer here rather than into a branch that
      // has to remember to agree with the other one.
      const answer = await props
        .onClaim(trimmedInput)
        .catch((): RecoveryKeyClaimAnswer => 'no-match');

      setIsSubmitting(false);

      if (answer === 'claimed' || answer === 'replace-offer') {
        // The parent takes over from here. Reset so that a later render of
        // this offer — another User signing into the same tab — starts where a
        // fresh one would rather than mid-flow.
        setRecoveryKeyInput('');
        setIsExpanded(false);
        return;
      }

      setErrorMessage(RECOVERY_KEY_NO_MATCH_MESSAGE);
    },
    [trimmedInput, props],
  );

  const handleCancel = useCallback(() => {
    setIsExpanded(false);
    setRecoveryKeyInput('');
    setErrorMessage(null);
  }, []);

  if (!isExpanded) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="h-auto w-full whitespace-normal py-3 md:h-auto"
        onClick={() => setIsExpanded(true)}
      >
        I have a recovery key for a vault on this device
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="claim-recovery-key">Recovery key</Label>
        <Input
          id="claim-recovery-key"
          type="text"
          placeholder="Paste your recovery key"
          value={recoveryKeyInput}
          onChange={(e) => setRecoveryKeyInput(e.target.value)}
        />
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitDisabled}>
          Claim this vault
        </Button>
        <Button type="button" variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

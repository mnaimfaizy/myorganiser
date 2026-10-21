'use client';

import { Button, Input, Label, useToast } from '@myorganiser/web-ui';
import { useCallback } from 'react';
import { downloadTextFile } from './downloadFile';

export type RecoveryKeyAcknowledgmentProps = {
  /** The key just minted. Held by the caller in memory only; never persisted. */
  recoveryKey: string;
  /** The User states they have recorded it. Ends the Acknowledgment. */
  onAcknowledge: () => void;
};

/**
 * The acknowledgment screen shown immediately after a new Local Vault is created.
 * The User must record their Recovery Key before proceeding. This component renders
 * the key in a read-only input with options to download or copy it, and a button
 * to confirm they have saved it.
 *
 * The Recovery Key plaintext is never persisted; it is shown once in this
 * session and stored nowhere the product can reach. The pending Acknowledgment
 * record (fingerprint only, not the key) is durable on the VaultHandle (ADR
 * 0069) and survives remount until the User acknowledges or confirms they
 * already hold the key (CONTEXT.md, "Recovery Key Acknowledgment").
 */
export function RecoveryKeyAcknowledgment(
  props: RecoveryKeyAcknowledgmentProps,
): React.ReactNode {
  const { toast } = useToast();
  const { recoveryKey, onAcknowledge } = props;

  const handleDownload = useCallback(() => {
    downloadTextFile(
      'myorganiser-recovery-key.txt',
      `MyOrganiser Recovery Key\n\n${recoveryKey}\n\nKeep this safe. Anyone with it can decrypt your vault.`,
    );
  }, [recoveryKey]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(recoveryKey);
    toast({
      title: 'Copied',
      description: 'Recovery key copied',
    });
  }, [recoveryKey, toast]);

  const handleAcknowledge = useCallback(() => {
    onAcknowledge();
    toast({
      title: 'Next step',
      description: 'Unlock your vault with your passphrase.',
    });
  }, [onAcknowledge, toast]);

  return (
    <div className="space-y-2">
      <Label htmlFor="acknowledgment-recovery-key">
        Recovery key (save this)
      </Label>
      <div className="rounded-control border border-dashed border-brand bg-brand-soft p-3">
        <Input
          id="acknowledgment-recovery-key"
          readOnly
          value={recoveryKey}
          className="border-0 bg-transparent px-0 font-mono shadow-none"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleDownload}>
          Download recovery key
        </Button>
        <Button type="button" variant="secondary" onClick={handleCopy}>
          Copy
        </Button>
        <Button type="button" variant="secondary" onClick={handleAcknowledge}>
          I saved it
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Next time, unlock with your passphrase. If you forget it, you can
        recover with the recovery key.
      </p>
    </div>
  );
}

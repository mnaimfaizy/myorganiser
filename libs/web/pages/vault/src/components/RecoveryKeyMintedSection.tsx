'use client';

import { UseFormReturn } from 'react-hook-form';

import {
  Button,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
} from '@myorganiser/web-ui';
import {
  ServerReachabilityNotice,
  useServerReachability,
} from '@myorganiser/web-vault-ui';
import type { MintedRecoveryKey } from '@myorganiser/web-vault';

import type { RotationFormInput } from './RecoveryKeyRotationForm';

interface RecoveryKeyMintedSectionProps {
  mintedKey: MintedRecoveryKey;
  form: UseFormReturn<RotationFormInput>;
  /** True when the Vault operation policy refuses the rotation in the current state. */
  disabled: boolean;
  onDownload: () => void;
  onCopy: () => Promise<void>;
}

/**
 * Shows the minted key, its save actions, and the confirm field. The Cancel and
 * rotate buttons belong to the surrounding form's layout footer, not here.
 */
export function RecoveryKeyMintedSection({
  mintedKey,
  form,
  disabled,
  onDownload,
  onCopy,
}: RecoveryKeyMintedSectionProps) {
  // useServerReachability lives here because this component mounts only when
  // a recovery key is minted. That mount/unmount lifetime is the probe's
  // lifetime — it probes on mount and refreshes on window focus. Hoisting to
  // the rotation form would fire a network request for every User who
  // visits vault settings, the vast majority of whom never rotate.
  const { reachability, recheck } = useServerReachability();

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="recovery-key-rotation-key-display">
          Recovery key (save this)
        </Label>
        <Input
          id="recovery-key-rotation-key-display"
          readOnly
          value={mintedKey}
          data-testid="recovery-key-rotation-key"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            data-testid="recovery-key-rotation-download"
            onClick={onDownload}
          >
            Download
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-testid="recovery-key-rotation-copy"
            onClick={onCopy}
          >
            Copy
          </Button>
        </div>
      </div>

      <FormField
        control={form.control}
        name="confirmRecoveryKey"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Confirm you have the recovery key</FormLabel>
            <FormControl>
              <Input
                {...field}
                type="text"
                data-testid="recovery-key-rotation-confirm"
                placeholder="Paste the recovery key shown above"
                disabled={disabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* ServerReachabilityNotice is shown, never gated on. The "Rotate recovery
      key" button remains enabled even if the server is unreachable, because
      the local rotation is correct to perform regardless of network state. */}
      <ServerReachabilityNotice
        reachability={reachability}
        onRecheck={recheck}
      />
    </div>
  );
}

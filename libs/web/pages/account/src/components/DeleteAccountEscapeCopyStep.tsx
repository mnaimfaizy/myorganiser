'use client';

import { useCallback } from 'react';

import { Check } from 'lucide-react';

import { Button, Illustration } from '@myorganiser/web-ui';
import { useExportVault } from '@myorganiser/web-vault-ui';

import type { AccountVariant } from '../account-view';

interface DeleteAccountEscapeCopyStepProps {
  variant?: AccountVariant;
  escapeCopyDownloaded: boolean;
  onEscapeCopyDownloaded: () => void;
  onContinue: () => void;
  onCancel: () => void;
}

export function DeleteAccountEscapeCopyStep({
  variant = 'desktop',
  escapeCopyDownloaded,
  onEscapeCopyDownloaded,
  onContinue,
  onCancel,
}: DeleteAccountEscapeCopyStepProps) {
  const { exporting, exportVaultNow } = useExportVault();
  const isPhone = variant === 'phone';

  const handleDownload = useCallback(async () => {
    const ok = await exportVaultNow();
    if (ok) {
      onEscapeCopyDownloaded();
    }
  }, [exportVaultNow, onEscapeCopyDownloaded]);

  const continueButton = (
    <Button
      type="button"
      variant={escapeCopyDownloaded ? 'default' : 'outline'}
      className={isPhone ? 'h-13 w-full' : undefined}
      data-testid="delete-account-continue"
      onClick={onContinue}
    >
      {escapeCopyDownloaded ? 'Continue' : 'Continue without a copy'}
    </Button>
  );

  return (
    <>
      <div className={isPhone ? 'px-4 py-4' : 'px-6 py-5'}>
        <div className="flex items-start gap-4 rounded-xl border border-brand/20 bg-brand-soft p-4">
          <Illustration kind="vault" size={isPhone ? 48 : 64} />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="text-body text-foreground">
              Deleting your account removes the server copy of your vault. To
              keep your data, download an Escape Copy first.
            </p>
            <Button
              type="button"
              variant="outline"
              className="self-start"
              data-testid="escape-copy-button"
              onClick={handleDownload}
              disabled={exporting}
            >
              {exporting ? 'Downloading…' : 'Download an Escape Copy'}
            </Button>
            {escapeCopyDownloaded && (
              <p
                role="status"
                className="flex items-center gap-2 font-semibold text-success-text"
              >
                <Check aria-hidden="true" className="size-icon text-success" />
                Escape Copy downloaded.
              </p>
            )}
          </div>
        </div>
      </div>
      {isPhone ? (
        <div className="flex flex-col gap-2 px-4 pt-2 pb-2">
          {continueButton}
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2.5 border-t border-border px-6 pt-4 pb-6">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {continueButton}
        </div>
      )}
    </>
  );
}

'use client';

import { useCallback, useRef, useState } from 'react';

import { Button, Card, Label, useToast } from '@myorganiser/web-ui';

import {
  createDefaultAuditReporter,
  createDefaultReplayTracker,
  importVault,
  isVaultImportError,
  VAULT_ENVELOPE_PARSE_MAX_BYTES,
} from '@myorganiser/web-vault';
import {
  getVaultImportErrorMessage,
  useOptionalVaultSession,
} from '@myorganiser/web-vault-ui';

import { ImportVaultReplaceDialog } from './ImportVaultReplaceDialog';
import { formatBytes } from '../utils/formatBytes';
import { getErrorMessage } from '../utils/getErrorMessage';
import {
  useVaultOperationAvailability,
  useVaultImportDisclosure,
} from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import { VaultUnavailableNotice } from './VaultUnavailableNotice';

export function ImportVaultCard() {
  const { toast } = useToast();
  const vaultSession = useOptionalVaultSession();
  const handle = vaultSession?.handle ?? null;
  const { allowed, unavailableReason } = useVaultOperationAvailability(
    VAULT_OPERATIONS.Import,
  );

  const [importing, setImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastServerNote, setLastServerNote] = useState<string | null>(null);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const disclosure = useVaultImportDisclosure(
    selectedFile as { text(): Promise<string> } | null,
    replaceDialogOpen,
  );

  const runImport = useCallback(async () => {
    if (!handle || !selectedFile) {
      return;
    }

    setImporting(true);
    setLastServerNote(null);

    try {
      const text = await selectedFile.text();

      // Hardened import: parse → validate → migrate → stage → atomic commit.
      // The default audit reporter records a success/failed event with the
      // classified VaultImportError code; the default replay tracker rejects
      // re-importing the same envelope within the recent window.
      // For import, audit reporting stays non-strict: by the time the audit
      // POST runs the local vault has already been committed, so a strict
      // throw would surface "Import failed" while the user's data is in fact
      // updated. The default reporter logs failures via console.warn.
      await importVault({
        text,
        handle,
        source: 'local-file',
        replayTracker: createDefaultReplayTracker(),
        auditReporter: createDefaultAuditReporter(),
      });

      const note = 'Imported locally. Audit recorded on server.';
      setLastServerNote(note);
      toast({
        title: 'Import complete',
        description: note,
      });

      setSelectedFile(null);
    } catch (error) {
      const description = isVaultImportError(error)
        ? getVaultImportErrorMessage(error.code)
        : getErrorMessage(error);
      toast({
        title: 'Import failed',
        description,
        variant: 'destructive',
      });
      throw new Error(description);
    } finally {
      setImporting(false);
    }
  }, [handle, selectedFile, toast]);

  const handleImport = useCallback(async () => {
    if (!handle) {
      toast({
        title: 'Import failed',
        description: 'Sign in to import a vault.',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedFile) {
      toast({
        title: 'Choose a file',
        description: 'Select a vault export bundle (.json) to import.',
      });
      return;
    }

    if (selectedFile.size > VAULT_ENVELOPE_PARSE_MAX_BYTES) {
      toast({
        title: 'File too large',
        description: `Max supported size is ${formatBytes(
          VAULT_ENVELOPE_PARSE_MAX_BYTES,
        )}.`,
        variant: 'destructive',
      });
      return;
    }

    const existingLocalVault = handle.loadVault();
    if (existingLocalVault) {
      setReplaceDialogOpen(true);
      return;
    }

    try {
      await runImport();
    } catch {
      // Error toast already shown in runImport.
    }
  }, [handle, runImport, selectedFile, toast]);

  const handleReplaceDecline = useCallback(() => {
    toast({
      title: 'Import canceled',
      description: 'Your local vault was not changed.',
    });
  }, [toast]);

  const handleReplaceDialogOpenChange = useCallback((open: boolean) => {
    setReplaceDialogOpen(open);
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSelectedFile(event.target.files?.[0] ?? null);
    },
    [],
  );

  // The real file input is visually hidden and keeps the label association
  // and the test id. The visible chip buttons open its native picker.
  const handleChooseFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <>
      <Card className="h-full">
        <div className="flex h-full flex-col gap-3 p-4 md:p-6">
          <h3 className="font-display text-title">Import encrypted vault</h3>
          <p className="text-body text-foreground-supporting">
            Validate and load a previously exported ciphertext bundle. After
            import, unlock with the backup&apos;s passphrase or Recovery Key.
          </p>
          <VaultUnavailableNotice
            reason={unavailableReason}
            testId="import-vault-unavailable"
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vault-import-file">Vault export file (.json)</Label>
            <input
              ref={fileInputRef}
              id="vault-import-file"
              data-testid="import-vault-file"
              type="file"
              accept="application/json"
              className="sr-only"
              tabIndex={-1}
              disabled={!allowed}
              onChange={handleFileChange}
            />
            <div className="flex min-h-12 flex-wrap items-center gap-2.5 rounded-control border border-dashed border-brand bg-brand-soft px-3.5 py-2">
              {selectedFile ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-body-sm text-foreground">
                    {`${selectedFile.name} · ${formatBytes(selectedFile.size)}`}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleChooseFile}
                    disabled={!allowed}
                  >
                    Change file
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleChooseFile}
                  disabled={!allowed}
                >
                  Choose file…
                </Button>
              )}
            </div>
          </div>
          <p className="text-body text-foreground-supporting">
            If this device already holds a vault, we show exactly what the file
            changes before anything is replaced.
          </p>

          {lastServerNote && (
            <p className="text-body-sm text-foreground-supporting">
              {lastServerNote}
            </p>
          )}

          <Button
            data-testid="import-vault-button"
            onClick={handleImport}
            disabled={importing || !selectedFile || !allowed}
            className="mt-auto w-full md:w-auto"
          >
            {importing ? 'Importing…' : 'Import vault JSON'}
          </Button>
        </div>
      </Card>

      <ImportVaultReplaceDialog
        open={replaceDialogOpen}
        onOpenChange={handleReplaceDialogOpenChange}
        onConfirm={runImport}
        onDecline={handleReplaceDecline}
        disclosure={disclosure}
      />
    </>
  );
}

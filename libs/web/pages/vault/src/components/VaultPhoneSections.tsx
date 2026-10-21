'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import {
  ListGroup,
  ListGroupHeader,
  ListGroupHeaderTitle,
  ListGroupRow,
  ListGroupRowBody,
  ListGroupRowMeta,
  ListGroupRowTitle,
  ListGroupRowTrailing,
} from '@myorganiser/web-ui';

import {
  useChangePassphraseMode,
  useVaultOperationAvailability,
} from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import { ROTATION_DESCRIPTION } from './RecoveryKeyRotationCard';
import { REMOVE_VAULT_DESCRIPTION } from './RemoveVaultCard';
import { RemoveVaultDialog } from './RemoveVaultDialog';

const ACCESS_HEADING_ID = 'vault-phone-access-heading';
const BACKUPS_HEADING_ID = 'vault-phone-backups-heading';
const DANGER_HEADING_ID = 'vault-phone-danger-heading';

const ESCAPE_COPY_META =
  'Keep an encrypted copy of your vault in your own Google Drive, so it outlives MyOrganiser.';
const EXPORT_META = 'Download a ciphertext-only JSON bundle.';
const IMPORT_META =
  'Validate and load a previously exported ciphertext bundle.';
const READER_META =
  'A self-contained reader that works offline and needs no account';

interface VaultPhoneNavRowProps {
  title: string;
  meta: string;
  href: string;
}

/** A navigation row: a link with a trailing chevron. */
function VaultPhoneNavRow({ title, meta, href }: VaultPhoneNavRowProps) {
  return (
    <ListGroupRow asChild size="navigation" interactive>
      <Link href={href}>
        <ListGroupRowBody>
          <ListGroupRowTitle>{title}</ListGroupRowTitle>
          <ListGroupRowMeta>{meta}</ListGroupRowMeta>
        </ListGroupRowBody>
        <ListGroupRowTrailing>
          <ChevronRight aria-hidden="true" className="text-inactive" />
        </ListGroupRowTrailing>
      </Link>
    </ListGroupRow>
  );
}

interface VaultPhoneBlockedRowProps {
  title: string;
  reason: string | null;
}

/** A blocked navigation row: not a link, dimmed, with the policy reason as its meta. */
function VaultPhoneBlockedRow({ title, reason }: VaultPhoneBlockedRowProps) {
  return (
    <ListGroupRow size="navigation" aria-disabled="true" className="opacity-50">
      <ListGroupRowBody>
        <ListGroupRowTitle>{title}</ListGroupRowTitle>
        <ListGroupRowMeta>{reason}</ListGroupRowMeta>
      </ListGroupRowBody>
    </ListGroupRow>
  );
}

/**
 * The phone layout of the Vault page below md: three grouped sections, each a
 * ListGroup under a caps header. Used instead of the desktop cards, never beside them.
 */
export function VaultPhoneSections() {
  const mode = useChangePassphraseMode();
  const passphrase = useVaultOperationAvailability(
    VAULT_OPERATIONS.PassphraseChange,
  );
  const rotation = useVaultOperationAvailability(
    VAULT_OPERATIONS.RecoveryKeyRotation,
  );
  const removal = useVaultOperationAvailability(VAULT_OPERATIONS.Removal);

  const [removeOpen, setRemoveOpen] = useState(false);

  const handleOpenRemove = useCallback(() => {
    setRemoveOpen(true);
  }, []);

  const handleRemoveOpenChange = useCallback((open: boolean) => {
    setRemoveOpen(open);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={ACCESS_HEADING_ID} className="flex flex-col">
        <ListGroupHeader>
          <ListGroupHeaderTitle id={ACCESS_HEADING_ID}>
            Access
          </ListGroupHeaderTitle>
        </ListGroupHeader>
        <ListGroup>
          {passphrase.allowed ? (
            <VaultPhoneNavRow
              title={mode.title}
              meta={mode.description}
              href="/dashboard/vault/passphrase"
            />
          ) : (
            <VaultPhoneBlockedRow
              title={mode.title}
              reason={passphrase.unavailableReason}
            />
          )}
          {rotation.allowed ? (
            <VaultPhoneNavRow
              title="Rotate recovery key"
              meta={ROTATION_DESCRIPTION}
              href="/dashboard/vault/recovery-key"
            />
          ) : (
            <VaultPhoneBlockedRow
              title="Rotate recovery key"
              reason={rotation.unavailableReason}
            />
          )}
        </ListGroup>
      </section>

      <section aria-labelledby={BACKUPS_HEADING_ID} className="flex flex-col">
        <ListGroupHeader>
          <ListGroupHeaderTitle id={BACKUPS_HEADING_ID}>
            Backups and moving your vault
          </ListGroupHeaderTitle>
        </ListGroupHeader>
        <ListGroup>
          <VaultPhoneNavRow
            title="Encrypted Escape Copy"
            meta={ESCAPE_COPY_META}
            href="/dashboard/vault/backups"
          />
          <VaultPhoneNavRow
            title="Export encrypted vault"
            meta={EXPORT_META}
            href="/dashboard/vault/backups"
          />
          <VaultPhoneNavRow
            title="Import encrypted vault"
            meta={IMPORT_META}
            href="/dashboard/vault/backups"
          />
          <VaultPhoneNavRow
            title="Open your Escape Copy without us"
            meta={READER_META}
            href="/dashboard/vault/reader"
          />
        </ListGroup>
      </section>

      <section aria-labelledby={DANGER_HEADING_ID} className="flex flex-col">
        <ListGroupHeader>
          <ListGroupHeaderTitle
            id={DANGER_HEADING_ID}
            className="text-destructive-text"
          >
            Danger zone
          </ListGroupHeaderTitle>
        </ListGroupHeader>
        <ListGroup className="border-destructive-edge">
          <ListGroupRow asChild size="default" interactive={removal.allowed}>
            <button
              type="button"
              data-testid="remove-vault-button"
              disabled={!removal.allowed}
              onClick={handleOpenRemove}
              className="w-full text-left"
            >
              <ListGroupRowBody>
                <ListGroupRowTitle className="text-destructive-text">
                  Remove local vault
                </ListGroupRowTitle>
                <ListGroupRowMeta>
                  {removal.allowed
                    ? REMOVE_VAULT_DESCRIPTION
                    : removal.unavailableReason}
                </ListGroupRowMeta>
              </ListGroupRowBody>
            </button>
          </ListGroupRow>
        </ListGroup>
      </section>

      <RemoveVaultDialog
        open={removeOpen}
        onOpenChange={handleRemoveOpenChange}
      />
    </div>
  );
}

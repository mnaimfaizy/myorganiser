'use client';

import {
  Button,
  Card,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@myorganiser/web-ui';
import * as React from 'react';
import { formatDistance } from 'date-fns';
import { formatDate } from './formatDate';

/**
 * Connection state shown by {@link CloudBackupCard}. Mirrors the discriminated
 * union exported by `@myorganiser/web-vault` but kept local so this component
 * has no runtime dependency on the vault library.
 */
export type CloudBackupCardConnection =
  | { status: 'not-linked' }
  | { status: 'linked' }
  | { status: 'reconnect-needed'; reason?: string };

export type CloudBackupCardAgeLimit = 'off' | '1-day' | '1-week' | '1-month';

/** Minimal record shape for showing the latest Escape Copy timestamp. */
export interface CloudBackupCardRecord {
  source: string;
  status: string;
  createdAt: string;
}

export interface CloudBackupCardProps {
  /** Display name for the provider. Defaults to `'Google Drive'`. */
  providerLabel?: string;
  connection: CloudBackupCardConnection;
  ageLimit: CloudBackupCardAgeLimit;
  /** Latest successful provider-scoped Escape Copy record. */
  latestRecord: CloudBackupCardRecord | null | undefined;
  /** Loading flag for the latest copy record fetch. */
  isLatestLoading?: boolean;
  /** When true, the newest copy is older than the user's age limit. */
  isOverdue?: boolean;
  /** Master busy flag; disables all action buttons. */
  isBusy?: boolean;
  /** Last action error to surface inline. */
  lastError?: string | null;
  /** Current time in ms (required for purity; parent supplies from state). */
  now: number;

  onConnect: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onBackupNow: () => void;
  onRestore: () => void;
  onAgeLimitChange: (next: CloudBackupCardAgeLimit) => void;

  className?: string;
}

const AGE_LIMIT_LABELS: Record<CloudBackupCardAgeLimit, string> = {
  off: 'Off',
  '1-day': '1 day',
  '1-week': '1 week',
  '1-month': '1 month',
};

/**
 * Encrypted Escape Copy management card (VaultPage and BackupsPhone artboards).
 * Pure presentational component; all state and side effects are owned by the
 * parent (typically a hook such as `useCloudBackup`).
 */
export function CloudBackupCard({
  providerLabel = 'Google Drive',
  connection,
  ageLimit,
  latestRecord,
  isLatestLoading,
  isOverdue,
  isBusy,
  lastError,
  now,
  onConnect,
  onReconnect,
  onDisconnect,
  onBackupNow,
  onRestore,
  onAgeLimitChange,
  className,
}: CloudBackupCardProps) {
  const isLinked = connection.status === 'linked';
  const needsReconnect = connection.status === 'reconnect-needed';

  // The connection pill: trust roles when linked, warning roles when access
  // must be refreshed, and a neutral pill when nothing is linked. The words
  // always sit in the -text role, so the state never relies on the dot.
  let connectionBadge: React.ReactNode;
  let connectionTone: string;
  let connectionDot: string;
  if (isLinked) {
    connectionBadge = (
      <span data-testid="cloud-backup-connection-linked">
        Linked to {providerLabel}
      </span>
    );
    connectionTone = 'bg-trust-soft text-trust-text';
    connectionDot = 'bg-trust';
  } else if (needsReconnect) {
    connectionBadge = (
      <span data-testid="cloud-backup-connection-reconnect-needed">
        {providerLabel} refused access — reconnect to continue
        {connection.reason ? ` (${connection.reason})` : ''}
      </span>
    );
    connectionTone = 'bg-warning-soft text-warning-text';
    connectionDot = 'bg-warning';
  } else {
    connectionBadge = (
      <span data-testid="cloud-backup-connection-not-linked">Not linked</span>
    );
    connectionTone = 'bg-subtle text-subtle-foreground';
    connectionDot = 'bg-inactive';
  }

  let distanceText: string | null = null;
  let formattedDate: string | null = null;
  let latestBody: React.ReactNode;
  if (isLatestLoading) {
    latestBody = (
      <div
        data-testid="cloud-backup-latest-loading"
        className="h-4 w-48 animate-pulse rounded bg-muted"
      />
    );
  } else if (latestRecord === null) {
    latestBody = (
      <p data-testid="cloud-backup-latest-empty">
        No copy in {providerLabel} yet
      </p>
    );
  } else if (latestRecord === undefined) {
    latestBody = (
      <p data-testid="cloud-backup-latest-unknown">Newest copy: unknown</p>
    );
  } else {
    const createdDate = new Date(latestRecord.createdAt);
    const nowDate = new Date(now);
    distanceText = formatDistance(createdDate, nowDate, {
      addSuffix: false,
    });
    formattedDate = formatDate(latestRecord.createdAt);
    latestBody = (
      <p data-testid="cloud-backup-latest-recorded">
        Newest copy:{' '}
        <time dateTime={latestRecord.createdAt} title={formattedDate}>
          <strong>{distanceText} old</strong>
        </time>
      </p>
    );
  }

  return (
    <Card className={className} data-testid="cloud-backup-card">
      <div className="flex flex-col gap-3 p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
          <div className="flex flex-col gap-1.5">
            <h3 className="font-display text-title">Encrypted Escape Copy</h3>
            <p className="text-body-sm text-foreground-supporting">
              Keep an encrypted copy of your vault in your own {providerLabel},
              so it outlives MyOrganiser. Plaintext never leaves this device.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:shrink-0">
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-body-sm font-semibold',
                connectionTone,
              )}
            >
              <span
                aria-hidden="true"
                className={cn('size-2 shrink-0 rounded-full', connectionDot)}
              />
              {connectionBadge}
            </span>

            {isLinked ? (
              <Button
                data-testid="cloud-backup-disconnect-button"
                variant="ghost"
                size="sm"
                disabled={isBusy}
                onClick={onDisconnect}
              >
                Unlink
              </Button>
            ) : needsReconnect ? (
              <>
                <Button
                  data-testid="cloud-backup-reconnect-button"
                  size="sm"
                  disabled={isBusy}
                  onClick={onReconnect}
                >
                  Reconnect
                </Button>
                <Button
                  data-testid="cloud-backup-disconnect-button"
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  onClick={onDisconnect}
                >
                  Unlink
                </Button>
              </>
            ) : (
              <Button
                data-testid="cloud-backup-connect-button"
                size="sm"
                disabled={isBusy}
                onClick={onConnect}
              >
                Link {providerLabel}
              </Button>
            )}
          </div>
        </div>

        {isOverdue && (isLinked || needsReconnect) && (
          <div
            role="status"
            data-testid="cloud-backup-overdue"
            className="rounded-control border border-warning-edge bg-warning-soft p-3 text-body-sm text-warning-text"
          >
            {latestRecord ? (
              <>
                <p>
                  Your newest copy is {distanceText} old, past your{' '}
                  {AGE_LIMIT_LABELS[ageLimit]} limit.
                </p>
                {isLinked && (
                  <p className="mt-1">Use Back up now to make a new copy.</p>
                )}
              </>
            ) : (
              <p>You have no copy in {providerLabel} yet.</p>
            )}
          </div>
        )}

        <CloudBackupCardScheduleRow
          ageLimit={ageLimit}
          isBusy={isBusy}
          isLinked={isLinked}
          latestBody={latestBody}
          providerLabel={providerLabel}
          onAgeLimitChange={onAgeLimitChange}
          onBackupNow={onBackupNow}
          onRestore={onRestore}
        />

        {lastError ? (
          <p
            role="alert"
            data-testid="cloud-backup-error"
            className="text-sm text-destructive"
          >
            {lastError}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

interface CloudBackupCardScheduleRowProps {
  providerLabel: string;
  ageLimit: CloudBackupCardAgeLimit;
  isBusy?: boolean;
  isLinked: boolean;
  latestBody: React.ReactNode;
  onAgeLimitChange: (next: CloudBackupCardAgeLimit) => void;
  onBackupNow: () => void;
  onRestore: () => void;
}

/**
 * The hairline bottom row of {@link CloudBackupCard}: the reminder Select, the
 * newest-copy line, and the two copy actions. It stacks below md, and the
 * actions go full width there.
 */
function CloudBackupCardScheduleRow({
  providerLabel,
  ageLimit,
  isBusy,
  isLinked,
  latestBody,
  onAgeLimitChange,
  onBackupNow,
  onRestore,
}: CloudBackupCardScheduleRowProps) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3 md:flex-row md:flex-wrap md:items-end md:gap-4">
      <div className="flex flex-col gap-2 md:w-56">
        <Label htmlFor="cloud-backup-age-limit">
          Remind me when my newest copy is older than
        </Label>
        <Select
          value={ageLimit}
          onValueChange={(value) =>
            onAgeLimitChange(value as CloudBackupCardAgeLimit)
          }
        >
          <SelectTrigger
            id="cloud-backup-age-limit"
            data-testid="cloud-backup-age-limit-trigger"
            disabled={isBusy}
          >
            <SelectValue placeholder="Off" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(AGE_LIMIT_LABELS) as CloudBackupCardAgeLimit[]).map(
              (value) => (
                <SelectItem
                  key={value}
                  value={value}
                  data-testid={`cloud-backup-age-limit-${value}`}
                >
                  {AGE_LIMIT_LABELS[value]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      <div
        data-testid="cloud-backup-latest"
        className="text-body-sm text-foreground md:min-w-0 md:flex-1 md:pb-2.5"
      >
        {latestBody}
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <Button
          data-testid="cloud-backup-restore-button"
          variant="secondary"
          className="w-full md:w-auto"
          disabled={isBusy || !isLinked}
          onClick={onRestore}
        >
          Restore from {providerLabel}
        </Button>
        <Button
          data-testid="cloud-backup-now-button"
          className="w-full md:w-auto"
          disabled={isBusy || !isLinked}
          onClick={onBackupNow}
        >
          {isBusy ? 'Working…' : 'Back up now'}
        </Button>
      </div>
    </div>
  );
}

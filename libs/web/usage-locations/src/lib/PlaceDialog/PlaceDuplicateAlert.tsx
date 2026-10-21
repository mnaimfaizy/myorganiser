'use client';

import { Alert, AlertDescription } from '@myorganiser/web-ui';

import type { PlaceNoun } from './PlaceDialog';

export interface PlaceDuplicateAlertProps {
  /** The organisation name as typed, quoted in the warning. */
  orgName: string;
  noun: PlaceNoun;
}

/** The warning shown when the typed organisation is already on this address or number. */
export function PlaceDuplicateAlert({
  orgName,
  noun,
}: PlaceDuplicateAlertProps) {
  return (
    <Alert variant="notice" tone="warning">
      <AlertDescription>
        <span className="font-semibold text-warning-text">
          {`“${orgName.trim()}” is already on this ${noun}.`}
        </span>{' '}
        Add it again only if it&apos;s a different account.
      </AlertDescription>
    </Alert>
  );
}

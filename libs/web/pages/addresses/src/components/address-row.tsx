'use client';

import type { AddressRecord } from '@myorganiser/vault-core';
import { ListGroupRow, StatusPill, cn } from '@myorganiser/web-ui';
import { placeProgress } from '@myorganiser/web-usage-locations';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { formatAddressShortLine } from '../utils/address-summary';
import { ADDRESS_STATUS_PILL } from '../utils/presentation';

export interface AddressRowProps {
  address: AddressRecord;
}

/** One Address on the phone list: a navigation row to its detail page. */
export function AddressRow({ address }: AddressRowProps) {
  const { done, total } = placeProgress(address.usageLocations);
  const complete = total > 0 && done === total;
  const pill = ADDRESS_STATUS_PILL[address.status];

  const progressText =
    total === 0
      ? 'No places yet'
      : complete
        ? `All ${total} places updated`
        : `${done} of ${total} places updated`;
  const progressTone =
    total === 0
      ? 'text-muted-foreground'
      : complete
        ? 'text-success-text'
        : 'text-warning-text';

  return (
    <ListGroupRow asChild interactive className="min-h-22 gap-3 px-4 py-2.5">
      <Link href={`/dashboard/addresses/${address.id}`}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.75">
          <span className="flex min-w-0 items-center gap-2 text-body font-semibold text-foreground">
            <span className="truncate">{address.label}</span>
            <StatusPill size="sm" tone={pill.tone}>
              {pill.label}
            </StatusPill>
          </span>
          <span className="truncate text-caption text-foreground-supporting">
            {formatAddressShortLine(address)}
          </span>
          <span className={cn('text-caption font-semibold', progressTone)}>
            {progressText}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 text-inactive"
        />
      </Link>
    </ListGroupRow>
  );
}

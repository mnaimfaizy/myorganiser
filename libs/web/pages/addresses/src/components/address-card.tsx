'use client';

import type { AddressRecord } from '@myorganiser/vault-core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Progress,
  StatusPill,
} from '@myorganiser/web-ui';
import { placeProgress } from '@myorganiser/web-usage-locations';
import { ArrowRight, Copy, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

import { formatAddressLines } from '../utils/address-summary';
import { ADDRESS_STATUS_PILL } from '../utils/presentation';

export interface AddressCardProps {
  address: AddressRecord;
  onCopy: (address: AddressRecord) => void;
  onRequestDelete: (address: AddressRecord) => void;
}

/** One Address on the desktop list: its lines, how far its checklist has got, and the copy and open actions. */
export function AddressCard({
  address,
  onCopy,
  onRequestDelete,
}: AddressCardProps) {
  const { done, total, left } = placeProgress(address.usageLocations);
  const complete = total > 0 && done === total;
  const pill = ADDRESS_STATUS_PILL[address.status];
  const detailHref = `/dashboard/addresses/${address.id}`;

  const handleCopy = useCallback(() => {
    onCopy(address);
  }, [address, onCopy]);

  const handleDelete = useCallback(() => {
    onRequestDelete(address);
  }, [address, onRequestDelete]);

  return (
    <article className="flex flex-col gap-3.5 rounded-panel border border-border bg-card p-5 shadow-card">
      <div className="flex items-start gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={detailHref}
              className="min-w-0 font-display text-title text-foreground no-underline"
            >
              {address.label}
            </Link>
            <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          </div>
          {formatAddressLines(address).map((line) => (
            <span
              key={line}
              className="block text-body-sm text-foreground-secondary"
            >
              {line}
            </span>
          ))}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" label={`Actions for ${address.label}`}>
              <MoreHorizontal aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={detailHref}>Open</Link>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-auto flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-caption">
          <span className="text-foreground-secondary">
            {total === 0
              ? 'No places added yet'
              : `${done} of ${total} places updated`}
          </span>
          {total === 0 ? (
            <span className="font-semibold text-brand-text">Add places</span>
          ) : complete ? (
            <span className="font-semibold text-success-text">All updated</span>
          ) : (
            <span className="font-semibold text-warning-text">{`${left} to go`}</span>
          )}
        </div>
        <Progress
          aria-label={`Places updated for ${address.label}`}
          value={done}
          max={total}
          tone={complete ? 'success' : 'brand'}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={handleCopy}>
          <Copy aria-hidden="true" />
          Copy address
        </Button>
        <Button asChild variant="link">
          <Link href={detailHref}>
            Open
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

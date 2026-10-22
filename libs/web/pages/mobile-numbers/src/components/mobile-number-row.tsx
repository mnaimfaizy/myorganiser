'use client';

import type { MobileNumberRecord } from '@myorganiser/vault-core';
import { Button, IconButton, StatusPill } from '@myorganiser/web-ui';
import { ChevronRight, Copy, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

import { formatMobileNumber } from '../utils/formatMobileNumber';
import { mobilePlaceStatus, telHref } from '../utils/mobile-summary';

export interface MobileNumberRowProps {
  item: MobileNumberRecord;
  onCopy: (item: MobileNumberRecord) => void;
  onRequestDelete: (item: MobileNumberRecord) => void;
}

/**
 * One Mobile Number on the desktop list: its label and number, the place
 * status, and the copy, call, delete and open actions. Delete is always
 * visible, not on hover.
 */
export function MobileNumberRow({
  item,
  onCopy,
  onRequestDelete,
}: MobileNumberRowProps) {
  const status = mobilePlaceStatus(item);
  const href = `/dashboard/mobile-numbers/${item.id}`;
  // Null when there is nothing to dial, so the Call link is not drawn.
  const callHref = telHref(item);

  const handleCopy = useCallback(() => {
    onCopy(item);
  }, [item, onCopy]);

  const handleRequestDelete = useCallback(() => {
    onRequestDelete(item);
  }, [item, onRequestDelete]);

  return (
    <div className="flex min-h-19 flex-wrap items-center gap-3.5 border-b border-border-subtle py-2.5 pr-3 pl-5 last:border-b-0">
      <span className="flex min-w-0 flex-1 basis-55 flex-col">
        <Link
          href={href}
          className="min-w-0 break-words text-body font-semibold text-foreground hover:underline"
        >
          {item.label}
        </Link>
        <span className="text-body-sm text-foreground-secondary tabular-nums">
          {formatMobileNumber(item)}
        </span>
      </span>
      <StatusPill tone={status.tone}>{status.label}</StatusPill>
      <span className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="secondary"
          aria-label={`Copy ${item.label} number`}
          onClick={handleCopy}
        >
          <Copy aria-hidden="true" />
          Copy
        </Button>
        {callHref ? (
          <Button asChild variant="outline" aria-label={`Call ${item.label}`}>
            <a href={callHref}>Call</a>
          </Button>
        ) : null}
        <IconButton
          variant="ghost"
          label={`Delete ${item.label}`}
          className="text-destructive-text"
          onClick={handleRequestDelete}
        >
          <Trash2 aria-hidden="true" />
        </IconButton>
        <IconButton asChild variant="ghost" label={`Open ${item.label}`}>
          <Link href={href}>
            <ChevronRight aria-hidden="true" className="text-inactive" />
          </Link>
        </IconButton>
      </span>
    </div>
  );
}

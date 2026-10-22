'use client';

import type { MobileNumberRecord } from '@myorganiser/vault-core';
import { IconButton, ListGroupRow } from '@myorganiser/web-ui';
import { Copy, Phone } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

import { formatMobileNumber } from '../utils/formatMobileNumber';
import { telHref } from '../utils/mobile-summary';

export interface MobileNumberPhoneRowProps {
  item: MobileNumberRecord;
  onCopy: (item: MobileNumberRecord) => void;
}

/**
 * One Mobile Number on the phone list: a navigation row to its detail, with
 * a copy and a call button at 44px.
 */
export function MobileNumberPhoneRow({
  item,
  onCopy,
}: MobileNumberPhoneRowProps) {
  const href = `/dashboard/mobile-numbers/${item.id}`;
  // Null when there is nothing to dial, so the Call button is not drawn.
  const callHref = telHref(item);

  const handleCopy = useCallback(() => {
    onCopy(item);
  }, [item, onCopy]);

  return (
    <ListGroupRow size="navigation" className="gap-1 pr-1.5 pl-0">
      <Link
        href={href}
        className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5 pl-4"
      >
        <span className="truncate text-body font-semibold text-foreground">
          {item.label}
        </span>
        <span className="text-body-sm text-foreground-secondary tabular-nums">
          {formatMobileNumber(item)}
        </span>
      </Link>
      <IconButton
        variant="ghost"
        label={`Copy ${item.label} number`}
        onClick={handleCopy}
      >
        <Copy aria-hidden="true" />
      </IconButton>
      {callHref ? (
        <IconButton
          asChild
          variant="ghost"
          label={`Call ${item.label}`}
          className="text-brand-text"
        >
          <a href={callHref}>
            <Phone aria-hidden="true" />
          </a>
        </IconButton>
      ) : null}
    </ListGroupRow>
  );
}

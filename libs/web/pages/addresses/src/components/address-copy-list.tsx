'use client';

import {
  ListGroup,
  ListGroupRow,
  ListGroupRowBody,
  ListGroupRowTrailing,
  cn,
} from '@myorganiser/web-ui';
import { Copy } from 'lucide-react';

import type { CopyField } from '../utils/address-summary';

export interface AddressCopyListProps {
  fields: CopyField[];
  /** Desktop reads at the body step; phone reads at the larger value step. */
  variant: 'desktop' | 'phone';
  /** Called with the line the User tapped. The page owns the clipboard. */
  onCopy: (label: string, value: string) => void;
}

const VALUE_TEXT = {
  desktop: 'text-body font-medium',
  phone: 'text-value font-medium',
} as const satisfies Record<AddressCopyListProps['variant'], string>;

const COPY_BOX = {
  desktop: 'size-10',
  phone: 'size-11',
} as const satisfies Record<AddressCopyListProps['variant'], string>;

/**
 * One line per address field. Tapping a line copies it; the label and value
 * are both inside the button, so the whole line is the control.
 */
export function AddressCopyList({
  fields,
  variant,
  onCopy,
}: AddressCopyListProps) {
  return (
    <ListGroup>
      {fields.map((field) => (
        <ListGroupRow
          key={field.label}
          asChild
          interactive
          size="default"
          className="gap-2 pr-1.5 pl-4"
        >
          <button
            type="button"
            aria-label={`Copy ${field.label}: ${field.value}`}
            className="text-left"
            onClick={() => onCopy(field.label, field.value)}
          >
            <ListGroupRowBody className="flex min-w-0 flex-1 flex-col">
              <span className="text-caption text-muted-foreground">
                {field.label}
              </span>
              <span
                className={cn(
                  'min-w-0 truncate tabular-nums text-foreground',
                  VALUE_TEXT[variant],
                )}
              >
                {field.value}
              </span>
            </ListGroupRowBody>
            <ListGroupRowTrailing
              className={cn(
                'justify-center text-foreground-secondary',
                COPY_BOX[variant],
              )}
            >
              <Copy aria-hidden="true" className="size-4" />
            </ListGroupRowTrailing>
          </button>
        </ListGroupRow>
      ))}
    </ListGroup>
  );
}

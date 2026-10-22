'use client';

import { useCallback, useId, useState } from 'react';

import {
  Button,
  ListGroup,
  ListGroupHeaderTitle,
  ListGroupRow,
} from '@myorganiser/web-ui';

import type { AccountVariant } from '../account-view';
import { DeleteAccountDialog } from './DeleteAccountDialog';

const DELETE_DESCRIPTION =
  'Deleting your account removes the account itself, its Sessions, and everything stored on the server for it, including your encrypted vault. This cannot be undone.';

interface DeleteAccountSectionProps {
  variant?: AccountVariant;
}

export function DeleteAccountSection({
  variant = 'desktop',
}: DeleteAccountSectionProps) {
  const headingId = useId();
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  if (variant === 'phone') {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <ListGroupHeaderTitle
          id={headingId}
          className="mt-1.5 px-1 text-destructive-text"
        >
          Delete account
        </ListGroupHeaderTitle>
        <ListGroup className="border-destructive-edge">
          <ListGroupRow
            asChild
            interactive
            className="h-auto min-h-13 w-full flex-col items-start gap-1 py-3 text-left"
          >
            <button
              type="button"
              data-testid="delete-account-button"
              onClick={handleOpen}
            >
              <span className="text-body text-destructive-text">
                Delete account…
              </span>
              <span className="text-caption text-muted-foreground">
                {DELETE_DESCRIPTION}
              </span>
            </button>
          </ListGroupRow>
        </ListGroup>
        <DeleteAccountDialog
          variant={variant}
          open={open}
          onOpenChange={handleOpenChange}
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-wrap items-center gap-4 rounded-panel border border-destructive-edge bg-raised-surface px-6 py-5"
    >
      <div className="flex min-w-0 flex-1 basis-[320px] flex-col gap-1">
        <h2
          id={headingId}
          className="font-display text-title font-bold text-destructive-text"
        >
          Delete account
        </h2>
        <p className="text-body-sm text-muted-foreground">
          {DELETE_DESCRIPTION}
        </p>
      </div>
      <Button
        variant="outline"
        className="border-destructive bg-raised-surface text-destructive-text"
        data-testid="delete-account-button"
        onClick={handleOpen}
      >
        Delete account…
      </Button>
      <DeleteAccountDialog
        variant={variant}
        open={open}
        onOpenChange={handleOpenChange}
      />
    </section>
  );
}

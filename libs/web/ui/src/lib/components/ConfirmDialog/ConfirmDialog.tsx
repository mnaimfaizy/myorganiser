'use client';

import * as React from 'react';
import { useCallback, useRef, useState } from 'react';

import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
} from '../BottomSheet/BottomSheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../Dialog/Dialog';
import { Button } from '../Button/Button';
import { useIsMobile } from '../../hooks/use-mobile';

/**
 * A confirmation that states its consequence before the user commits to it.
 *
 * - `title` names the object: "Delete “Costco run”?"
 * - `description` is the consequence sentence: what happens, and whether it can
 *   be undone.
 * - `confirmLabel` names the action and the object: "Delete list". Never
 *   "OK", "Yes" or "Confirm", because a bare verb-free label hides what the
 *   user is agreeing to. This is required, with no default.
 *
 * Behaviour: role="alertdialog". Outside clicks do not dismiss. Escape and
 * Cancel do. Initial focus goes to Cancel, so that Enter never confirms by
 * accident. While `onConfirm` returns a Promise, the confirm button shows the
 * `loading` state. If the Promise rejects, the dialog stays open and the button
 * is re-enabled.
 *
 * Responsive: at phone width (below 768px, useIsMobile) it renders as a
 * confirm sheet, a BottomSheet with the destructive button first and a ghost
 * Cancel below, both full width. At desktop width it renders as a Dialog with
 * Cancel then Confirm right-aligned.
 */

export interface ConfirmDialogProps {
  /** Controlled open state, owned by the caller. */
  open: boolean;
  /** Called on Cancel, Escape, or the close control. Never called as a side effect of confirming. */
  onOpenChange: (open: boolean) => void;
  /** Names the object, e.g. "Delete “Costco run”?" */
  title: string;
  /** The consequence sentence: what happens, and whether it can be undone. */
  description: React.ReactNode;
  /**
   * Names the action and the object, e.g. "Delete list". Required. Do not use
   * "OK", "Yes" or "Confirm".
   */
  confirmLabel: string;
  /**
   * Invoked when the user activates the confirm control. May return a Promise:
   * the button shows its loading state until it settles. A rejection keeps the
   * dialog open and re-enables the button.
   */
  onConfirm: () => void | Promise<void>;
  /** `destructive` gives the confirm button the destructive style. Defaults to `default` (primary). */
  tone?: 'destructive' | 'default';
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Rendered between the description and the buttons. */
  children?: React.ReactNode;
}

const ConfirmDialog = React.forwardRef<HTMLDivElement, ConfirmDialogProps>(
  (
    {
      open,
      onOpenChange,
      title,
      description,
      confirmLabel,
      onConfirm,
      tone = 'default',
      cancelLabel = 'Cancel',
      children,
    },
    ref,
  ) => {
    const isMobile = useIsMobile();
    const [isPending, setIsPending] = useState(false);
    const cancelRef = useRef<HTMLButtonElement>(null);

    const confirmVariant = tone === 'destructive' ? 'destructive' : 'default';
    const pendingLabel = `${confirmLabel}…`;

    const handleConfirm = useCallback(async () => {
      setIsPending(true);
      try {
        await onConfirm();
      } catch (error) {
        console.error('ConfirmDialog: onConfirm rejected:', error);
      } finally {
        setIsPending(false);
      }
    }, [onConfirm]);

    const handleCancel = useCallback(() => {
      onOpenChange(false);
    }, [onOpenChange]);

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        if (!newOpen) {
          onOpenChange(false);
        }
      },
      [onOpenChange],
    );

    // Outside clicks do not dismiss. Escape and Cancel still do.
    const handleInteractOutside = useCallback((event: Event) => {
      event.preventDefault();
    }, []);

    // Radix would focus the first tabbable element, which is whatever comes
    // first in the content. Cancel is the required initial focus instead.
    const handleOpenAutoFocus = useCallback((event: Event) => {
      event.preventDefault();
      cancelRef.current?.focus();
    }, []);

    if (isMobile) {
      return (
        <BottomSheet open={open} onOpenChange={handleOpenChange}>
          <BottomSheetContent
            ref={ref}
            role="alertdialog"
            onOpenAutoFocus={handleOpenAutoFocus}
            onInteractOutside={handleInteractOutside}
          >
            <BottomSheetHeader>
              <BottomSheetTitle>{title}</BottomSheetTitle>
              <BottomSheetDescription>{description}</BottomSheetDescription>
            </BottomSheetHeader>
            {children}
            <div className="flex flex-col gap-2.5">
              <Button
                variant={confirmVariant}
                size="lg"
                className="w-full"
                onClick={handleConfirm}
                loading={isPending}
              >
                {isPending ? pendingLabel : confirmLabel}
              </Button>
              <Button
                ref={cancelRef}
                variant="ghost"
                size="lg"
                className="w-full"
                onClick={handleCancel}
              >
                {cancelLabel}
              </Button>
            </div>
          </BottomSheetContent>
        </BottomSheet>
      );
    }

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          ref={ref}
          role="alertdialog"
          onOpenAutoFocus={handleOpenAutoFocus}
          onInteractOutside={handleInteractOutside}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter>
            <Button ref={cancelRef} variant="outline" onClick={handleCancel}>
              {cancelLabel}
            </Button>
            <Button
              variant={confirmVariant}
              onClick={handleConfirm}
              loading={isPending}
            >
              {isPending ? pendingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);

ConfirmDialog.displayName = 'ConfirmDialog';

export { ConfirmDialog };

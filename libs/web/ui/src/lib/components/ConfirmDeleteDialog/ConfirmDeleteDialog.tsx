import * as React from 'react';

import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';

interface ConfirmDeleteDialogProps {
  /** Controlled open state, owned by the caller. */
  open: boolean;
  /** Called when the dialog wants to change its open state (cancel, Escape, close button). Never called as a side effect of confirming. Outside clicks do not dismiss. */
  onOpenChange: (open: boolean) => void;
  /** Dialog title, e.g. "Delete this address?" */
  title: string;
  /** Description of exactly what will be destroyed. Accepts ReactNode so callers can bold an item name, etc. */
  description: React.ReactNode;
  /** Invoked when the user activates the confirm control. May return a Promise; the confirm control shows a pending state until it settles. A rejection keeps the dialog open. */
  onConfirm: () => void | Promise<void>;
  /** Optional content to render between the header (title + description) and the footer buttons. */
  children?: React.ReactNode;
  /** Confirm button label. Defaults to "Delete". */
  confirmLabel?: string;
}

/**
 * A destructive confirmation.
 *
 * @deprecated Use `ConfirmDialog` with `tone="destructive"` and a named
 * `confirmLabel` that states the action and the object, for example
 * "Delete list". This wrapper keeps the bare "Delete" default for existing
 * callers and forwards everything to `ConfirmDialog`.
 */
const ConfirmDeleteDialog = React.forwardRef<
  HTMLDivElement,
  ConfirmDeleteDialogProps
>(({ confirmLabel = 'Delete', ...props }, ref) => (
  <ConfirmDialog
    ref={ref}
    tone="destructive"
    confirmLabel={confirmLabel}
    {...props}
  />
));

ConfirmDeleteDialog.displayName = 'ConfirmDeleteDialog';

export { ConfirmDeleteDialog };

'use client';

import type { Task } from '@myorganiser/vault-core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@myorganiser/web-ui';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useState } from 'react';

interface TaskDeleteDialogProps {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function TaskDeleteDialog({
  task,
  isOpen,
  onClose,
  onConfirm,
}: TaskDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = useCallback(async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
    }
  }, [onConfirm]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  if (!task) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!isDeleting}>
        <div className="mb-4 flex items-center justify-center">
          <div className="rounded-full bg-destructive-soft p-3">
            <AlertTriangle
              aria-hidden="true"
              className="h-6 w-6 text-destructive-text"
            />
          </div>
        </div>
        <DialogHeader>
          <DialogTitle>Delete "{task.title}"?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. The task will be permanently deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

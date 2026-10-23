'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@myorganiser/web-ui';
import { useCallback, useState } from 'react';
import type { TaskFormInput } from '../workflow';
import { TaskForm } from './task-form';

interface TaskAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: TaskFormInput) => Promise<void>;
}

export function TaskAddDialog({
  isOpen,
  onClose,
  onSubmit,
}: TaskAddDialogProps) {
  const [isSaving, setIsSaving] = useState(false);

  // A rejection is not swallowed here: it reaches TaskForm, which keeps the
  // entered values so the person can retry. The dialog stays open.
  const handleSubmit = useCallback(
    async (values: TaskFormInput) => {
      setIsSaving(true);
      try {
        await onSubmit(values);
        onClose();
      } finally {
        setIsSaving(false);
      }
    },
    [onSubmit, onClose],
  );

  const handleCancel = useCallback(() => {
    if (!isSaving) {
      onClose();
    }
  }, [isSaving, onClose]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !isSaving) {
        onClose();
      }
    },
    [isSaving, onClose],
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={!isSaving}
        className="max-w-140 gap-0 rounded-2xl p-0 shadow-dialog"
      >
        <DialogHeader className="border-b border-border px-6 pt-6 pb-4 pr-14">
          <DialogTitle>Add task</DialogTitle>
          <DialogDescription className="inline-flex items-center gap-1.5 text-caption text-trust-text">
            <span aria-hidden="true" className="size-2 rounded-full bg-trust" />
            Encrypted on this device before it syncs
          </DialogDescription>
        </DialogHeader>
        <TaskForm
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          submitting={isSaving}
        />
      </DialogContent>
    </Dialog>
  );
}
